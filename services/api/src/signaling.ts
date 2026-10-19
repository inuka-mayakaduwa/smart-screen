import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { createShareCode, formatShareCode, normalizeShareCode, secretsMatch } from "./tokens.js";
import type { Store } from "./store.js";

type Role = "receiver" | "sender";

type Peer = {
  socket: WebSocket;
  role: Role;
  sessionId: string;
  slot: number;
};

type RoomLinks = {
  receiver?: Peer;
  senders: Map<number, Peer>;
};

type ShareAlias = {
  sessionId: string;
  display: string;
  expiresAt: number;
};

type ShareLive = {
  sessionId: string;
  roomId: string;
  deviceId: string;
  panelLanIp: string | null;
};

const MAX_SENDERS = 4;
const MAX_FRAME_BYTES = 2_000_000;
const debug = process.env.DEBUG === "1" || process.env.DEBUG === "true" || process.env.DEBUG === "share";

const aliases = new Map<string, ShareAlias>();
const lives = new Map<string, ShareLive>();
const deviceSession = new Map<string, string>();
const peers = new Map<string, RoomLinks>();

export type ResolvedShare = {
  sessionId: string;
  code: string;
  roomId: string;
  deviceId: string;
  expiresAt: number;
  panelLanIp: string | null;
};

export function setPanelLanIp(deviceId: string, ip: string | null) {
  const sessionId = deviceSession.get(deviceId);
  if (!sessionId) return;
  const live = lives.get(sessionId);
  if (!live) return;
  live.panelLanIp = ip;
}

export function mintShareAlias(input: { roomId: string; deviceId: string; ttlMs: number }): ResolvedShare {
  let sessionId = deviceSession.get(input.deviceId);
  let live = sessionId ? lives.get(sessionId) : undefined;
  if (!live) {
    sessionId = createSessionId();
    live = {
      sessionId,
      roomId: input.roomId,
      deviceId: input.deviceId,
      panelLanIp: null,
    };
    lives.set(sessionId, live);
    deviceSession.set(input.deviceId, sessionId);
  }
  let display = createShareCode();
  let key = normalizeShareCode(display);
  for (let attempt = 0; attempt < 8 && aliases.has(key); attempt += 1) {
    display = createShareCode();
    key = normalizeShareCode(display);
  }
  const expiresAt = Date.now() + input.ttlMs;
  aliases.set(key, { sessionId, display, expiresAt });
  purgeExpiredAliases();
  return {
    sessionId,
    code: formatShareCode(display),
    roomId: live.roomId,
    deviceId: live.deviceId,
    expiresAt,
    panelLanIp: live.panelLanIp,
  };
}

/** @deprecated use mintShareAlias */
export function createShareSession(input: { code: string; roomId: string; deviceId: string; ttlMs: number }) {
  const display = input.code.length >= 4 ? input.code : createShareCode();
  let sessionId = deviceSession.get(input.deviceId);
  let live = sessionId ? lives.get(sessionId) : undefined;
  if (!live) {
    sessionId = createSessionId();
    live = {
      sessionId,
      roomId: input.roomId,
      deviceId: input.deviceId,
      panelLanIp: null,
    };
    lives.set(sessionId, live);
    deviceSession.set(input.deviceId, sessionId);
  }
  const key = normalizeShareCode(display);
  aliases.set(key, { sessionId, display, expiresAt: Date.now() + input.ttlMs });
}

export function getShareSession(code: string): ResolvedShare | undefined {
  purgeExpiredAliases();
  const key = normalizeShareCode(code);
  const alias = aliases.get(key);
  if (!alias || alias.expiresAt < Date.now()) {
    if (alias) aliases.delete(key);
    return undefined;
  }
  const live = lives.get(alias.sessionId);
  if (!live) {
    aliases.delete(key);
    return undefined;
  }
  return {
    sessionId: alias.sessionId,
    code: formatShareCode(alias.display),
    roomId: live.roomId,
    deviceId: live.deviceId,
    expiresAt: alias.expiresAt,
    panelLanIp: live.panelLanIp,
  };
}

export function resolveShareRoomId(code: string): string | undefined {
  return getShareSession(code)?.roomId;
}

export function attachSignaling(server: Server, store: Store) {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    if (requestPath(request) !== "/ws") return;
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (socket, request) => {
    const peer = authorize(socket, request, store);
    if (!peer) return;
    const links = linksFor(peer.sessionId);
    let frames = 0;

    if (peer.role === "sender") {
      const slot = freeSlot(links);
      if (slot === undefined) {
        send(socket, { type: "full" });
        socket.close();
        return;
      }
      peer.slot = slot;
      links.senders.set(slot, peer);
      shareLog(`sender joined session=${peer.sessionId} slot=${slot} receiver=${Boolean(links.receiver)}`);
      send(socket, { type: "joined", role: "sender", slot });
      if (links.receiver) {
        send(links.receiver.socket, { type: "sender", slot });
        send(socket, { type: "ready", slot });
      }
    } else {
      if (links.receiver && links.receiver.socket !== socket) {
        send(links.receiver.socket, { type: "replaced" });
        links.receiver.socket.close();
      }
      links.receiver = peer;
      shareLog(`receiver joined session=${peer.sessionId} senders=${links.senders.size}`);
      send(socket, { type: "joined", role: "receiver" });
      for (const sender of links.senders.values()) {
        send(socket, { type: "sender", slot: sender.slot });
        send(sender.socket, { type: "ready", slot: sender.slot });
      }
    }

    socket.on("message", (raw, isBinary) => {
      const current = peers.get(peer.sessionId);
      if (!current) return;
      if (isBinary) {
        if (peer.role !== "sender" || !current.receiver) return;
        if (current.senders.get(peer.slot)?.socket !== socket) return;
        const body = asBuffer(raw);
        if (body.length < 1 || body.length > MAX_FRAME_BYTES) return;
        frames += 1;
        if (frames === 1 || frames % 90 === 0) {
          shareLog(`frame ${frames} session=${peer.sessionId} slot=${peer.slot} bytes=${body.length}`);
        }
        const packet = Buffer.allocUnsafe(1 + body.length);
        packet[0] = peer.slot;
        body.copy(packet, 1);
        if (current.receiver.socket.readyState === WebSocket.OPEN) current.receiver.socket.send(packet);
        return;
      }

      let message: {
        type?: string;
        slot?: number;
        width?: number;
        fps?: number;
        quality?: number;
        latency?: string;
        sdp?: unknown;
        candidate?: unknown;
      };
      try {
        message = JSON.parse(raw.toString()) as typeof message;
      } catch {
        return;
      }
      if (peer.role === "sender" && current.receiver) {
        shareLog(`sender session=${peer.sessionId} type=${message.type ?? "unknown"}`);
        if (message.type === "hangup") current.senders.delete(peer.slot);
        send(current.receiver.socket, { ...message, slot: peer.slot });
        return;
      }
      if (peer.role === "sender") shareLog(`dropped ${message.type ?? "message"} session=${peer.sessionId} because the panel is not connected`);
      if (peer.role === "receiver" && message.type === "config") {
        const widthLabel = message.width === -1 ? "auto" : message.width || "source";
        const fpsLabel = message.fps ? message.fps : "auto";
        shareLog(
          `config session=${peer.sessionId} width=${widthLabel} fps=${fpsLabel} quality=${message.quality ?? "?"} latency=${message.latency ?? "skip"}`,
        );
        for (const sender of current.senders.values()) send(sender.socket, message);
        return;
      }
      if (peer.role === "receiver") {
        const slot = Number(message.slot);
        const sender = current.senders.get(slot);
        if (!sender) return;
        if (message.type === "hangup") {
          shareLog(`hangup session=${peer.sessionId} slot=${slot}`);
          current.senders.delete(slot);
          send(sender.socket, { type: "hangup", slot });
          send(socket, { type: "peer-left", slot });
          return;
        }
        if (
          message.type === "answer" ||
          message.type === "ice" ||
          message.type === "video-ready" ||
          message.type === "video-stopped"
        ) {
          shareLog(`receiver ${message.type} session=${peer.sessionId} slot=${slot}`);
          send(sender.socket, { ...message, slot });
        }
      }
    });

    socket.on("close", () => {
      const current = peers.get(peer.sessionId);
      if (!current) return;
      if (peer.role === "receiver" && current.receiver?.socket === socket) {
        current.receiver = undefined;
        for (const sender of current.senders.values()) send(sender.socket, { type: "peer-left" });
      }
      if (peer.role === "sender" && current.senders.get(peer.slot)?.socket === socket) {
        current.senders.delete(peer.slot);
        if (current.receiver) send(current.receiver.socket, { type: "peer-left", slot: peer.slot });
      }
      shareLog(`closed ${peer.role} session=${peer.sessionId}`);
      if (!current.receiver && current.senders.size === 0) peers.delete(peer.sessionId);
    });
  });

  return wss;
}

function createSessionId(): string {
  return `ss_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function purgeExpiredAliases() {
  const now = Date.now();
  for (const [key, alias] of aliases) {
    if (alias.expiresAt < now) aliases.delete(key);
  }
}

function requestPath(request: IncomingMessage) {
  return new URL(request.url ?? "/", "http://localhost").pathname;
}

function linksFor(sessionId: string): RoomLinks {
  const existing = peers.get(sessionId);
  if (existing) return existing;
  const created: RoomLinks = { senders: new Map() };
  peers.set(sessionId, created);
  return created;
}

function freeSlot(links: RoomLinks): number | undefined {
  for (let slot = 0; slot < MAX_SENDERS; slot += 1) {
    if (!links.senders.has(slot)) return slot;
  }
  return undefined;
}

function authorize(socket: WebSocket, request: IncomingMessage, store: Store): (Peer & { sessionId: string }) | null {
  const url = new URL(request.url ?? "", "http://localhost");
  const role = url.searchParams.get("role");
  const code = url.searchParams.get("code") ?? "";
  if ((role !== "receiver" && role !== "sender") || !code) {
    shareLog("rejected connection missing role or code");
    socket.close(1008, "Missing role or code");
    return null;
  }
  const session = getShareSession(code);
  if (!session) {
    shareLog(`rejected ${role} unknown code=${normalizeShareCode(code)}`);
    socket.close(1008, "Unknown or expired code");
    return null;
  }
  if (role === "receiver") {
    const token = url.searchParams.get("token") ?? "";
    const device = store.read().devices.find((item) => item.id === session.deviceId && !item.revokedAt);
    if (!device || !secretsMatch(token, device.tokenHash)) {
      shareLog(`rejected receiver code=${session.code}`);
      socket.close(1008, "Receiver is not this room panel");
      return null;
    }
  }
  return { socket, role: role as Role, sessionId: session.sessionId, slot: -1 };
}

function shareLog(message: string) {
  if (debug) console.log(`[share] ${message}`);
}

function send(socket: WebSocket, message: unknown) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function asBuffer(raw: RawData): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw);
  return Buffer.from(raw);
}

function parseLanIp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ip = value.trim();
  const parts = ip.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  if (ip === "0.0.0.0" || ip.startsWith("127.")) return null;
  return ip;
}

export { parseLanIp };
