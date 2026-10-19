import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import type { Config } from "./config.js";
import { createStore } from "./store.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("admin creates a room, a panel redeems Connect, and state comes from the API", async () => {
  const started = await start();
  try {
    const { base, config } = started;
    const denied = await fetch(`${base}/api/admin/rooms`);
    assert.equal(denied.status, 401);

    const token = await login(base, config.adminPassword);
    const created = await request<{ room: { id: string; name: string } }>(base, "/api/admin/rooms", {
      method: "POST",
      token,
      body: { name: "Atlas", timezone: "Asia/Colombo", meta: { Floor: "3" } },
    });
    assert.equal(created.room.name, "Atlas");

    const form = new FormData();
    form.set("file", new Blob([PNG], { type: "image/png" }), "atlas.png");
    form.set("label", "Atlas wall");
    const uploaded = await request<{ image: { id: string; url: string } }>(
      base,
      `/api/admin/rooms/${created.room.id}/images`,
      { method: "POST", token, body: form },
    );
    assert.match(uploaded.image.url, /\/media\//);

    const connected = await request<{ display: string; token: string }>(base, `/api/admin/rooms/${created.room.id}/connect`, {
      method: "POST",
      token,
    });
    assert.match(connected.display, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const redeemed = await request<{ deviceToken: string }>(base, "/api/display/redeem", {
      method: "POST",
      body: { token: connected.display, label: "RioTouch" },
    });
    const reused = await fetch(`${base}/api/display/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: connected.token }),
    });
    assert.equal(reused.status, 400);

    const state = await request<{
      room: { name: string; meta: { Floor: string }; backgroundUrl: string | null };
      meetings: unknown[];
      share: { roomCode: boolean; codeRotateMinutes: number };
      display: { themeId: string; refreshSeconds: number };
    }>(base, "/api/display/state", { token: redeemed.deviceToken });
    assert.equal(state.room.name, "Atlas");
    assert.equal(state.room.meta.Floor, "3");
    assert.equal(state.meetings.length, 0);
    assert.equal(state.share.roomCode, true);
    assert.equal(state.share.codeRotateMinutes, 15);
    assert.equal(state.display.themeId, "classic");
    assert.equal(state.display.refreshSeconds, 20);
    assert.ok(state.room.backgroundUrl?.includes("/media/"));

    const session = await request<{
      sessionId: string;
      code: string;
      shareUrl: string;
      qrDataUrl: string;
      expiresAt: string;
      iceServers: { urls: string }[];
    }>(base, "/api/display/share/sessions", { method: "POST", token: redeemed.deviceToken });
    assert.match(session.code, /^\d{5}$/);
    assert.ok(session.sessionId.length > 0);
    const expiresIn = new Date(session.expiresAt).getTime() - Date.now();
    assert.ok(expiresIn > 14 * 60 * 1000 && expiresIn <= 15 * 60 * 1000);
    assert.equal(session.shareUrl, `http://127.0.0.1:5174/${encodeURIComponent(session.code)}`);
    assert.match(session.qrDataUrl, /^data:image\/png/);
    assert.ok(session.iceServers.some((server) => server.urls.startsWith("stun:")));
    const lookup = await request<{ code: string }>(base, `/api/share/${session.code}`);
    assert.equal(lookup.code, session.code);
  } finally {
    await started.close();
  }
});

async function start() {
  const dir = mkdtempSync(path.join(tmpdir(), "smart-room-"));
  const config: Config = {
    port: 0,
    dataDir: dir,
    publicApiUrl: "http://127.0.0.1",
    adminOrigin: "http://127.0.0.1:5173",
    shareWebOrigin: "http://127.0.0.1:5174",
    whiteboardWebOrigin: "http://127.0.0.1:5175",
    adminPassword: "test-admin",
    googleClientId: "",
    googleClientSecret: "",
    googleRedirectUri: "http://127.0.0.1/api/oauth/google/callback",
    microsoftClientId: "",
    microsoftClientSecret: "",
    microsoftRedirectUri: "http://127.0.0.1/api/oauth/microsoft/callback",
    turnUrl: "",
    turnUsername: "",
    turnPassword: "",
  };
  const store = createStore(dir);
  const { app } = createApp(store, config);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  config.publicApiUrl = `http://127.0.0.1:${port}`;
  return {
    base: config.publicApiUrl,
    config,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function login(base: string, password: string) {
  const body = await request<{ token: string }>(base, "/api/admin/login", {
    method: "POST",
    body: { password },
  });
  return body.token;
}

async function request<T>(
  base: string,
  pathname: string,
  init: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  const headers = new Headers();
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  let body: BodyInit | undefined;
  if (init.body instanceof FormData) body = init.body;
  else if (init.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.body);
  }
  const response = await fetch(`${base}${pathname}`, { method: init.method ?? "GET", headers, body });
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as T & { error?: string }) : ({} as T);
  if (!response.ok) throw new Error(`${response.status} ${pathname} ${(parsed as { error?: string }).error ?? text}`);
  return parsed;
}
