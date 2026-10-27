const TOKEN_KEY = "smart-screen-admin-token";

export type RoomSummary = {
  id: string;
  name: string;
  timezone: string;
  status: "active" | "retired";
  updatedAt: string;
  backgroundUrl: string | null;
  displayCount: number;
  connectionCount: number;
};

export type RoomImage = { id: string; url: string; label: string };

export type RoomConnection = {
  id: string;
  provider: "google" | "microsoft";
  accountLabel: string;
  lastError: string | null;
  createdAt: string;
};

export type RoomDevice = {
  id: string;
  label: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

export type RoomShare = {
  roomCode: boolean;
  oem: boolean;
  oemPackage: string | null;
  googleCast: boolean;
  miracast: boolean;
  airplay: boolean;
  codeRotateMinutes: number;
};

export type RoomSessionSummary = {
  id: string;
  openedAt: string;
  endedAt: string | null;
  whiteboardUpdatedAt: string;
};

export type RoomDetail = {
  id: string;
  name: string;
  timezone: string;
  meta: Record<string, string>;
  brandName: string | null;
  supportContact: string | null;
  logoImageId: string | null;
  logoUrl: string | null;
  status: "active" | "retired";
  share: RoomShare;
  display: import("./display").PanelDisplaySettings;
  displayOverrides: import("./display").PanelDisplaySettings | null;
  backgroundImageId: string | null;
  backgroundKind: "image" | "solid" | "gradient";
  backgroundSolid: string;
  backgroundGradientFrom: string;
  backgroundGradientTo: string;
  scrimOpacity: number;
  images: RoomImage[];
  connections: RoomConnection[];
  devices: RoomDevice[];
  sessions: RoomSessionSummary[];
};

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  let body: BodyInit | undefined;
  if (init.body instanceof FormData) body = init.body;
  else if (init.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.body);
  }
  const response = await fetch(path, { method: init.method ?? "GET", headers, body });
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (response.status === 401 && path !== "/api/admin/login") setToken(null);
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}
