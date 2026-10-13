import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { secretsMatch } from "./tokens.js";
import type { Store } from "./store.js";

type Role = "receiver" | "sender";

type Peer = {
  socket: WebSocket;
  role: Role;
  code: string;
  slot: number;
};

type RoomLinks = {
  receiver?: Peer;
  senders: Map<number, Peer>;
};

const MAX_SENDERS = 4;
const MAX_FRAME_BYTES = 2_000_000;
const debug = process.env.DEBUG === "1" || process.env.DEBUG === "true" || process.env.DEBUG === "share";

const sessions = new Map<string, { code: string; roomId: string; deviceId: string; expiresAt: number }>();
const peers = new Map<string, RoomLinks>();

export function createShareSession(input: { code: string; roomId: string; deviceId: string; ttlMs: number }) {
  sessions.set(input.code, {
    code: input.code,
    roomId: input.roomId,
    deviceId: input.deviceId,
    expiresAt: Date.now() + input.ttlMs,
  });
}

export function getShareSession(code: string) {
  const session = sessions.get(code);
  if (!session) return undefined;
  if (session.expiresAt < Date.now()) {
    sessions.delete(code);
    return undefined;
  }
  return session;
}

export function attachSignaling(server: Server, store: Store) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket, request) => {
    const peer = authorize(socket, request, store);
    if (!peer) return;
    const links = linksFor(peer.code);
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
      shareLog(`sender joined code=${peer.code} slot=${slot} receiver=${Boolean(links.receiver)}`);
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
      shareLog(`receiver joined code=${peer.code} senders=${links.senders.size}`);
      send(socket, { type: "joined", role: "receiver" });
      for (const sender of links.senders.values()) {
        send(socket, { type: "sender", slot: sender.slot });
        send(sender.socket, { type: "ready", slot: sender.slot });
      }
    }

    socket.on("message", (raw, isBinary) => {
      const current = peers.get(peer.code);
      if (!current) return;
      if (isBinary) {
        if (peer.role !== "sender" || !current.receiver) return;
        const body = asBuffer(raw);
        if (body.length < 1 || body.length > MAX_FRAME_BYTES) return;
        frames += 1;
        if (frames === 1 || frames % 90 === 0) shareLog(`frame ${frames} code=${peer.code} slot=${peer.slot} bytes=${body.length}`);
        const packet = Buffer.allocUnsafe(1 + body.length);
        packet[0] = peer.slot;
        body.copy(packet, 1);
        if (current.receiver.socket.readyState === WebSocket.OPEN) current.receiver.socket.send(packet);
        return;
      }

      let message: { type?: string; slot?: number; width?: number; fps?: number; quality?: number; latency?: string };
      try {
        message = JSON.parse(raw.toString()) as typeof message;
      } catch {
        return;
      }
      if (peer.role === "sender" && current.receiver) {
        shareLog(`sender code=${peer.code} type=${message.type ?? "unknown"}`);
        send(current.receiver.socket, { ...message, slot: peer.slot });
        return;
      }
      if (peer.role === "sender") shareLog(`dropped ${message.type ?? "message"} code=${peer.code} because the panel is not connected`);
      if (peer.role === "receiver" && message.type === "config") {
        const widthLabel = message.width === -1 ? "auto" : message.width || "source";
        const fpsLabel = message.fps ? message.fps : "auto";
        shareLog(`config code=${peer.code} width=${widthLabel} fps=${fpsLabel} quality=${message.quality ?? "?"} latency=${message.latency ?? "skip"}`);
        for (const sender of current.senders.values()) send(sender.socket, message);
        return;
      }
      if (peer.role === "receiver") {
        const slot = Number(message.slot);
        const sender = current.senders.get(slot);
        if (!sender) return;
        if (message.type === "hangup") {
          shareLog(`hangup code=${peer.code} slot=${slot}`);
          send(sender.socket, message);
        }
      }
    });

    socket.on("close", () => {
      const current = peers.get(peer.code);
      if (!current) return;
      if (peer.role === "receiver" && current.receiver?.socket === socket) {
        current.receiver = undefined;
        for (const sender of current.senders.values()) send(sender.socket, { type: "peer-left" });
      }
      if (peer.role === "sender" && current.senders.get(peer.slot)?.socket === socket) {
        current.senders.delete(peer.slot);
        if (current.receiver) send(current.receiver.socket, { type: "peer-left", slot: peer.slot });
      }
      shareLog(`closed ${peer.role} code=${peer.code}`);
      if (!current.receiver && current.senders.size === 0) peers.delete(peer.code);
    });
  });

  return wss;
}

function linksFor(code: string): RoomLinks {
  const existing = peers.get(code);
  if (existing) return existing;
  const created: RoomLinks = { senders: new Map() };
  peers.set(code, created);
  return created;
}

function freeSlot(links: RoomLinks): number | undefined {
  for (let slot = 0; slot < MAX_SENDERS; slot += 1) {
    if (!links.senders.has(slot)) return slot;
  }
  return undefined;
}

function authorize(socket: WebSocket, request: IncomingMessage, store: Store): Peer | null {
  const url = new URL(request.url ?? "", "http://localhost");
  const role = url.searchParams.get("role");
  const code = (url.searchParams.get("code") ?? "").toUpperCase();
  if ((role !== "receiver" && role !== "sender") || !code) {
    shareLog("rejected connection missing role or code");
    socket.close(1008, "Missing role or code");
    return null;
  }
  const session = getShareSession(code);
  if (!session) {
    shareLog(`rejected ${role} unknown code=${code}`);
    socket.close(1008, "Unknown or expired code");
    return null;
  }
  if (role === "receiver") {
    const token = url.searchParams.get("token") ?? "";
    const device = store.read().devices.find((item) => item.id === session.deviceId && !item.revokedAt);
    if (!device || !secretsMatch(token, device.tokenHash)) {
      shareLog(`rejected receiver code=${code}`);
      socket.close(1008, "Receiver is not this room panel");
      return null;
    }
  }
  return { socket, role, code, slot: -1 };
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
