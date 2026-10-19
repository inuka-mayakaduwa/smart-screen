import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocket } from "ws";
import { createApp } from "./app.js";
import type { Config } from "./config.js";
import { attachSignaling, getShareSession } from "./signaling.js";
import { createStore } from "./store.js";
import { normalizeShareCode } from "./tokens.js";

test("rotating the share code keeps the live session", async () => {
  const started = await start();
  try {
    const { base, store } = started;
    const token = await login(base, started.config.adminPassword);
    const created = await request<{ room: { id: string } }>(base, "/api/admin/rooms", {
      method: "POST",
      token,
      body: { name: "Lab", timezone: "UTC" },
    });
    const connected = await request<{ display: string }>(base, `/api/admin/rooms/${created.room.id}/connect`, {
      method: "POST",
      token,
    });
    const redeemed = await request<{ deviceToken: string }>(base, "/api/display/redeem", {
      method: "POST",
      body: { token: connected.display, label: "Panel" },
    });
    const first = await request<{ code: string; sessionId: string }>(base, "/api/display/share/sessions", {
      method: "POST",
      token: redeemed.deviceToken,
    });
    const second = await request<{ code: string; sessionId: string }>(base, "/api/display/share/sessions", {
      method: "POST",
      token: redeemed.deviceToken,
    });
    const device = store.read().devices.find((item) => !item.revokedAt)!;
    assert.equal(second.sessionId, first.sessionId);
    assert.notEqual(normalizeShareCode(second.code), normalizeShareCode(first.code));
    assert.ok(getShareSession(second.code));
    assert.ok(getShareSession(first.code));
    assert.equal(device.id.length > 0, true);
  } finally {
    await started.close();
  }
});

function shareSocket(base: string, role: "sender" | "receiver", code: string, token = "") {
  const url = new URL(base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = new URLSearchParams({ role, code, ...(token ? { token } : {}) }).toString();
  return new WebSocket(url);
}

type Frame = { json?: { type?: string; slot?: number }; binary?: Buffer };

function collect(socket: WebSocket) {
  const queue: Frame[] = [];
  const waiters: Array<(item: Frame) => void> = [];
  socket.on("message", (raw, isBinary) => {
    const item: Frame = isBinary ? { binary: Buffer.from(raw as Buffer) } : { json: JSON.parse(String(raw)) };
    const waiter = waiters.shift();
    if (waiter) waiter(item);
    else queue.push(item);
  });
  return {
    next(match: (item: Frame) => boolean, label: string, timeoutMs = 5000) {
      return new Promise<Frame>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
        const take = (item: Frame) => {
          if (!match(item)) {
            waiters.push(take);
            return;
          }
          clearTimeout(timer);
          resolve(item);
        };
        for (let i = 0; i < queue.length; i += 1) {
          const item = queue[i]!;
          if (match(item)) {
            queue.splice(i, 1);
            clearTimeout(timer);
            resolve(item);
            return;
          }
        }
        waiters.push(take);
      });
    },
  };
}

async function start() {
  const dir = mkdtempSync(path.join(tmpdir(), "smart-share-"));
  const config: Config = {
    port: 0,
    dataDir: dir,
    publicApiUrl: "http://127.0.0.1",
    adminOrigin: "http://127.0.0.1",
    shareWebOrigin: "http://127.0.0.1",
    whiteboardWebOrigin: "http://127.0.0.1",
    adminPassword: "test-pass",
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
  attachSignaling(server, store);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  config.publicApiUrl = `http://127.0.0.1:${port}`;
  return {
    base: config.publicApiUrl,
    config,
    store,
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
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.body);
  }
  const response = await fetch(`${base}${pathname}`, { method: init.method ?? "GET", headers, body });
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as T & { error?: string }) : ({} as T);
  if (!response.ok) throw new Error(`${response.status} ${pathname} ${(parsed as { error?: string }).error ?? text}`);
  return parsed;
}

function opened(socket: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}
