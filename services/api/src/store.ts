import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { defaultDisplaySettings, normalizeDisplaySettings } from "./display.js";
import type { AppDownload, AppRelease, DataFile, Room, RoomSession, WhiteboardScene } from "./types.js";

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
  appDownload: null,
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
      appDownload: normalizeDownload(parsed.appDownload),
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

function normalizeDownload(value: AppDownload | null | undefined): AppDownload | null {
  if (!value || typeof value !== "object") return null;
  if (typeof value.code !== "string" || !/^[A-Z0-9]{8}$/.test(value.code)) return null;
  return { code: value.code, createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date(0).toISOString() };
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
  const kind = record.backgroundKind === "solid" || record.backgroundKind === "gradient" ? record.backgroundKind : "image";
  return {
    ...record,
    brandName: typeof record.brandName === "string" && record.brandName.trim() ? record.brandName.trim() : null,
    logoImageId: typeof record.logoImageId === "string" && record.logoImageId ? record.logoImageId : null,
    backgroundKind: record.backgroundImageId ? "image" : kind,
    backgroundSolid: typeof record.backgroundSolid === "string" ? record.backgroundSolid : "#14221c",
    backgroundGradientFrom: typeof record.backgroundGradientFrom === "string" ? record.backgroundGradientFrom : "#14221c",
    backgroundGradientTo: typeof record.backgroundGradientTo === "string" ? record.backgroundGradientTo : "#0c6b52",
    scrimOpacity: clampOpacity(record.scrimOpacity, 0.62),
    displayOverrides: record.displayOverrides ?? null,
  };
}

function clampOpacity(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(0.8, Math.max(0, parsed));
}
