import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "./app.js";
import type { Config } from "./config.js";
import { resetDownloadAttempts } from "./download.js";
import { createStore } from "./store.js";

test("the download page serves the APK only with the admin code", async () => {
  resetDownloadAttempts();
  const started = await start();
  try {
    const { base, config } = started;
    const token = await login(base, config.adminPassword);
    const auth = { authorization: `Bearer ${token}` };

    const closed = await fetch(`${base}/download`);
    assert.equal(closed.status, 200);
    assert.match(await closed.text(), /No panel app is published/);

    const form = new FormData();
    form.set("file", new Blob([Buffer.from("PK-fake-apk")], { type: "application/vnd.android.package-archive" }), "room.apk");
    form.set("versionName", "1.2.0");
    form.set("versionCode", "3");
    const published = await fetch(`${base}/api/admin/app/release`, { method: "POST", headers: auth, body: form });
    assert.equal(published.status, 201);

    const off = await post(base, "ABCD1234");
    assert.equal(off.status, 404);

    const issued = await fetch(`${base}/api/admin/app/download`, { method: "POST", headers: auth });
    const { download } = (await issued.json()) as { download: { code: string } };
    assert.match(download.code, /^[A-Z0-9]{8}$/);

    const page = await fetch(`${base}/download`);
    assert.match(await page.text(), /Download code/);

    const wrong = await post(base, "WRONG000");
    assert.equal(wrong.status, 403);

    const right = await post(base, `${download.code.slice(0, 4)}-${download.code.slice(4).toLowerCase()}`);
    assert.equal(right.status, 200);
    assert.match(right.headers.get("content-disposition") ?? "", /panel-1\.2\.0\.apk/);
    assert.equal(await right.text(), "PK-fake-apk");

    const removed = await fetch(`${base}/api/admin/app/download`, { method: "DELETE", headers: auth });
    assert.equal(removed.status, 204);
    const after = await post(base, download.code);
    assert.equal(after.status, 404);

    const denied = await fetch(`${base}/api/admin/app/download`, { method: "POST" });
    assert.equal(denied.status, 401);
  } finally {
    await started.close();
  }
});

function post(base: string, code: string) {
  return fetch(`${base}/api/download/apk`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code }).toString(),
  });
}

async function start() {
  const dir = mkdtempSync(path.join(tmpdir(), "smart-room-download-"));
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
  const response = await fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const body = (await response.json()) as { token: string };
  return body.token;
}
