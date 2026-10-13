import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { defaultDisplaySettings, normalizeDisplaySettings } from "./display.js";
import type { DataFile, Room } from "./types.js";

const EMPTY: DataFile = {
  rooms: [],
  images: [],
  connections: [],
  connectTokens: [],
  devices: [],
  oauthStates: [],
  displayDefaults: defaultDisplaySettings(),
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

function normalizeRoomRecord(room: Room): Room {
  const record = room as Room & { displayOverrides?: Partial<Room["displayOverrides"]> | null };
  return {
    ...record,
    displayOverrides: record.displayOverrides ?? null,
  };
}
