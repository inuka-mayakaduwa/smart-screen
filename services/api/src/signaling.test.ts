import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocket, type RawData } from "ws";
import { createApp } from "./app.js";
import type { Config } from "./config.js";
import { attachSignaling } from "./signaling.js";
import { createStore } from "./store.js";

test("share signaling forwards answers and keeps the jpeg relay", async () => {
  const started = await start();
  const sockets: WebSocket[] = [];
  try {
    const { base, config } = started;
    const token = await login(base, config.adminPassword);
    const created = await request<{ room: { id: string } }>(base, "/api/admin/rooms", {
      method: "POST",
      token,
      body: { name: "Share room", timezone: "UTC" },
    });
    const connected = await request<{ display: string }>(base, `/api/admin/rooms/${created.room.id}/connect`, {
      method: "POST",
      token,
    });
    const redeemed = await request<{ deviceToken: string }>(base, "/api/display/redeem", {
      method: "POST",
      body: { token: connected.display, label: "Panel" },
    });
    const session = await request<{ code: string }>(base, "/api/display/share/sessions", {
      method: "POST",
      token: redeemed.deviceToken,
    });

    const receiver = new WebSocket(shareSocket(base, "receiver", session.code, redeemed.deviceToken));
    const sender = new WebSocket(shareSocket(base, "sender", session.code));
    sockets.push(receiver, sender);
    const receiverMessages = collect(receiver);
    const senderMessages = collect(sender);
    await Promise.all([opened(receiver), opened(sender)]);

    const senderJoined = await senderMessages.next((item) => item.json?.type === "joined", "sender joined");
    assert.equal(senderJoined.json?.role, "sender");
    assert.equal(senderJoined.json?.slot, 0);
    const ready = await senderMessages.next((item) => item.json?.type === "ready", "sender ready");
    assert.equal(ready.json?.slot, 0);

    sender.send(JSON.stringify({ type: "offer", sdp: { type: "offer", sdp: "offer-sdp" } }));
    const offer = await receiverMessages.next((item) => item.json?.type === "offer", "receiver offer");
    assert.equal(offer.json?.slot, 0);
    assert.deepEqual(offer.json?.sdp, { type: "offer", sdp: "offer-sdp" });

    receiver.send(JSON.stringify({ type: "answer", slot: 9, sdp: { type: "answer", sdp: "wrong-slot" } }));
    receiver.send(JSON.stringify({ type: "answer", slot: 0, sdp: { type: "answer", sdp: "answer-sdp" } }));
    const answer = await senderMessages.next((item) => item.json?.type === "answer", "sender answer");
    assert.equal(answer.json?.slot, 0);
    assert.deepEqual(answer.json?.sdp, { type: "answer", sdp: "answer-sdp" });

    const candidate = { candidate: "candidate:1 1 udp 1 10.0.0.8 9 typ host", sdpMid: "0", sdpMLineIndex: 0 };
    receiver.send(JSON.stringify({ type: "ice", slot: 0, candidate }));
    const ice = await senderMessages.next((item) => item.json?.type === "ice", "sender ice");
    assert.deepEqual(ice.json?.candidate, candidate);

    sender.send(JSON.stringify({ type: "ice", candidate: { candidate: "candidate:2 1 udp 1 10.0.0.9 9 typ host", sdpMid: "0" } }));
    const senderIce = await receiverMessages.next((item) => item.json?.type === "ice", "receiver ice");
    assert.equal(senderIce.json?.slot, 0);

    receiver.send(JSON.stringify({ type: "video-ready", slot: 0 }));
    const videoReady = await senderMessages.next((item) => item.json?.type === "video-ready", "video ready");
    assert.equal(videoReady.json?.slot, 0);

    receiver.send(JSON.stringify({ type: "renegotiate", slot: 0, reason: "connected-without-frames" }));
    const renegotiate = await senderMessages.next((item) => item.json?.type === "renegotiate", "renegotiate");
    assert.equal(renegotiate.json?.slot, 0);

    sender.send(Buffer.from([9, 9, 9]));
    const frame = await receiverMessages.next((item) => item.binary, "jpeg frame");
    assert.equal(frame.bytes?.[0], 0);
    assert.deepEqual(frame.bytes?.subarray(1), Buffer.from([9, 9, 9]));

    receiver.send(JSON.stringify({ type: "video-stopped", slot: 0 }));
    const videoStopped = await senderMessages.next((item) => item.json?.type === "video-stopped", "video stopped");
    assert.equal(videoStopped.json?.slot, 0);
  } finally {
    for (const socket of sockets) socket.close();
    await started.close();
  }
});

type Packet = { binary: boolean; json?: { type?: string; role?: string; slot?: number; sdp?: unknown; candidate?: unknown }; bytes?: Buffer };

function collect(socket: WebSocket) {
  const queue: Packet[] = [];
  let notify: (() => void) | undefined;
  socket.on("message", (raw: RawData, isBinary: boolean) => {
    if (isBinary) queue.push({ binary: true, bytes: Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer) });
    else queue.push({ binary: false, json: JSON.parse(raw.toString()) as Packet["json"] });
    notify?.();
  });
  return {
    next(predicate: (item: Packet) => boolean, label: string) {
      const take = () => {
        const index = queue.findIndex(predicate);
        if (index < 0) return undefined;
        return queue.splice(index, 1)[0];
      };
      const existing = take();
      if (existing) return Promise.resolve(existing);
      return new Promise<Packet>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 2000);
        notify = () => {
          const found = take();
          if (!found) return;
          clearTimeout(timer);
          notify = undefined;
          resolve(found);
        };
      });
    },
  };
}

function shareSocket(base: string, role: "sender" | "receiver", code: string, token = "") {
  const url = new URL(`${base.replace(/^http/, "ws")}/ws`);
  url.searchParams.set("role", role);
  url.searchParams.set("code", code);
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

async function start() {
  const dir = mkdtempSync(path.join(tmpdir(), "smart-room-signal-"));
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
  const sockets = attachSignaling(server, store);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  config.publicApiUrl = `http://127.0.0.1:${port}`;
  return {
    base: config.publicApiUrl,
    config,
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

async function request<T>(base: string, pathname: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
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
