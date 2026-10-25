import { debug, type DebugLine } from "./debugLog";
import type { DisplayState, ShareSession } from "./types";

export type RoomActivity = {
  id: string;
  code: string;
  openedAt: string;
  endedAt: string | null;
  whiteboardUrl: string;
  whiteboardUpdatedAt: string;
};

export type SessionSource = "share" | "whiteboard" | "meeting";

export async function redeemPanel(controlApiUrl: string, token: string): Promise<{ deviceToken: string }> {
  return request(controlApiUrl, "/api/display/redeem", {
    method: "POST",
    body: { token, label: "Room panel" },
  });
}

export async function fetchState(controlApiUrl: string, deviceToken: string): Promise<DisplayState> {
  return request(controlApiUrl, "/api/display/state", { deviceToken });
}

export async function createShareSession(controlApiUrl: string, deviceToken: string): Promise<ShareSession> {
  return request(controlApiUrl, "/api/display/share/sessions", { method: "POST", deviceToken });
}

export async function postShareLan(controlApiUrl: string, deviceToken: string, ip: string): Promise<void> {
  await request(controlApiUrl, "/api/display/share/lan", { method: "POST", deviceToken, body: { ip } });
}

export async function fetchRoomSession(controlApiUrl: string, deviceToken: string): Promise<RoomActivity | null> {
  const body = await request<{ session: RoomActivity | null }>(controlApiUrl, "/api/display/session", { deviceToken });
  return body.session;
}

export async function ensureRoomSession(controlApiUrl: string, deviceToken: string, openedBy: SessionSource): Promise<RoomActivity> {
  const body = await request<{ session: RoomActivity }>(controlApiUrl, "/api/display/session", {
    method: "POST",
    deviceToken,
    body: { openedBy },
  });
  return body.session;
}

export async function endRoomSession(controlApiUrl: string, deviceToken: string): Promise<RoomActivity> {
  const body = await request<{ session: RoomActivity }>(controlApiUrl, "/api/display/session/end", {
    method: "POST",
    deviceToken,
  });
  return body.session;
}

export type AppReleaseInfo = {
  versionCode: number;
  versionName: string;
  bytes: number;
  uploadedAt: string;
  notes: string;
};

export async function fetchAppRelease(controlApiUrl: string, deviceToken: string): Promise<AppReleaseInfo | null> {
  const body = await request<{ release: AppReleaseInfo | null }>(controlApiUrl, "/api/display/update", { deviceToken });
  return body.release;
}

export async function submitDebugLogs(
  controlApiUrl: string,
  deviceToken: string,
  lines: DebugLine[],
): Promise<{ id: string; submittedAt: string; lineCount: number }> {
  return request(controlApiUrl, "/api/display/debug-logs", {
    method: "POST",
    deviceToken,
    body: { lines },
    quiet: true,
  });
}

export async function shareCodeActive(controlApiUrl: string, code: string): Promise<boolean> {
  try {
    const response = await fetch(`${controlApiUrl}/api/share/${encodeURIComponent(code)}`);
    return response.ok;
  } catch {
    return true;
  }
}

async function request<T>(
  controlApiUrl: string,
  path: string,
  init: { method?: string; deviceToken?: string; body?: unknown; quiet?: boolean } = {},
): Promise<T> {
  const method = init.method ?? "GET";
  const headers = new Headers();
  if (init.deviceToken) headers.set("authorization", `Bearer ${init.deviceToken}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(`${controlApiUrl}${path}`, {
      method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (err) {
    debug("api", "error", `${method} ${path} failed`, { error: err instanceof Error ? err.message : "network" });
    throw new Error("Cannot reach the control server");
  }
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!init.quiet) {
    debug("api", response.ok ? "network" : "error", `${method} ${path} ${response.status} ${Date.now() - started}ms`, {
      request: init.body,
      response: payload,
    });
  }
  if (!response.ok) throw new Error(payload.error || "The control server rejected the request");
  return payload;
}
