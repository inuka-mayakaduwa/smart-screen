import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { mergeWhiteboard, sessionByCode } from "./sessions.js";
import type { Store } from "./store.js";
import { normalizeConnectCode } from "./tokens.js";
import type { WhiteboardScene } from "./types.js";

const SAVE_MS = 400;
const MAX_PAYLOAD = 12 * 1024 * 1024;

type LiveBoard = {
  sessionId: string;
  scene: WhiteboardScene;
  timer: ReturnType<typeof setTimeout> | null;
};

const live = new Map<string, LiveBoard>();
const peers = new Map<string, Set<WebSocket>>();

export function attachWhiteboard(server: Server, store: Store) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  server.on("upgrade", (request, socket, head) => {
    if (new URL(request.url ?? "/", "http://localhost").pathname !== "/ws/whiteboard") return;
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (socket, request) => {
    const code = codeFrom(request);
    const open = openBoard(store, code);
    if (!code || !open) {
      send(socket, { type: "closed" });
      socket.close(1008, "Session is not open");
      return;
    }

    let room = peers.get(code);
    if (!room) {
      room = new Set();
      peers.set(code, room);
    }
    room.add(socket);
    send(socket, { type: "scene", elements: open.scene.elements, files: open.scene.files });

    socket.on("message", (raw, isBinary) => {
      if (isBinary) return;
      const current = openBoard(store, code);
      if (!current) {
        send(socket, { type: "closed" });
        socket.close(1008, "Session has ended");
        return;
      }
      const message = parseScene(raw);
      if (!message) return;
      const scene = mergeWhiteboard(current.scene, message);
      remember(store, code, current.session.id, scene);
      const group = peers.get(code);
      if (!group) return;
      for (const peer of group) send(peer, { type: "scene", elements: scene.elements, files: scene.files });
    });

    socket.on("close", () => {
      const group = peers.get(code);
      if (!group) return;
      group.delete(socket);
      if (group.size === 0) peers.delete(code);
    });
  });

  return wss;
}

export function liveScene(code: string): WhiteboardScene | undefined {
  return live.get(normalizeConnectCode(code))?.scene;
}

export function closeWhiteboard(store: Store, code: string) {
  const normalized = normalizeConnectCode(code);
  flush(store, normalized);
  const entry = live.get(normalized);
  if (entry?.timer) clearTimeout(entry.timer);
  live.delete(normalized);
  const group = peers.get(normalized);
  if (!group) return;
  for (const socket of group) {
    send(socket, { type: "closed" });
    socket.close(1008, "Session has ended");
  }
  peers.delete(normalized);
}

function openBoard(store: Store, code: string): { session: { id: string }; scene: WhiteboardScene } | null {
  if (!code) return null;
  const session = sessionByCode(store.read(), code);
  if (!session || session.endedAt) return null;
  const cached = live.get(code);
  if (cached && cached.sessionId === session.id) return { session, scene: cached.scene };
  return { session, scene: session.whiteboard };
}

function remember(store: Store, code: string, sessionId: string, scene: WhiteboardScene) {
  const existing = live.get(code);
  if (existing?.timer) clearTimeout(existing.timer);
  const entry: LiveBoard = { sessionId, scene, timer: null };
  entry.timer = setTimeout(() => {
    entry.timer = null;
    flush(store, code);
  }, SAVE_MS);
  live.set(code, entry);
}

function flush(store: Store, code: string) {
  const entry = live.get(code);
  if (!entry) return;
  store.update((data) => {
    const session = data.sessions.find((item) => item.id === entry.sessionId);
    if (!session) return;
    session.whiteboard = entry.scene;
  });
}

function codeFrom(request: IncomingMessage): string {
  const url = new URL(request.url ?? "", "http://localhost");
  return normalizeConnectCode(url.searchParams.get("code") ?? "");
}

function parseScene(raw: RawData): { elements: unknown; files: unknown } | null {
  try {
    const message = JSON.parse(raw.toString()) as { type?: string; elements?: unknown; files?: unknown };
    if (message.type !== "scene" || !Array.isArray(message.elements)) return null;
    return { elements: message.elements, files: message.files };
  } catch {
    return null;
  }
}

function send(socket: WebSocket, message: unknown) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}
