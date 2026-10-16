import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "./app.js";
import type { Config } from "./config.js";
import { createStore } from "./store.js";

test("a panel submits debug logs and admin can read, export, and delete them", async () => {
  const started = await start();
  try {
    const { base, config } = started;
    const token = await login(base, config.adminPassword);
    const created = await request<{ room: { id: string } }>(base, "/api/admin/rooms", token, {
      method: "POST",
      body: { name: "Atlas", timezone: "Asia/Colombo" },
    });
    const connected = await request<{ display: string }>(base, `/api/admin/rooms/${created.room.id}/connect`, token, { method: "POST" });
    const redeemed = await request<{ deviceToken: string }>(base, "/api/display/redeem", undefined, {
      method: "POST",
      body: { token: connected.display, label: "Lobby panel" },
    });

    const denied = await fetch(`${base}/api/display/debug-logs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lines: [{ at: "2026-10-16T04:00:00.000Z", level: "info", scope: "api", message: "nope" }] }),
    });
    assert.equal(denied.status, 401);

    const submitted = await request<{ id: string; lineCount: number }>(base, "/api/display/debug-logs", redeemed.deviceToken, {
      method: "POST",
      body: {
        lines: [
          { at: "2026-10-16T04:00:00.000Z", level: "network", scope: "api", message: "GET /api/display/state 200 40ms", detail: "{\"room\":\"Atlas\"}" },
          { level: "error", scope: "share", message: "Socket closed" },
        ],
      },
    });
    assert.equal(submitted.lineCount, 2);

    const listed = await request<{ reports: { id: string; roomName: string; deviceLabel: string; lineCount: number }[] }>(
      base,
      "/api/admin/debug-logs",
      token,
    );
    assert.equal(listed.reports.length, 1);
    assert.equal(listed.reports[0]?.roomName, "Atlas");
    assert.equal(listed.reports[0]?.deviceLabel, "Lobby panel");
    assert.equal(listed.reports[0]?.id, submitted.id);

    const opened = await request<{ text: string }>(base, `/api/admin/debug-logs/${submitted.id}`, token);
    assert.match(opened.text, /GET \/api\/display\/state/);
    assert.match(opened.text, /Socket closed/);

    const exported = await fetch(`${base}/api/admin/debug-logs/${submitted.id}/export`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get("content-type") ?? "", /text\/plain/);
    assert.match(await exported.text(), /Lobby panel/);

    const removed = await fetch(`${base}/api/admin/debug-logs/${submitted.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(removed.status, 204);
    const after = await request<{ reports: unknown[] }>(base, "/api/admin/debug-logs", token);
    assert.equal(after.reports.length, 0);
  } finally {
    await started.close();
  }
});

async function start() {
  const dir = mkdtempSync(path.join(tmpdir(), "smart-room-debug-"));
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
  const body = await request<{ token: string }>(base, "/api/admin/login", undefined, {
    method: "POST",
    body: { password },
  });
  return body.token;
}

async function request<T>(base: string, path: string, token: string | undefined, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `${response.status} ${path}`);
  return payload;
}
