import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { defaultDisplaySettings, normalizeDisplaySettings } from "./display.js";
import type { AppRelease, DataFile, Room, RoomSession, WhiteboardScene } from "./types.js";

const EMPTY: DataFile = {
  rooms: [],
  images: [],
  connections: [],
  connectTokens: [],
  devices: [],
  oauthStates: [],
  displayDefaults: defaultDisplaySettings(),
  sessions: [],
  appRelease: null,
};

export type Store = {
  read(): DataFile;
  update<T>(mutate: (data: DataFile) => T): T;
  filePath: string;
};

export function createStore(dataDir: string): Store {
  mkdirSync(dataDir, { recursive: true });
  const filePath = path.join(dataDir, "store.json");
  if (!existsSync(filePath)) {
    writeFileSync(filePath, JSON.stringify(EMPTY, null, 2));
  }

  function read(): DataFile {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<DataFile>;
    const rooms = (parsed.rooms ?? []).map(normalizeRoomRecord);
    return {
      rooms,
      images: parsed.images ?? [],
      connections: parsed.connections ?? [],
      connectTokens: parsed.connectTokens ?? [],
      devices: parsed.devices ?? [],
      oauthStates: parsed.oauthStates ?? [],
      displayDefaults: normalizeDisplaySettings(parsed.displayDefaults),
      sessions: (parsed.sessions ?? []).map(normalizeSession),
      appRelease: normalizeRelease(parsed.appRelease),
    };
  }

  function write(data: DataFile) {
    const temp = `${filePath}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(data, null, 2));
    renameSync(temp, filePath);
  }

  function update<T>(mutate: (data: DataFile) => T): T {
    const data = read();
    const result = mutate(data);
    write(data);
    return result;
  }

  return { read, update, filePath };
}

function normalizeRelease(value: AppRelease | null | undefined): AppRelease | null {
  if (!value || typeof value !== "object") return null;
  const versionCode = Number(value.versionCode);
  if (!Number.isInteger(versionCode) || versionCode < 1) return null;
  if (typeof value.versionName !== "string" || !value.versionName.trim()) return null;
  if (typeof value.filename !== "string" || !value.filename.trim()) return null;
  return {
    versionCode,
    versionName: value.versionName.trim(),
    filename: value.filename.trim(),
    bytes: Number.isFinite(Number(value.bytes)) ? Number(value.bytes) : 0,
    uploadedAt: typeof value.uploadedAt === "string" ? value.uploadedAt : new Date(0).toISOString(),
    notes: typeof value.notes === "string" ? value.notes : "",
  };
}

function normalizeSession(session: RoomSession): RoomSession {
  const board = session.whiteboard ?? emptyBoard(session.openedAt);
  return {
    ...session,
    endedAt: session.endedAt ?? null,
    whiteboard: {
      elements: Array.isArray(board.elements) ? board.elements : [],
      files: board.files && typeof board.files === "object" && !Array.isArray(board.files) ? board.files : {},
      updatedAt: board.updatedAt || session.openedAt,
    },
  };
}

function emptyBoard(updatedAt: string): WhiteboardScene {
  return { elements: [], files: {}, updatedAt };
}

function normalizeRoomRecord(room: Room): Room {
  const record = room as Room & { displayOverrides?: Partial<Room["displayOverrides"]> | null };
  return {
    ...record,
    displayOverrides: record.displayOverrides ?? null,
  };
}
