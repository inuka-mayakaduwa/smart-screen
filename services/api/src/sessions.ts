import { HttpError } from "./http.js";
import { getShareSession } from "./signaling.js";
import { createConnectCode, createId, normalizeConnectCode } from "./tokens.js";
import type { DataFile, RoomSession, SessionOpenedBy, WhiteboardElement, WhiteboardFile, WhiteboardScene } from "./types.js";

const OPENED_BY = new Set<SessionOpenedBy>(["share", "whiteboard", "meeting"]);

export function parseOpenedBy(value: unknown): SessionOpenedBy {
  if (typeof value === "string" && OPENED_BY.has(value as SessionOpenedBy)) return value as SessionOpenedBy;
  throw new HttpError(400, "Session source is invalid");
}

export function openSession(data: DataFile, roomId: string): RoomSession | undefined {
  return data.sessions.find((session) => session.roomId === roomId && session.endedAt === null);
}

export function sessionByCode(data: DataFile, code: string): RoomSession | undefined {
  return data.sessions.find((session) => session.code === code);
}

export function resolveWhiteboardSession(data: DataFile, rawCode: string): RoomSession | undefined {
  const share = getShareSession(rawCode);
  if (share) {
    const open = openSession(data, share.roomId);
    if (open) return open;
  }
  return sessionByCode(data, normalizeConnectCode(rawCode));
}

export function ensureSession(data: DataFile, roomId: string, openedBy: SessionOpenedBy): RoomSession {
  const existing = openSession(data, roomId);
  if (existing) return existing;
  const now = new Date().toISOString();
  const session: RoomSession = {
    id: createId(),
    roomId,
    code: freshCode(data),
    openedAt: now,
    endedAt: null,
    openedBy,
    whiteboard: emptyScene(now),
  };
  data.sessions.push(session);
  return session;
}

export function endOpenSession(data: DataFile, roomId: string): RoomSession {
  const session = openSession(data, roomId);
  if (!session) throw new HttpError(404, "No open session");
  session.endedAt = new Date().toISOString();
  return session;
}

export function mergeWhiteboard(current: WhiteboardScene, incoming: { elements?: unknown; files?: unknown }): WhiteboardScene {
  const best = new Map<string, WhiteboardElement>();
  const order: string[] = [];
  const consider = (element: WhiteboardElement) => {
    const previous = best.get(element.id);
    if (!previous) {
      order.push(element.id);
      best.set(element.id, element);
      return;
    }
    if (element.version > previous.version) best.set(element.id, element);
  };
  for (const element of elementsOf(current.elements)) consider(element);
  for (const element of elementsOf(incoming.elements)) consider(element);

  const files = { ...filesOf(current.files) };
  for (const [id, file] of Object.entries(filesOf(incoming.files))) files[id] = file;

  return { elements: order.map((id) => best.get(id)!), files, updatedAt: new Date().toISOString() };
}

export function emptyScene(updatedAt = new Date().toISOString()): WhiteboardScene {
  return { elements: [], files: {}, updatedAt };
}

function freshCode(data: DataFile): string {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = createConnectCode();
    if (!data.sessions.some((session) => session.code === code)) return code;
  }
  return createConnectCode();
}

function elementsOf(value: unknown): WhiteboardElement[] {
  if (!Array.isArray(value)) return [];
  const elements: WhiteboardElement[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const element = item as WhiteboardElement;
    if (typeof element.id !== "string" || !element.id) continue;
    if (typeof element.version !== "number" || !Number.isFinite(element.version)) continue;
    elements.push(element);
  }
  return elements;
}

function filesOf(value: unknown): Record<string, WhiteboardFile> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const files: Record<string, WhiteboardFile> = {};
  for (const [id, file] of Object.entries(value)) {
    if (!file || typeof file !== "object" || Array.isArray(file)) continue;
    files[id] = file as WhiteboardFile;
  }
  return files;
}
