import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import QRCode from "qrcode";
import type { Config } from "./config.js";
import { iceServers } from "./config.js";
import { loadRoomMeetings } from "./calendar.js";
import { applyToken, exchangeGoogleCode, googleAccountLabel, googleAuthUrl, googleConfigured } from "./google.js";
import { HttpError } from "./http.js";
import {
  applyMicrosoftToken,
  exchangeMicrosoftCode,
  microsoftAccountLabel,
  microsoftAuthUrl,
  microsoftConfigured,
} from "./microsoft.js";
import { createDebugLogs, formatDebugReport, normalizeDebugLines } from "./debugLogs.js";
import { allowDownloadAttempt, downloadPage } from "./download.js";
import { createShareSession, getShareSession } from "./signaling.js";
import { APK_FILENAME, APK_LIMIT_BYTES, assertApkFile, presentRelease, readReleaseFields } from "./release.js";
import { endOpenSession, ensureSession, parseOpenedBy, sessionByCode } from "./sessions.js";
import { closeWhiteboard, liveScene } from "./whiteboard.js";
import type { Store } from "./store.js";
import {
  adminToken,
  createConnectCode,
  createDeviceToken,
  createId,
  formatConnectCode,
  hashSecret,
  normalizeConnectCode,
  secretsMatch,
} from "./tokens.js";
import {
  defaultDisplaySettings,
  normalizeDisplaySettings,
  PANEL_THEMES,
  parseDisplayPatch,
  resolveDisplaySettings,
} from "./display.js";
import type { CalendarProvider, Room, RoomSession, RoomShare } from "./types.js";

const CONNECT_TTL_MS = 10 * 60 * 1000;
const OAUTH_TTL_MS = 15 * 60 * 1000;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

export type AppContext = {
  app: express.Express;
  store: Store;
  config: Config;
};

export function createApp(store: Store, config: Config): AppContext {
  const app = express();
  const uploadDir = path.join(path.dirname(store.filePath), "uploads");
  const releaseDir = path.join(path.dirname(store.filePath), "releases");
  const debugLogs = createDebugLogs(path.join(path.dirname(store.filePath), "debug-logs"));
  mkdirSync(uploadDir, { recursive: true });
  mkdirSync(releaseDir, { recursive: true });
  const apkUpload = multer({
    storage: multer.diskStorage({
      destination: releaseDir,
      filename: (_req, _file, cb) => cb(null, "incoming.apk"),
    }),
    limits: { fileSize: APK_LIMIT_BYTES },
  });

  app.set("trust proxy", 1);
  app.use(
    cors({
      origin: [...new Set([config.adminOrigin, config.shareWebOrigin, config.whiteboardWebOrigin].map(browserOrigin))],
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/download", express.urlencoded({ extended: false, limit: "4kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/config/public", (_req, res) => {
    res.json({
      googleConfigured: googleConfigured(config),
      microsoftConfigured: microsoftConfigured(config),
      turnConfigured: Boolean(config.turnUrl),
      themes: PANEL_THEMES,
    });
  });

  app.get("/api/admin/settings/display", requireAdmin, (_req, res) => {
    const data = store.read();
    res.json({ display: data.displayDefaults, themes: PANEL_THEMES });
  });

  app.patch(
    "/api/admin/settings/display",
    requireAdmin,
    route((req, res) => {
      const display = normalizeDisplaySettings(parseDisplayPatch(req.body?.display, "Display settings"));
      store.update((data) => {
        data.displayDefaults = display;
      });
      res.json({ display });
    }),
  );

  app.get("/api/admin/app/release", requireAdmin, (_req, res) => {
    res.json({ release: presentRelease(store.read().appRelease) });
  });

  app.post(
    "/api/admin/app/release",
    requireAdmin,
    acceptApk,
    route((req, res) => {
      const file = req.file;
      try {
        assertApkFile(file);
        const fields = readReleaseFields(req.body ?? {}, store.read().appRelease?.versionCode ?? null);
        const published = path.join(releaseDir, APK_FILENAME);
        rmSync(published, { force: true });
        renameSync(path.join(releaseDir, "incoming.apk"), published);
        const release = {
          versionCode: fields.versionCode,
          versionName: fields.versionName,
          filename: APK_FILENAME,
          bytes: file!.size,
          uploadedAt: new Date().toISOString(),
          notes: fields.notes,
        };
        store.update((data) => {
          data.appRelease = release;
        });
        res.status(201).json({ release: presentRelease(release) });
      } catch (error) {
        rmSync(path.join(releaseDir, "incoming.apk"), { force: true });
        throw error;
      }
    }),
  );

  app.get("/api/admin/app/download", requireAdmin, (_req, res) => {
    res.json({ download: store.read().appDownload });
  });

  app.post("/api/admin/app/download", requireAdmin, (_req, res) => {
    const download = { code: createConnectCode(), createdAt: new Date().toISOString() };
    store.update((data) => {
      data.appDownload = download;
    });
    res.status(201).json({ download });
  });

  app.delete("/api/admin/app/download", requireAdmin, (_req, res) => {
    store.update((data) => {
      data.appDownload = null;
    });
    res.status(204).end();
  });

  app.get(["/download", "/download/"], (_req, res) => {
    const data = store.read();
    res.setHeader("cache-control", "no-store");
    res.type("html").send(downloadPage(data.appRelease, { open: Boolean(data.appDownload) }));
  });

  app.post("/api/download/apk", (req, res) => {
    const data = store.read();
    res.setHeader("cache-control", "no-store");
    const page = (status: number, error: string) =>
      res.status(status).type("html").send(downloadPage(data.appRelease, { open: Boolean(data.appDownload), error }));
    if (!data.appRelease || !data.appDownload) {
      page(404, "Downloads are not available.");
      return;
    }
    if (!allowDownloadAttempt(req.ip ?? "unknown")) {
      page(429, "Too many attempts. Try again in a few minutes.");
      return;
    }
    const code = normalizeConnectCode(typeof req.body?.code === "string" ? req.body.code : "");
    const expected = Buffer.from(data.appDownload.code);
    const given = Buffer.from(code);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      page(403, "That download code is not valid.");
      return;
    }
    res.type("application/vnd.android.package-archive");
    res.download(path.join(releaseDir, APK_FILENAME), `panel-${data.appRelease.versionName}.apk`);
  });

  app.post(
    "/api/admin/login",
    route((req, res) => {
      const password = stringField(req.body?.password, "Password");
      if (password !== config.adminPassword) throw new HttpError(401, "Incorrect password");
      res.json({ token: adminToken(password) });
    }),
  );

  app.get("/api/admin/session", requireAdmin, (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/admin/rooms", requireAdmin, (req, res) => {
    const data = store.read();
    res.json({
      rooms: data.rooms
        .map((room) => summarizeRoom(data, room, config.publicApiUrl))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    });
  });

  app.post(
    "/api/admin/rooms",
    requireAdmin,
    route((req, res) => {
      const name = stringField(req.body?.name, "Room name");
      const timezone = optionalTimezone(req.body?.timezone) ?? "UTC";
      const meta = optionalMeta(req.body?.meta) ?? {};
      const now = new Date().toISOString();
      const room: Room = {
        id: createId(),
        name,
        timezone,
        meta,
        backgroundImageId: null,
        status: "active",
        share: defaultShare(),
        displayOverrides: null,
        createdAt: now,
        updatedAt: now,
      };
      store.update((data) => {
        data.rooms.push(room);
      });
      res.status(201).json({ room: presentAdminRoom(store.read(), room, config.publicApiUrl) });
    }),
  );

  app.get("/api/admin/rooms/:id", requireAdmin, (req, res) => {
    const data = store.read();
    const room = findRoom(data.rooms, req.params.id);
    res.json({ room: presentAdminRoom(data, room, config.publicApiUrl) });
  });

  app.patch(
    "/api/admin/rooms/:id",
    requireAdmin,
    route((req, res) => {
      const updated = store.update((data) => {
        const room = findRoom(data.rooms, req.params.id);
        if (req.body?.name !== undefined) room.name = stringField(req.body.name, "Room name");
        if (req.body?.timezone !== undefined) room.timezone = requireTimezone(req.body.timezone);
        if (req.body?.meta !== undefined) room.meta = optionalMeta(req.body.meta) ?? {};
        if (req.body?.status !== undefined) {
          if (req.body.status !== "active" && req.body.status !== "retired") {
            throw new HttpError(400, "Status must be active or retired");
          }
          room.status = req.body.status;
        }
        if (req.body?.backgroundImageId !== undefined) {
          const imageId = req.body.backgroundImageId;
          if (imageId === null || imageId === "") room.backgroundImageId = null;
          else {
            const image = data.images.find((item) => item.id === imageId && item.roomId === room.id);
            if (!image) throw new HttpError(400, "That image is not on this room");
            room.backgroundImageId = image.id;
          }
        }
        if (req.body?.share !== undefined) room.share = parseShare(req.body.share, normalizeShare(room.share));
        if (req.body?.displayOverrides !== undefined) {
          if (req.body.displayOverrides === null) room.displayOverrides = null;
          else {
            room.displayOverrides = normalizeDisplaySettings(
              parseDisplayPatch(req.body.displayOverrides, "Display overrides"),
              data.displayDefaults,
            );
          }
        }
        room.updatedAt = new Date().toISOString();
        return room;
      });
      res.json({ room: presentAdminRoom(store.read(), updated, config.publicApiUrl) });
    }),
  );

  app.delete("/api/admin/rooms/:id", requireAdmin, (req, res) => {
    const removed = store.update((data) => {
      const index = data.rooms.findIndex((room) => room.id === req.params.id);
      if (index === -1) throw new HttpError(404, "Room not found");
      const [room] = data.rooms.splice(index, 1);
      const images = data.images.filter((image) => image.roomId === room!.id);
      data.images = data.images.filter((image) => image.roomId !== room!.id);
      data.connections = data.connections.filter((connection) => connection.roomId !== room!.id);
      data.connectTokens = data.connectTokens.filter((token) => token.roomId !== room!.id);
      data.devices = data.devices.filter((device) => device.roomId !== room!.id);
      data.oauthStates = data.oauthStates.filter((state) => state.roomId !== room!.id);
      data.sessions = data.sessions.filter((session) => session.roomId !== room!.id);
      return images;
    });
    for (const image of removed) {
      rmSync(path.join(uploadDir, image.filename), { force: true });
    }
    res.status(204).end();
  });

  app.post(
    "/api/admin/rooms/:id/images",
    requireAdmin,
    upload.single("file"),
    route((req, res) => {
      const file = req.file;
      if (!file) throw new HttpError(400, "Choose an image");
      if (!IMAGE_TYPES.has(file.mimetype)) throw new HttpError(400, "Use a JPEG, PNG, WebP, or GIF");
      const roomId = req.params.id;
      const existing = store.read().rooms.find((room) => room.id === roomId);
      if (!existing) throw new HttpError(404, "Room not found");
      const id = createId();
      const extension = extensionFor(file.mimetype);
      const filename = `${id}${extension}`;
      writeFileSync(path.join(uploadDir, filename), file.buffer);
      const label = typeof req.body?.label === "string" && req.body.label.trim() ? req.body.label.trim() : file.originalname;
      const image = {
        id,
        roomId,
        filename,
        mimeType: file.mimetype,
        label: label.slice(0, 120),
        createdAt: new Date().toISOString(),
      };
      store.update((data) => {
        const room = findRoom(data.rooms, roomId);
        data.images.push(image);
        if (!room.backgroundImageId) room.backgroundImageId = image.id;
        room.updatedAt = new Date().toISOString();
      });
      res.status(201).json({ image: { id: image.id, url: mediaUrl(config.publicApiUrl, image.id), label: image.label } });
    }),
  );

  app.delete("/api/admin/rooms/:id/images/:imageId", requireAdmin, (req, res) => {
    const removed = store.update((data) => {
      findRoom(data.rooms, req.params.id);
      const index = data.images.findIndex((image) => image.id === req.params.imageId && image.roomId === req.params.id);
      if (index === -1) throw new HttpError(404, "Image not found");
      const [image] = data.images.splice(index, 1);
      for (const room of data.rooms) {
        if (room.backgroundImageId === image!.id) {
          room.backgroundImageId = data.images.find((item) => item.roomId === room.id)?.id ?? null;
          room.updatedAt = new Date().toISOString();
        }
      }
      return image!;
    });
    rmSync(path.join(uploadDir, removed.filename), { force: true });
    res.status(204).end();
  });

  app.post("/api/admin/rooms/:id/connections/:provider", requireAdmin, (req, res) => {
    const provider = calendarProvider(req.params.provider);
    const room = findRoom(store.read().rooms, req.params.id);
    const state = createId();
    store.update((data) => {
      data.oauthStates = data.oauthStates.filter((item) => new Date(item.expiresAt).getTime() > Date.now());
      data.oauthStates.push({
        id: state,
        roomId: room.id,
        provider,
        expiresAt: new Date(Date.now() + OAUTH_TTL_MS).toISOString(),
      });
    });
    const url = provider === "google" ? googleAuthUrl(config, state) : microsoftAuthUrl(config, state);
    res.json({ url });
  });

  app.delete("/api/admin/rooms/:id/connections/:connectionId", requireAdmin, (req, res) => {
    store.update((data) => {
      findRoom(data.rooms, req.params.id);
      const index = data.connections.findIndex(
        (connection) => connection.id === req.params.connectionId && connection.roomId === req.params.id,
      );
      if (index === -1) throw new HttpError(404, "Connection not found");
      data.connections.splice(index, 1);
    });
    res.status(204).end();
  });

  app.post("/api/admin/rooms/:id/connect", requireAdmin, (req, res) => {
    const code = createConnectCode();
    const expiresAt = new Date(Date.now() + CONNECT_TTL_MS).toISOString();
    store.update((data) => {
      const room = findRoom(data.rooms, req.params.id);
      if (room.status !== "active") throw new HttpError(400, "Retired rooms cannot connect a panel");
      data.connectTokens = data.connectTokens.filter((token) => token.roomId !== room.id || token.usedAt);
      data.connectTokens.push({
        id: createId(),
        roomId: room.id,
        tokenHash: hashSecret(code),
        expiresAt,
        usedAt: null,
        createdAt: new Date().toISOString(),
      });
    });
    res.status(201).json({ token: code, display: formatConnectCode(code), expiresAt });
  });

  app.delete("/api/admin/devices/:id", requireAdmin, (req, res) => {
    store.update((data) => {
      const device = data.devices.find((item) => item.id === req.params.id);
      if (!device) throw new HttpError(404, "Display not found");
      device.revokedAt = new Date().toISOString();
    });
    res.status(204).end();
  });

  app.get(
    "/api/oauth/:provider/callback",
    route(async (req, res) => {
      const provider = calendarProvider(req.params.provider);
      const stateId = typeof req.query.state === "string" ? req.query.state : "";
      const oauthError = typeof req.query.error === "string" ? req.query.error : "";
      const state = store.read().oauthStates.find((item) => item.id === stateId && item.provider === provider);
      if (!state || new Date(state.expiresAt).getTime() < Date.now()) {
        redirectAdmin(res, config, "", "The connection attempt expired. Try Connect again.");
        return;
      }
      if (oauthError) {
        consumeState(store, state.id);
        redirectAdmin(res, config, state.roomId, oauthError);
        return;
      }
      const code = typeof req.query.code === "string" ? req.query.code : "";
      if (!code) throw new HttpError(400, "Missing authorization code");
      const token = provider === "google" ? await exchangeGoogleCode(config, code) : await exchangeMicrosoftCode(config, code);
      const accountLabel =
        provider === "google" ? await googleAccountLabel(token.access_token) : await microsoftAccountLabel(token.access_token);
      store.update((data) => {
        data.oauthStates = data.oauthStates.filter((item) => item.id !== state.id);
        const connection = {
          id: createId(),
          roomId: state.roomId,
          provider,
          accountLabel,
          accessToken: token.access_token,
          refreshToken: token.refresh_token ?? null,
          expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
          scope: token.scope ?? "",
          lastError: null,
          createdAt: new Date().toISOString(),
        };
        if (provider === "google") applyToken(connection, token);
        else applyMicrosoftToken(connection, token);
        data.connections.push(connection);
        const room = data.rooms.find((item) => item.id === state.roomId);
        if (room) room.updatedAt = new Date().toISOString();
      });
      redirectAdmin(res, config, state.roomId);
    }),
  );

  app.post(
    "/api/display/redeem",
    route((req, res) => {
      const code = normalizeConnectCode(stringField(req.body?.token, "Connect token"));
      const label = typeof req.body?.label === "string" && req.body.label.trim() ? req.body.label.trim().slice(0, 80) : "Panel";
      if (code.length < 8) throw new HttpError(400, "Enter the full Connect token");
      const deviceToken = createDeviceToken();
      const device = store.update((data) => {
        const token = data.connectTokens.find((item) => secretsMatch(code, item.tokenHash));
        if (!token) throw new HttpError(400, "That Connect token is not valid");
        if (token.usedAt) throw new HttpError(400, "That Connect token was already used");
        if (new Date(token.expiresAt).getTime() < Date.now()) throw new HttpError(400, "That Connect token has expired");
        const room = findRoom(data.rooms, token.roomId);
        if (room.status !== "active") throw new HttpError(400, "This room is retired");
        token.usedAt = new Date().toISOString();
        const created = {
          id: createId(),
          roomId: room.id,
          tokenHash: hashSecret(deviceToken),
          label,
          createdAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
          revokedAt: null,
        };
        data.devices.push(created);
        return { id: created.id, roomId: room.id };
      });
      res.status(201).json({ deviceToken, roomId: device.roomId, deviceId: device.id });
    }),
  );

  app.get(
    "/api/display/state",
    route(async (req, res) => {
      const { device, room } = requireDevice(req);
      store.update((data) => {
        const current = data.devices.find((item) => item.id === device.id);
        if (current) current.lastSeenAt = new Date().toISOString();
      });
      const fresh = store.read();
      const currentRoom = findRoom(fresh.rooms, room.id);
      const { meetings, sources } = await loadRoomMeetings(store, config, currentRoom.id, currentRoom.timezone);
      const display = resolveDisplaySettings(fresh.displayDefaults, currentRoom.displayOverrides);
      res.json({
        room: presentDisplayRoom(fresh, currentRoom, config.publicApiUrl),
        meetings,
        sources,
        share: normalizeShare(currentRoom.share),
        display,
      });
    }),
  );

  app.post(
    "/api/display/share/sessions",
    route(async (req, res) => {
      const { device, room } = requireDevice(req);
      const share = normalizeShare(room.share);
      if (!share.roomCode) throw new HttpError(403, "Room code sharing is turned off for this room");
      const code = createConnectCode().slice(0, 6);
      const ttlMs = share.codeRotateMinutes * 60 * 1000;
      createShareSession({ code, roomId: room.id, deviceId: device.id, ttlMs });
      const shareUrl = joinCodeUrl(config.shareWebOrigin, code);
      const qrDataUrl = await QRCode.toDataURL(shareUrl, { margin: 1, width: 480, errorCorrectionLevel: "M" });
      res.status(201).json({
        code,
        shareUrl,
        qrDataUrl,
        expiresAt: new Date(Date.now() + ttlMs).toISOString(),
        iceServers: iceServers(config),
      });
    }),
  );

  app.post(
    "/api/display/session",
    route((req, res) => {
      const { room } = requireDevice(req);
      const openedBy = parseOpenedBy(req.body?.openedBy);
      const session = store.update((data) => ensureSession(data, room.id, openedBy));
      res.json({ session: presentSession(session, config) });
    }),
  );

  app.get(
    "/api/display/session",
    route((req, res) => {
      const { room } = requireDevice(req);
      const session = store.read().sessions.find((item) => item.roomId === room.id && item.endedAt === null);
      res.json({ session: session ? presentSession(session, config) : null });
    }),
  );

  app.post(
    "/api/display/session/end",
    route((req, res) => {
      const { room } = requireDevice(req);
      const session = store.update((data) => endOpenSession(data, room.id));
      closeWhiteboard(store, session.code);
      res.json({ session: presentSession(session, config) });
    }),
  );

  app.get(
    "/api/display/update",
    route((req, res) => {
      requireDevice(req);
      res.json({ release: presentRelease(store.read().appRelease) });
    }),
  );

  app.get(
    "/api/display/update/apk",
    route((req, res) => {
      requireDevice(req);
      const release = store.read().appRelease;
      if (!release) throw new HttpError(404, "No app update is published");
      const file = path.join(releaseDir, APK_FILENAME);
      res.type("application/vnd.android.package-archive");
      res.download(file, `smart-room-${release.versionName}.apk`);
    }),
  );

  app.post(
    "/api/display/debug-logs",
    route((req, res) => {
      const { device, room } = requireDevice(req);
      let lines;
      try {
        lines = normalizeDebugLines((req.body as { lines?: unknown } | undefined)?.lines);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "Debug logs are invalid");
      }
      if (lines.length === 0) throw new HttpError(400, "There are no debug lines to send");
      const report = {
        id: createId(),
        deviceId: device.id,
        deviceLabel: device.label,
        roomId: room.id,
        roomName: room.name,
        submittedAt: new Date().toISOString(),
        lines,
      };
      debugLogs.save(report);
      res.status(201).json({ id: report.id, submittedAt: report.submittedAt, lineCount: lines.length });
    }),
  );

  app.get("/api/admin/debug-logs", requireAdmin, (_req, res) => {
    res.json({ reports: debugLogs.list() });
  });

  app.get("/api/admin/debug-logs/:id/export", requireAdmin, (req, res) => {
    const report = debugLogs.read(req.params.id);
    if (!report) {
      res.status(404).json({ error: "Debug log not found" });
      return;
    }
    const stamp = report.submittedAt.replace(/[:.]/g, "-");
    res.type("text/plain; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="debug-${stamp}.log"`);
    res.send(formatDebugReport(report));
  });

  app.get("/api/admin/debug-logs/:id", requireAdmin, (req, res) => {
    const report = debugLogs.read(req.params.id);
    if (!report) {
      res.status(404).json({ error: "Debug log not found" });
      return;
    }
    res.json({ report, text: formatDebugReport(report) });
  });

  app.delete("/api/admin/debug-logs/:id", requireAdmin, (req, res) => {
    if (!debugLogs.remove(req.params.id)) {
      res.status(404).json({ error: "Debug log not found" });
      return;
    }
    res.status(204).end();
  });

  app.get("/api/whiteboard/:code", (req, res) => {
    const code = normalizeConnectCode(req.params.code);
    const session = sessionByCode(store.read(), code);
    if (!session) {
      res.status(404).json({ error: "This whiteboard is not available" });
      return;
    }
    if (session.endedAt) {
      res.json({ open: false });
      return;
    }
    const scene = liveScene(code) ?? session.whiteboard;
    res.json({ open: true, code: session.code, elements: scene.elements, files: scene.files });
  });

  app.get("/api/share/:code", (req, res) => {
    const session = getShareSession(normalizeConnectCode(req.params.code));
    if (!session) {
      res.status(404).json({ error: "This room code is not active" });
      return;
    }
    res.json({
      code: session.code,
      expiresAt: new Date(session.expiresAt).toISOString(),
      iceServers: iceServers(config),
    });
  });

  app.get("/media/:id", (req, res) => {
    const image = store.read().images.find((item) => item.id === req.params.id);
    if (!image) {
      res.status(404).end();
      return;
    }
    res.type(image.mimeType).sendFile(path.join(uploadDir, image.filename));
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ error: "Images must be 8 MB or smaller" });
      return;
    }
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Request failed";
    if (status === 500) console.error(error);
    res.status(status).json({ error: message });
  });

  function acceptApk(req: Request, res: Response, next: NextFunction) {
    apkUpload.single("file")(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        next(new HttpError(400, "The APK must be 180 MB or smaller"));
        return;
      }
      next(error);
    });
  }

  function requireAdmin(req: Request, res: Response, next: NextFunction) {
    const bearer = bearerToken(req);
    const expected = adminToken(config.adminPassword);
    const left = Buffer.from(bearer);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      res.status(401).json({ error: "Admin sign-in required" });
      return;
    }
    next();
  }

  function requireDevice(req: Request) {
    const bearer = bearerToken(req);
    const data = store.read();
    const device = data.devices.find((item) => !item.revokedAt && secretsMatch(bearer, item.tokenHash));
    if (!device) throw new HttpError(401, "This panel is not connected");
    const room = data.rooms.find((item) => item.id === device.roomId);
    if (!room || room.status !== "active") throw new HttpError(403, "This room is not available");
    return { device, room };
  }

  return { app, store, config };
}

function route(fn: (req: Request, res: Response) => Promise<void> | void) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      Promise.resolve(fn(req, res)).catch(next);
    } catch (error) {
      next(error);
    }
  };
}

function bearerToken(req: Request): string {
  const header = req.header("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `${label} is required`);
  return value.trim().slice(0, 80);
}

function optionalTimezone(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requireTimezone(value);
}

function requireTimezone(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, "Timezone is required");
  const timezone = value.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    throw new HttpError(400, "Timezone must be an IANA name, such as Asia/Colombo");
  }
  return timezone;
}

function optionalMeta(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Meta must be an object");
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 20) throw new HttpError(400, "Meta can have at most 20 fields");
  const meta: Record<string, string> = {};
  for (const [key, entry] of entries) {
    const name = key.trim().slice(0, 40);
    if (!name) continue;
    if (typeof entry !== "string") throw new HttpError(400, "Meta values must be text");
    meta[name] = entry.trim().slice(0, 200);
  }
  return meta;
}

function parseShare(value: unknown, current: RoomShare): RoomShare {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Share settings are invalid");
  const body = value as Partial<RoomShare>;
  const oemPackage =
    body.oemPackage === undefined ? current.oemPackage : body.oemPackage === null || body.oemPackage === "" ? null : String(body.oemPackage).trim();
  if (oemPackage && !/^[A-Za-z][\w]*(\.[A-Za-z][\w]*)+$/.test(oemPackage)) {
    throw new HttpError(400, "OEM package must look like com.vendor.share");
  }
  return {
    roomCode: booleanField(body.roomCode, current.roomCode),
    oem: booleanField(body.oem, current.oem),
    oemPackage,
    googleCast: booleanField(body.googleCast, current.googleCast),
    miracast: booleanField(body.miracast, current.miracast),
    airplay: booleanField(body.airplay, current.airplay),
    codeRotateMinutes: rotateMinutes(body.codeRotateMinutes, current.codeRotateMinutes),
  };
}

function booleanField(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function defaultShare(): RoomShare {
  return { roomCode: true, oem: false, oemPackage: null, googleCast: false, miracast: false, airplay: false, codeRotateMinutes: 15 };
}

function rotateMinutes(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const minutes = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) {
    throw new HttpError(400, "Rotate the share code every 1 to 180 minutes");
  }
  return minutes;
}

function normalizeShare(share: Partial<RoomShare> | null | undefined): RoomShare {
  const defaults = defaultShare();
  const source = share ?? {};
  return {
    roomCode: typeof source.roomCode === "boolean" ? source.roomCode : defaults.roomCode,
    oem: typeof source.oem === "boolean" ? source.oem : defaults.oem,
    oemPackage: typeof source.oemPackage === "string" && source.oemPackage ? source.oemPackage : null,
    googleCast: typeof source.googleCast === "boolean" ? source.googleCast : defaults.googleCast,
    miracast: typeof source.miracast === "boolean" ? source.miracast : defaults.miracast,
    airplay: typeof source.airplay === "boolean" ? source.airplay : defaults.airplay,
    codeRotateMinutes: rotateMinutes(source.codeRotateMinutes, defaults.codeRotateMinutes),
  };
}

function findRoom(rooms: Room[], id: string): Room {
  const room = rooms.find((item) => item.id === id);
  if (!room) throw new HttpError(404, "Room not found");
  return room;
}

function calendarProvider(value: string): CalendarProvider {
  if (value !== "google" && value !== "microsoft") throw new HttpError(404, "Unknown calendar provider");
  return value;
}

function extensionFor(mimeType: string): string {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  return ".jpg";
}

function mediaUrl(base: string, imageId: string): string {
  return `${base}/media/${imageId}`;
}

function summarizeRoom(data: ReturnType<Store["read"]>, room: Room, base: string) {
  const hasBackground = Boolean(room.backgroundImageId && data.images.some((image) => image.id === room.backgroundImageId));
  return {
    id: room.id,
    name: room.name,
    timezone: room.timezone,
    status: room.status,
    updatedAt: room.updatedAt,
    backgroundUrl: hasBackground ? mediaUrl(base, room.backgroundImageId!) : null,
    displayCount: data.devices.filter((device) => device.roomId === room.id && !device.revokedAt).length,
    connectionCount: data.connections.filter((connection) => connection.roomId === room.id).length,
  };
}

function presentAdminRoom(data: ReturnType<Store["read"]>, room: Room, base: string) {
  return {
    id: room.id,
    name: room.name,
    timezone: room.timezone,
    meta: room.meta,
    status: room.status,
    share: normalizeShare(room.share),
    display: resolveDisplaySettings(data.displayDefaults, room.displayOverrides),
    displayOverrides: room.displayOverrides,
    backgroundImageId: room.backgroundImageId,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    images: data.images
      .filter((image) => image.roomId === room.id)
      .map((image) => ({ id: image.id, url: mediaUrl(base, image.id), label: image.label })),
    connections: data.connections
      .filter((connection) => connection.roomId === room.id)
      .map((connection) => ({
        id: connection.id,
        provider: connection.provider,
        accountLabel: connection.accountLabel,
        lastError: connection.lastError,
        createdAt: connection.createdAt,
      })),
    devices: data.devices
      .filter((device) => device.roomId === room.id)
      .map((device) => ({
        id: device.id,
        label: device.label,
        createdAt: device.createdAt,
        lastSeenAt: device.lastSeenAt,
        revokedAt: device.revokedAt,
      })),
    sessions: data.sessions
      .filter((session) => session.roomId === room.id)
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
      .map((session) => ({
        id: session.id,
        openedAt: session.openedAt,
        endedAt: session.endedAt,
        whiteboardUpdatedAt: session.whiteboard.updatedAt,
      })),
  };
}

function presentSession(session: RoomSession, config: Config) {
  return {
    id: session.id,
    code: session.code,
    openedAt: session.openedAt,
    endedAt: session.endedAt,
    whiteboardUrl: joinCodeUrl(config.whiteboardWebOrigin, session.code),
    whiteboardUpdatedAt: session.whiteboard.updatedAt,
  };
}

function presentDisplayRoom(data: ReturnType<Store["read"]>, room: Room, base: string) {
  return {
    id: room.id,
    name: room.name,
    timezone: room.timezone,
    meta: room.meta,
    backgroundUrl: room.backgroundImageId ? mediaUrl(base, room.backgroundImageId) : null,
    images: data.images
      .filter((image) => image.roomId === room.id)
      .map((image) => ({ id: image.id, url: mediaUrl(base, image.id), label: image.label })),
  };
}

function consumeState(store: Store, id: string) {
  store.update((data) => {
    data.oauthStates = data.oauthStates.filter((item) => item.id !== id);
  });
}

function joinCodeUrl(origin: string, code: string) {
  return `${origin.replace(/\/$/, "")}/${code}`;
}

function browserOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/$/, "");
  }
}

function redirectAdmin(res: Response, config: Config, roomId: string, error?: string) {
  const base = config.adminOrigin.replace(/\/$/, "");
  const url = new URL(roomId ? `${base}/rooms/${roomId}` : `${base}/`);
  if (error) url.searchParams.set("error", error);
  else if (roomId) url.searchParams.set("connected", "1");
  res.redirect(url.toString());
}

function timingSafeEqual(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left[i]! ^ right[i]!;
  return mismatch === 0;
}
