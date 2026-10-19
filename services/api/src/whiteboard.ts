import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { mergeWhiteboard, resolveWhiteboardSession, sessionByCode } from "./sessions.js";
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
    const publicCode = codeFrom(request);
    const open = openBoard(store, publicCode);
    if (!publicCode || !open) {
      send(socket, { type: "closed" });
      socket.close(1008, "Session is not open");
      return;
    }
    const boardKey = open.session.id;

    let room = peers.get(boardKey);
    if (!room) {
      room = new Set();
      peers.set(boardKey, room);
    }
    room.add(socket);
    send(socket, { type: "scene", elements: open.scene.elements, files: open.scene.files });

    socket.on("message", (raw, isBinary) => {
      if (isBinary) return;
      const current = openBoard(store, publicCode);
      if (!current) {
        send(socket, { type: "closed" });
        socket.close(1008, "Session has ended");
        return;
      }
      const message = parseScene(raw);
      if (!message) return;
      const scene = mergeWhiteboard(current.scene, message);
      remember(store, boardKey, current.session.id, scene);
      const group = peers.get(boardKey);
      if (!group) return;
      for (const peer of group) send(peer, { type: "scene", elements: scene.elements, files: scene.files });
    });

    socket.on("close", () => {
      const group = peers.get(boardKey);
      if (!group) return;
      group.delete(socket);
      if (group.size === 0) peers.delete(boardKey);
    });
  });

  return wss;
}

export function liveScene(boardKey: string): WhiteboardScene | undefined {
  return live.get(boardKey)?.scene;
}

export function closeWhiteboard(store: Store, code: string) {
  const session =
    resolveWhiteboardSession(store.read(), code) ?? sessionByCode(store.read(), normalizeConnectCode(code));
  if (!session) return;
  const boardKey = session.id;
  flush(store, boardKey);
  const entry = live.get(boardKey);
  if (entry?.timer) clearTimeout(entry.timer);
  live.delete(boardKey);
  const group = peers.get(boardKey);
  if (!group) return;
  for (const socket of group) {
    send(socket, { type: "closed" });
    socket.close(1008, "Session has ended");
  }
  peers.delete(boardKey);
}

function openBoard(store: Store, publicCode: string): { session: { id: string }; scene: WhiteboardScene } | null {
  if (!publicCode) return null;
  const session = resolveWhiteboardSession(store.read(), publicCode);
  if (!session || session.endedAt) return null;
  const boardKey = session.id;
  const cached = live.get(boardKey);
  if (cached && cached.sessionId === session.id) return { session, scene: cached.scene };
  return { session, scene: session.whiteboard };
}

function remember(store: Store, boardKey: string, sessionId: string, scene: WhiteboardScene) {
  const existing = live.get(boardKey);
  if (existing?.timer) clearTimeout(existing.timer);
  const entry: LiveBoard = { sessionId, scene, timer: null };
  entry.timer = setTimeout(() => {
    entry.timer = null;
    flush(store, boardKey);
  }, SAVE_MS);
  live.set(boardKey, entry);
}

function flush(store: Store, boardKey: string) {
  const entry = live.get(boardKey);
  if (!entry) return;
  store.update((data) => {
    const session = data.sessions.find((item) => item.id === entry.sessionId);
    if (!session) return;
    session.whiteboard = entry.scene;
  });
}

function codeFrom(request: IncomingMessage): string {
  const url = new URL(request.url ?? "", "http://localhost");
  return (url.searchParams.get("code") ?? "").trim();
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
