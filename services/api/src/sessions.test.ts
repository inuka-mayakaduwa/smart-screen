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
import { mergeWhiteboard } from "./sessions.js";
import { createStore } from "./store.js";
import { attachWhiteboard } from "./whiteboard.js";

test("merge keeps the higher element version and tombstones", () => {
  const merged = mergeWhiteboard(
    {
      elements: [
        { id: "a", version: 2, type: "rectangle" },
        { id: "b", version: 1, type: "line" },
      ],
      files: { keep: { id: "keep", mimeType: "image/png", dataURL: "data:image/png,old" } },
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      elements: [
        { id: "a", version: 1, type: "ellipse" },
        { id: "a", version: 4, type: "ellipse", isDeleted: true },
        { id: "c", version: 1, type: "arrow" },
      ],
      files: { added: { id: "added", mimeType: "image/png", dataURL: "data:image/png,new" } },
    },
  );

  const byId = Object.fromEntries(merged.elements.map((element) => [element.id, element]));
  assert.equal(byId.a?.version, 4);
  assert.equal(byId.a?.isDeleted, true);
  assert.equal(byId.b?.version, 1);
  assert.equal(byId.c?.type, "arrow");
  assert.equal(merged.files.keep?.dataURL, "data:image/png,old");
  assert.equal(merged.files.added?.dataURL, "data:image/png,new");
});

test("an open room session is reused, ended by hand, and keeps its whiteboard", async () => {
  const started = await start();
  try {
    const { base, config, store } = started;
    const token = await login(base, config.adminPassword);
    const created = await request<{ room: { id: string } }>(base, "/api/admin/rooms", {
      method: "POST",
      token,
      body: { name: "Board room", timezone: "UTC" },
    });
    const connected = await request<{ display: string }>(base, `/api/admin/rooms/${created.room.id}/connect`, {
      method: "POST",
      token,
    });
    const redeemed = await request<{ deviceToken: string }>(base, "/api/display/redeem", {
      method: "POST",
      body: { token: connected.display, label: "Panel" },
    });
    const device = redeemed.deviceToken;

    const denied = await fetch(`${base}/api/display/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ openedBy: "share" }),
    });
    assert.equal(denied.status, 401);

    const invalid = await fetch(`${base}/api/display/session`, {
      method: "POST",
      headers: { authorization: `Bearer ${device}`, "content-type": "application/json" },
      body: JSON.stringify({ openedBy: "clock" }),
    });
    assert.equal(invalid.status, 400);

    const idle = await request<{ session: null }>(base, "/api/display/session", { token: device });
    assert.equal(idle.session, null);

    const first = await request<{ session: SessionBody }>(base, "/api/display/session", {
      method: "POST",
      token: device,
      body: { openedBy: "share" },
    });
    const again = await request<{ session: SessionBody }>(base, "/api/display/session", {
      method: "POST",
      token: device,
      body: { openedBy: "whiteboard" },
    });
    assert.equal(again.session.id, first.session.id);
    assert.equal(again.session.code, first.session.code);
    assert.match(again.session.whiteboardUrl, new RegExp(`/${first.session.code}$`));

    const listed = await request<{ room: { sessions: { id: string; endedAt: string | null }[] } }>(
      base,
      `/api/admin/rooms/${created.room.id}`,
      { token },
    );
    assert.equal(listed.room.sessions.length, 1);
    assert.equal(listed.room.sessions[0]?.endedAt, null);

    const socketA = new WebSocket(`${base.replace(/^http/, "ws")}/ws/whiteboard?code=${first.session.code}`);
    const socketB = new WebSocket(`${base.replace(/^http/, "ws")}/ws/whiteboard?code=${first.session.code}`);
    await Promise.all([opened(socketA), opened(socketB)]);

    const drawnPromise = nextScene(socketB, (elements) => elements.some((element) => element.id === "circle"));
    socketA.send(
      JSON.stringify({
        type: "scene",
        elements: [{ id: "circle", version: 1, type: "ellipse" }],
        files: {},
      }),
    );
    const drawn = await drawnPromise;
    assert.equal(drawn.find((element) => element.id === "circle")?.version, 1);

    const mergedPromise = nextScene(socketA, (elements) => elements.some((element) => element.id === "note"));
    socketB.send(
      JSON.stringify({
        type: "scene",
        elements: [
          { id: "circle", version: 2, type: "ellipse" },
          { id: "circle", version: 1, type: "rectangle" },
          { id: "note", version: 1, type: "text" },
        ],
        files: { pic: { id: "pic", mimeType: "image/png", dataURL: "data:image/png,board" } },
      }),
    );
    const merged = await mergedPromise;
    assert.equal(merged.find((element) => element.id === "circle")?.version, 2);
    assert.equal(merged.find((element) => element.id === "note")?.type, "text");

    const live = await request<{ open: boolean; elements: { id: string; version: number }[]; files: { pic?: { dataURL: string } } }>(
      base,
      `/api/whiteboard/${first.session.code}`,
    );
    assert.equal(live.open, true);
    assert.equal(live.elements.find((element) => element.id === "circle")?.version, 2);
    assert.equal(live.files.pic?.dataURL, "data:image/png,board");

    await delay(500);
    const stored = store.read().sessions.find((session) => session.id === first.session.id);
    assert.equal(stored?.whiteboard.elements.find((element) => element.id === "circle")?.version, 2);
    assert.equal(stored?.whiteboard.files.pic?.dataURL, "data:image/png,board");

    const ended = await request<{ session: SessionBody }>(base, "/api/display/session/end", {
      method: "POST",
      token: device,
    });
    assert.ok(ended.session.endedAt);
    const closed = await request<{ open: boolean }>(base, `/api/whiteboard/${first.session.code}`);
    assert.equal(closed.open, false);
    await closedSocket(socketA);

    const missing = await fetch(`${base}/api/display/session/end`, {
      method: "POST",
      headers: { authorization: `Bearer ${device}` },
    });
    assert.equal(missing.status, 404);

    const next = await request<{ session: SessionBody }>(base, "/api/display/session", {
      method: "POST",
      token: device,
      body: { openedBy: "meeting" },
    });
    assert.notEqual(next.session.id, first.session.id);
    const fresh = await request<{ open: boolean; elements: unknown[] }>(base, `/api/whiteboard/${next.session.code}`);
    assert.equal(fresh.open, true);
    assert.equal(fresh.elements.length, 0);

    const history = await request<{ room: { sessions: { id: string; endedAt: string | null }[] } }>(
      base,
      `/api/admin/rooms/${created.room.id}`,
      { token },
    );
    assert.equal(history.room.sessions.length, 2);
    assert.equal(history.room.sessions.filter((session) => session.endedAt === null).length, 1);

    socketB.close();
  } finally {
    await started.close();
  }
});

type SessionBody = { id: string; code: string; endedAt: string | null; whiteboardUrl: string };
type SceneElement = { id: string; version: number; type?: string };

async function start() {
  const dir = mkdtempSync(path.join(tmpdir(), "smart-room-session-"));
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
  const sockets = attachWhiteboard(server, store);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  config.publicApiUrl = `http://127.0.0.1:${port}`;
  return {
    base: config.publicApiUrl,
    config,
    store,
    close: async () => {
      for (const client of sockets.clients) client.terminate();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
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

function nextScene(socket: WebSocket, match: (elements: SceneElement[]) => boolean) {
  return new Promise<SceneElement[]>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for a whiteboard scene")), 2000);
    const onMessage = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString()) as { type?: string; elements?: SceneElement[] };
      if (message.type === "scene" && match(message.elements ?? [])) {
        clearTimeout(timer);
        socket.off("message", onMessage);
        resolve(message.elements ?? []);
      }
    };
    socket.on("message", onMessage);
  });
}

function closedSocket(socket: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    const timer = setTimeout(() => reject(new Error("Timed out waiting for the whiteboard socket to close")), 2000);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
