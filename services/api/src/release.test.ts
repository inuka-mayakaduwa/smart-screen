import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "./app.js";
import type { Config } from "./config.js";
import { HttpError } from "./http.js";
import { readReleaseFields } from "./release.js";
import { createStore } from "./store.js";

test("a release version code must be a positive integer above the published one", () => {
  assert.deepEqual(readReleaseFields({ versionCode: "2", versionName: "1.1.0", notes: "Fix the clock" }, 1), {
    versionCode: 2,
    versionName: "1.1.0",
    notes: "Fix the clock",
  });
  assert.throws(() => readReleaseFields({ versionCode: 1, versionName: "1.0.0" }, 1), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 400);
    return true;
  });
  assert.throws(() => readReleaseFields({ versionCode: 0, versionName: "1.0.0" }, null), HttpError);
});

test("a published apk is stored once and a panel downloads that file", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "smart-room-release-"));
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
  const { app } = createApp(createStore(dir), config);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const denied = await fetch(`${base}/api/admin/app/release`);
    assert.equal(denied.status, 401);

    const token = await login(base);
    const empty = await request<{ release: null }>(base, "/api/admin/app/release", token);
    assert.equal(empty.release, null);

    const first = await publish(base, token, { versionCode: "1", versionName: "1.0.0", notes: "First", bytes: "apk-one" });
    assert.equal(first.release.versionCode, 1);
    assert.equal(first.release.versionName, "1.0.0");

    const same = await publish(base, token, { versionCode: "1", versionName: "1.0.1", notes: "", bytes: "apk-two" });
    assert.equal(same.status, 400);

    const second = await publish(base, token, { versionCode: "2", versionName: "1.1.0", notes: "Clock", bytes: "apk-two" });
    assert.equal(second.release.versionName, "1.1.0");
    assert.equal(second.release.notes, "Clock");

    const room = await request<{ room: { id: string } }>(base, "/api/admin/rooms", token, {
      method: "POST",
      body: { name: "Atlas", timezone: "UTC" },
    });
    const connected = await request<{ display: string }>(base, `/api/admin/rooms/${room.room.id}/connect`, token, { method: "POST" });
    const redeemed = await request<{ deviceToken: string }>(base, "/api/display/redeem", undefined, {
      method: "POST",
      body: { token: connected.display, label: "Panel" },
    });
    const update = await request<{ release: { versionCode: number; versionName: string } }>(
      base,
      "/api/display/update",
      redeemed.deviceToken,
    );
    assert.equal(update.release.versionCode, 2);

    const apk = await fetch(`${base}/api/display/update/apk`, { headers: { authorization: `Bearer ${redeemed.deviceToken}` } });
    assert.equal(apk.status, 200);
    assert.equal(apk.headers.get("content-type"), "application/vnd.android.package-archive");
    assert.equal(await apk.text(), "apk-two");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    rmSync(dir, { recursive: true, force: true });
  }
});

async function login(base: string) {
  const body = await request<{ token: string }>(base, "/api/admin/login", undefined, {
    method: "POST",
    body: { password: "test-admin" },
  });
  return body.token;
}

async function publish(
  base: string,
  token: string,
  fields: { versionCode: string; versionName: string; notes: string; bytes: string },
) {
  const form = new FormData();
  form.set("versionCode", fields.versionCode);
  form.set("versionName", fields.versionName);
  form.set("notes", fields.notes);
  form.set("file", new Blob([fields.bytes]), "room.apk");
  const response = await fetch(`${base}/api/admin/app/release`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const parsed = (await response.json()) as { release: { versionCode: number; versionName: string; notes: string }; error?: string };
  if (response.ok) return { status: response.status, release: parsed.release };
  return { status: response.status, release: parsed.release, error: parsed.error };
}

async function request<T>(
  base: string,
  pathname: string,
  token?: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  let body: BodyInit | undefined;
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.body);
  }
  const response = await fetch(`${base}${pathname}`, { method: init.method ?? "GET", headers, body });
  const parsed = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(`${response.status} ${parsed.error ?? pathname}`);
  return parsed;
}
