import type { PanelSession, ShareSession } from "./types";

export function lanAddress(ip: string) {
  const value = ip.trim();
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return "";
  if (value === "0.0.0.0" || value.startsWith("127.")) return "";
  return value;
}

export function lanIpInjection(ip: string) {
  return `window.setLanIp(${JSON.stringify(lanAddress(ip))}); true;`;
}

export function receiverDocument(share: ShareSession, session: PanelSession, lanIp = "") {
  const config = JSON.stringify({
    signalingUrl: signalingUrl(session.controlApiUrl, share.code, session.deviceToken),
    iceServers: share.iceServers ?? [],
    lanIp: lanAddress(lanIp),
  }).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    html, body { margin: 0; height: 100%; background: #000; }
    #grid {
      position: fixed;
      inset: 0;
      display: grid;
      gap: 4px;
      background: #000;
      grid-template-rows: 1fr;
    }
    #grid[data-count="2"] { grid-template-columns: 1fr 1fr; }
    #grid[data-count="3"] { grid-template-columns: 1fr 1fr 1fr; }
    #grid[data-count="4"] { grid-template-columns: 1fr 1fr 1fr 1fr; }
    .cell { position: relative; min-width: 0; min-height: 0; background: #000; overflow: hidden; }
    .cell img, .cell video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; }
    .cell video { opacity: 0; z-index: 1; }
    .cell video.on { opacity: 1; }
    .cell[data-state="paused"] video { opacity: 0; }
    .freeze-badge {
      position: absolute;
      top: 14px;
      right: 14px;
      z-index: 2;
      display: none;
      width: 38px;
      height: 38px;
      place-items: center;
      border-radius: 999px;
      color: #fff;
      background: rgba(16, 20, 16, 0.72);
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
      font: 20px sans-serif;
    }
    .cell[data-state="frozen"] .freeze-badge { display: grid; }
    .path-badge {
      position: absolute;
      right: 14px;
      bottom: 14px;
      z-index: 3;
      padding: 6px 10px;
      border-radius: 999px;
      font: 600 12px/1.2 system-ui, sans-serif;
      letter-spacing: 0.02em;
      color: #eef6f1;
      background: rgba(16, 20, 16, 0.72);
      pointer-events: none;
    }
    .meter {
      position: absolute;
      left: 14px;
      bottom: calc(14px + var(--meter-lift, 0px));
      z-index: 3;
      display: none;
      max-width: calc(100% - 28px);
      padding: 8px 12px;
      border-radius: 999px;
      color: #fff;
      background: rgba(16, 20, 16, 0.72);
      font: 600 16px sans-serif;
    }
    html[data-meters="1"] .meter { display: block; }
    #soundbar {
      position: fixed;
      right: var(--sound-right, 22px);
      bottom: var(--sound-bottom, 132px);
      z-index: 6;
      display: none;
      align-items: center;
      gap: 8px;
      width: 148px;
      height: 28px;
      padding: 0 10px;
      box-sizing: border-box;
      border-radius: 999px;
      color: #fff;
      background: rgba(16, 20, 16, 0.72);
      pointer-events: none;
    }
    html[data-debug="1"] #soundbar { display: flex; }
    .soundbar-label {
      font: 600 11px/1 system-ui, sans-serif;
      letter-spacing: 0.04em;
      color: #8dceba;
    }
    .soundbar-track {
      flex: 1;
      height: 8px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.16);
      overflow: hidden;
    }
    #soundbar-fill {
      display: block;
      width: 0%;
      height: 100%;
      border-radius: 999px;
      background: #8dceba;
    }
  </style>
</head>
<body>
  <div id="grid" data-count="0"></div>
  <div id="soundbar" aria-hidden="true">
    <span class="soundbar-label">in</span>
    <span class="soundbar-track"><span id="soundbar-fill"></span></span>
  </div>
  <script>
    const config = ${config};
    const grid = document.getElementById("grid");
    const slots = new Map();
    const dropped = new Set();
    let order = [];
    let frames = 0;
    let latency = "skip";
    let lastMeterLog = 0;
    let lastAudioLog = 0;
    let soundLevel = 0;
    let audioSampling = false;
    const queueCap = 6;
    const FRAME_POLL_MS = 250;
    const FRAME_WATCH_MS = 4000;
    window.__lanIp = config.lanIp || "";
    window.__meters = { fps: false, resolution: false };
    window.__debug = false;
    const ws = new WebSocket(config.signalingUrl);
    ws.binaryType = "arraybuffer";

    function post(message) {
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
    }
    function log(text) {
      post({ type: "log", text: "[receiver] " + text });
    }
    try {
      var target = new URL(config.signalingUrl);
      target.searchParams.delete("token");
      log("connecting " + target.origin + target.pathname);
    } catch (error) {
      log("signaling url could not be read");
    }

    function rewriteCandidate(candidate) {
      if (!candidate || typeof candidate.candidate !== "string" || !window.__lanIp) return candidate;
      const parts = candidate.candidate.split(" ");
      const typeAt = parts.indexOf("typ");
      if (typeAt < 0 || parts[typeAt + 1] !== "host") return candidate;
      const address = parts[4] || "";
      if (address.slice(-6) !== ".local") return candidate;
      parts[4] = window.__lanIp;
      const rewritten = {};
      for (const key in candidate) rewritten[key] = candidate[key];
      rewritten.candidate = parts.join(" ");
      return rewritten;
    }

    window.setLanIp = function (ip) {
      if (!ip || ip === "0.0.0.0" || ip === window.__lanIp) return;
      window.__lanIp = ip;
      log("lan address ready");
      slots.forEach(function (entry, slot) {
        (entry.localHost || []).forEach(function (candidate) {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(JSON.stringify({ type: "ice", slot: slot, candidate: rewriteCandidate(candidate) }));
        });
      });
    };

    function visibleSlots() {
      return order.filter((slot) => {
        const entry = slots.get(slot);
        return entry && entry.shown;
      });
    }

    function layout() {
      const visible = visibleSlots();
      for (const slot of visible) grid.appendChild(slots.get(slot).cell);
      grid.dataset.count = String(visible.length);
      post(visible.length ? { type: "video" } : { type: "idle" });
      post({ type: "clients", slots: order.slice() });
    }

    function applyView(entry) {
      const state = entry.cell.dataset.state || "live";
      if (state === "live" && entry.direct) entry.video.play().catch(function () {});
      else entry.video.pause();
    }

    function clearFrameWatch(entry) {
      window.clearTimeout(entry.frameWatch);
      window.clearInterval(entry.framePoll);
      entry.frameWatch = 0;
      entry.framePoll = 0;
    }

    function tryShowDirect(entry, slot, reason) {
      if (entry.direct || !entry.pc) return false;
      if (entry.video.readyState < 2 && entry.video.videoWidth < 2) return false;
      clearFrameWatch(entry);
      showDirect(entry, slot);
      if (reason) log("native via " + reason + " slot " + slot);
      return true;
    }

    function forceJpegFriendlyConfig() {
      if (ws.readyState !== WebSocket.OPEN) return;
      const picture = window.__picture || {};
      const next = {
        type: "config",
        width: 1280,
        fps: typeof picture.fps === "number" ? picture.fps : 0,
        quality: Math.min(0.75, typeof picture.quality === "number" ? picture.quality : 0.75),
        latency: picture.latency === "queue" ? "queue" : "skip",
      };
      log("jpeg fallback config width=1280 quality=" + next.quality);
      ws.send(JSON.stringify(next));
    }

    function requestRenegotiate(entry, slot, reason) {
      if (entry.renegotiateSent || entry.direct) return;
      entry.renegotiateSent = true;
      clearFrameWatch(entry);
      log("no video frames slot " + slot + " readyState=" + entry.video.readyState + " " + reason);
      forceJpegFriendlyConfig();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "renegotiate", slot: slot, reason: reason || "no-frames" }));
      }
      // Stats help confirm silent decode failure (framesDecoded stays 0).
      if (entry.pc && entry.pc.getStats) {
        entry.pc.getStats().then(function (stats) {
          stats.forEach(function (report) {
            if (report.type !== "inbound-rtp") return;
            if (report.kind && report.kind !== "video") return;
            log(
              "inbound-rtp slot " + slot +
              " framesDecoded=" + (report.framesDecoded || 0) +
              " bytesReceived=" + (report.bytesReceived || 0) +
              " packetsLost=" + (report.packetsLost || 0)
            );
          });
        }).catch(function () {});
      }
    }

    function armFrameWatch(entry, slot, generation) {
      clearFrameWatch(entry);
      entry.renegotiateSent = false;
      entry.framePoll = window.setInterval(function () {
        if (entry.generation !== generation || entry.direct) {
          clearFrameWatch(entry);
          return;
        }
        if (!entry.pc || entry.pc.connectionState !== "connected") return;
        const track = entry.video.srcObject && entry.video.srcObject.getVideoTracks
          ? entry.video.srcObject.getVideoTracks()[0]
          : null;
        log(
          "video wait slot " + slot +
          " readyState=" + entry.video.readyState +
          " size=" + (entry.video.videoWidth || 0) + "x" + (entry.video.videoHeight || 0) +
          (track ? " muted=" + track.muted + " enabled=" + track.enabled : " no-track")
        );
        tryShowDirect(entry, slot, "poll");
      }, FRAME_POLL_MS);
      entry.frameWatch = window.setTimeout(function () {
        if (entry.generation !== generation || entry.direct) return;
        if (entry.pc && entry.pc.connectionState === "connected") {
          requestRenegotiate(entry, slot, "connected-without-frames");
        }
      }, FRAME_WATCH_MS);
    }

    function showDirect(entry, slot) {
      if (entry.direct) return;
      entry.direct = true;
      clearFrameWatch(entry);
      entry.video.classList.add("on");
      applyView(entry);
      if (!entry.shown) {
        entry.shown = true;
        layout();
      }
      entry.arrivals = [];
      entry.fps = 0;
      armFrames(entry);
      paintMeter(entry);
      log("native video slot " + slot);
      reportPath(entry, slot);
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "video-ready", slot: slot }));
    }

    function hideDirect(entry, slot) {
      if (!entry.direct) return;
      entry.direct = false;
      entry.video.classList.remove("on");
      entry.playToken += 1;
      entry.video.muted = true;
      entry.video.pause();
      entry.arrivals = [];
      entry.fps = 0;
      paintMeter(entry);
      log("jpeg picture slot " + slot);
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "video-stopped", slot: slot }));
    }

    function closePeer(entry) {
      window.clearTimeout(entry.dropTimer);
      entry.dropTimer = 0;
      clearFrameWatch(entry);
      entry.remoteReady = false;
      entry.pendingIce = [];
      entry.renegotiateSent = false;
      const pc = entry.pc;
      entry.pc = null;
      if (!pc) return;
      pc.onconnectionstatechange = null;
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.close();
      entry.media = null;
      entry.playToken += 1;
      entry.video.muted = true;
      entry.video.srcObject = null;
    }

    function slotAudible(entry) {
      const state = entry.cell.dataset.state || "live";
      if (state === "paused" || state === "frozen") return false;
      const stream = entry.media;
      if (!stream) return false;
      const tracks = stream.getAudioTracks();
      for (let index = 0; index < tracks.length; index += 1) {
        if (tracks[index].readyState === "live") return true;
      }
      return false;
    }

    function logSound(entry, slot, reason) {
      const stream = entry.media;
      const tracks = stream ? stream.getAudioTracks() : [];
      let live = 0;
      let trackMuted = 0;
      for (let index = 0; index < tracks.length; index += 1) {
        if (tracks[index].readyState === "live") live += 1;
        if (tracks[index].muted) trackMuted += 1;
      }
      log(
        "sound " + reason + " slot " + slot +
        " audioTracks=" + tracks.length +
        " live=" + live +
        " trackMuted=" + trackMuted +
        " videoMuted=" + entry.video.muted
      );
    }

    function paintSoundBar() {
      const fill = document.getElementById("soundbar-fill");
      if (!fill) return;
      const level = Math.max(0, Math.min(1, soundLevel));
      fill.style.width = Math.round(level * 100) + "%";
    }

    function noteAudioStats() {
      let max = 0;
      slots.forEach(function (entry) {
        if (!entry.pc) return;
        if (typeof entry.audioLevel === "number" && entry.audioLevel > max) max = entry.audioLevel;
      });
      soundLevel = max;
      paintSoundBar();
      if (!window.__debug) return;
      const now = performance.now();
      if (now - lastAudioLog < 2000) return;
      lastAudioLog = now;
      slots.forEach(function (entry, slot) {
        if (!entry.pc) return;
        const tracks = entry.media ? entry.media.getAudioTracks() : [];
        if (!entry.audioFound && tracks.length === 0) return;
        log(
          "sound rtp slot " + slot +
          " bytes=" + (entry.audioBytes || 0) +
          " packets=" + (entry.audioPackets || 0) +
          " lost=" + (entry.audioLost || 0) +
          " level=" + (Math.round((entry.audioLevel || 0) * 100) / 100) +
          " videoMuted=" + entry.video.muted
        );
      });
    }

    function sampleAudio(entry) {
      if (!entry.pc || !entry.pc.getStats) return Promise.resolve();
      return entry.pc.getStats().then(function (stats) {
        let level = 0;
        let bytes = 0;
        let packets = 0;
        let lost = 0;
        let found = false;
        let hasLevel = false;
        let energy = null;
        stats.forEach(function (report) {
          if (report.type !== "inbound-rtp") return;
          const kind = report.kind || report.mediaType;
          if (kind !== "audio") return;
          const reportBytes = report.bytesReceived || 0;
          if (!found || reportBytes >= bytes) {
            bytes = reportBytes;
            packets = report.packetsReceived || 0;
            lost = report.packetsLost || 0;
          }
          found = true;
          if (typeof report.audioLevel === "number") {
            hasLevel = true;
            level = Math.max(level, report.audioLevel);
          } else if (typeof report.totalAudioEnergy === "number") {
            energy = report.totalAudioEnergy;
          }
        });
        if (found && !hasLevel && typeof energy === "number") {
          const now = performance.now();
          const prevEnergy = entry.audioEnergy;
          const prevAt = entry.audioEnergyAt || now;
          entry.audioEnergy = energy;
          entry.audioEnergyAt = now;
          if (typeof prevEnergy === "number" && prevAt !== now) {
            const dt = Math.max(0.05, (now - prevAt) / 1000);
            level = Math.min(1, Math.sqrt(Math.max(0, energy - prevEnergy) / dt));
          }
        } else if (typeof energy === "number") {
          entry.audioEnergy = energy;
          entry.audioEnergyAt = performance.now();
        }
        entry.audioFound = found;
        entry.audioBytes = bytes;
        entry.audioPackets = packets;
        entry.audioLost = lost;
        entry.audioLevel = level;
      }).catch(function () {});
    }

    function playSlot(entry, slot) {
      const token = ++entry.playToken;
      entry.video.muted = true;
      entry.video.play().then(function () {
        if (entry.playToken !== token) return;
        tryShowDirect(entry, slot, "play");
        if (!slotAudible(entry)) return;
        entry.video.muted = false;
        return entry.video.play().then(function () {
          if (entry.playToken !== token) return;
          logSound(entry, slot, "unmuted");
        }, function (error) {
          if (entry.playToken !== token) return;
          entry.video.muted = true;
          log(
            "sound unmute failed slot " + slot +
            " " + (error && error.message ? error.message : "blocked") +
            " videoMuted=" + entry.video.muted
          );
        });
      }).catch(function (error) {
        if (entry.playToken !== token) return;
        entry.video.muted = true;
        log("video play failed slot " + slot + " " + (error && error.message ? error.message : "blocked"));
        entry.video.play().catch(function () {});
      });
    }

    function syncSound(entry, slot) {
      if (!slotAudible(entry)) {
        entry.playToken += 1;
        entry.video.muted = true;
        return;
      }
      playSlot(entry, slot);
    }

    function ensure(slot) {
      const existing = slots.get(slot);
      if (existing) return existing;
      const cell = document.createElement("div");
      cell.className = "cell";
      const img = document.createElement("img");
      img.alt = "";
      const video = document.createElement("video");
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "true");
      if ("playoutDelayHint" in video) video.playoutDelayHint = 0;
      const badge = document.createElement("span");
      badge.className = "freeze-badge";
      badge.textContent = "❄";
      badge.setAttribute("aria-label", "Frame frozen");
      const meter = document.createElement("div");
      meter.className = "meter";
      const pathBadge = document.createElement("div");
      pathBadge.className = "path-badge";
      pathBadge.textContent = "Web · JPEG";
      cell.appendChild(img);
      cell.appendChild(video);
      cell.appendChild(badge);
      cell.appendChild(meter);
      cell.appendChild(pathBadge);
      const entry = {
        cell: cell,
        img: img,
        video: video,
        meter: meter,
        pathBadge: pathBadge,
        networkKind: "Web",
        arrivals: [],
        fps: 0,
        width: 0,
        height: 0,
        armed: false,
        url: "",
        shown: false,
        busy: false,
        latest: null,
        queue: [],
        pc: null,
        media: null,
        playToken: 0,
        direct: false,
        remoteReady: false,
        pendingIce: [],
        localHost: [],
        dropTimer: 0,
        frameWatch: 0,
        framePoll: 0,
        renegotiateSent: false,
        generation: 0,
        audioLevel: 0,
        audioBytes: 0,
        audioPackets: 0,
        audioLost: 0,
        audioFound: false,
        audioEnergy: 0,
        audioEnergyAt: 0,
      };
      function onVideoReady() {
        tryShowDirect(entry, slot, "video-event");
      }
      video.addEventListener("loadeddata", onVideoReady);
      video.addEventListener("loadedmetadata", onVideoReady);
      video.addEventListener("canplay", onVideoReady);
      video.addEventListener("playing", onVideoReady);
      video.addEventListener("resize", onVideoReady);
      video.addEventListener("error", function () {
        const err = video.error;
        log("video error slot " + slot + " code=" + (err ? err.code : "?") + " " + (err && err.message ? err.message : ""));
      });
      slots.set(slot, entry);
      if (order.indexOf(slot) === -1) order.push(slot);
      return entry;
    }

    function removeSlot(slot) {
      const entry = slots.get(slot);
      if (!entry) return;
      closePeer(entry);
      if (entry.url) URL.revokeObjectURL(entry.url);
      entry.cell.remove();
      slots.delete(slot);
      order = order.filter((item) => item !== slot);
      layout();
    }

    function showBinary(bytes) {
      if (bytes.length < 2) return;
      const slot = bytes[0];
      if (dropped.has(slot)) return;
      const entry = ensure(slot);
      if (entry.direct && entry.cell.dataset.state !== "paused") return;
      const jpeg = bytes.slice(1);
      if (!entry.direct) {
        const size = jpegSize(jpeg);
        if (size) {
          entry.width = size.width;
          entry.height = size.height;
        }
      }
      if (latency === "queue") {
        entry.queue.push(jpeg);
        if (entry.queue.length > queueCap) entry.queue.splice(0, entry.queue.length - queueCap);
        if (!entry.busy) drawNext(entry, slot);
        return;
      }
      entry.queue = [];
      entry.latest = jpeg;
      if (!entry.busy) drawNext(entry, slot);
    }

    function takeFrame(entry) {
      if (latency === "queue") return entry.queue.shift() || null;
      const jpeg = entry.latest;
      entry.latest = null;
      return jpeg;
    }

    function drawNext(entry, slot) {
      const jpeg = takeFrame(entry);
      if (!jpeg) {
        entry.busy = false;
        return;
      }
      entry.busy = true;
      const blob = new Blob([jpeg], { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      const previous = entry.url;
      entry.url = url;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (previous && previous.indexOf("blob:") === 0) URL.revokeObjectURL(previous);
        entry.busy = false;
        frames += 1;
        if (!entry.direct) noteArrival(entry);
        paintMeter(entry);
        const sizeLabel = (entry.width || 0) + "x" + (entry.height || 0);
        if (!entry.shown) {
          entry.shown = true;
          log("jpeg frame " + frames + " slot " + slot + " " + sizeLabel + " bytes " + jpeg.length);
          layout();
        } else if (frames % 90 === 0) {
          log("jpeg frame " + frames + " slot " + slot + " " + sizeLabel + " bytes " + jpeg.length);
        }
        if (entry.direct) return;
        if ((latency === "queue" && entry.queue.length) || entry.latest) drawNext(entry, slot);
      };
      entry.img.onload = finish;
      entry.img.onerror = () => {
        const reader = new FileReader();
        reader.onload = () => {
          entry.img.onerror = null;
          entry.img.onload = finish;
          if (url.indexOf("blob:") === 0) URL.revokeObjectURL(url);
          entry.url = "";
          entry.img.src = String(reader.result || "");
        };
        reader.onerror = finish;
        reader.readAsDataURL(blob);
      };
      entry.img.src = url;
    }

    async function acceptOffer(slot, sdp) {
      const entry = ensure(slot);
      const generation = entry.generation + 1;
      entry.generation = generation;
      entry.localHost = [];
      closePeer(entry);
      if (typeof RTCPeerConnection !== "function") return;
      const pc = new RTCPeerConnection({ iceServers: config.iceServers || [] });
      entry.pc = pc;
      pc.ontrack = function (event) {
        if (entry.generation !== generation) return;
        const track = event.track;
        log(
          "ontrack slot " + slot +
          " kind=" + (track && track.kind) +
          " muted=" + (track ? track.muted : "?") +
          " readyState=" + (track ? track.readyState : "?")
        );
        lowLatency(event.receiver || null);
        lowLatencyList(pc);
        const remote = event.streams && event.streams[0];
        if (remote) {
          entry.media = remote;
        } else {
          if (!entry.media) entry.media = new MediaStream();
          const existing = entry.media.getTracks();
          let found = false;
          for (let index = 0; index < existing.length; index += 1) {
            if (track && existing[index].id === track.id) found = true;
          }
          if (track && !found) entry.media.addTrack(track);
        }
        if (entry.video.srcObject !== entry.media) {
          entry.video.muted = true;
          entry.video.srcObject = entry.media;
        }
        if (track) {
          if (track.kind === "audio") {
            log(
              "sound ontrack slot " + slot +
              " muted=" + track.muted +
              " enabled=" + track.enabled +
              " readyState=" + track.readyState +
              " videoMuted=" + entry.video.muted
            );
          }
          track.addEventListener("unmute", function () {
            log("track unmute slot " + slot + " kind=" + track.kind);
            if (track.kind === "audio") logSound(entry, slot, "unmute");
            playSlot(entry, slot);
            tryShowDirect(entry, slot, "unmute");
          });
          track.addEventListener("mute", function () {
            log("track mute slot " + slot + " kind=" + track.kind);
            if (track.kind === "audio") logSound(entry, slot, "mute");
          });
          track.addEventListener("ended", function () {
            if (track.kind === "audio") logSound(entry, slot, "ended");
            syncSound(entry, slot);
          });
        }
        playSlot(entry, slot);
        if (track && track.kind === "video" && typeof entry.video.requestVideoFrameCallback === "function") {
          entry.video.requestVideoFrameCallback(function () {
            tryShowDirect(entry, slot, "frame");
          });
        }
      };
      pc.onicecandidate = function (event) {
        if (!event.candidate || entry.generation !== generation || ws.readyState !== WebSocket.OPEN) return;
        const json = event.candidate.toJSON();
        const address = String(json.candidate || "").split(" ")[4] || "";
        if (address.slice(-6) === ".local") entry.localHost.push(json);
        ws.send(JSON.stringify({ type: "ice", slot: slot, candidate: rewriteCandidate(json) }));
      };
      pc.onconnectionstatechange = function () {
        if (entry.generation !== generation) return;
        log("connection slot " + slot + " " + pc.connectionState);
        if (pc.connectionState === "connected") {
          window.clearTimeout(entry.dropTimer);
          lowLatencyList(pc);
          playSlot(entry, slot);
          if (!tryShowDirect(entry, slot, "connected")) armFrameWatch(entry, slot, generation);
        }
        if (pc.connectionState === "failed") {
          clearFrameWatch(entry);
          hideDirect(entry, slot);
        }
        if (pc.connectionState === "disconnected") {
          window.clearTimeout(entry.dropTimer);
          entry.dropTimer = window.setTimeout(function () {
            if (entry.generation !== generation) return;
            if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
              clearFrameWatch(entry);
              hideDirect(entry, slot);
            }
          }, 3000);
        }
      };
      await pc.setRemoteDescription(sdp);
      if (entry.generation !== generation) return;
      entry.remoteReady = true;
      while (entry.pendingIce.length) {
        const candidate = entry.pendingIce.shift();
        try { await pc.addIceCandidate(candidate); } catch (error) { log("ice add failed"); }
      }
      if (entry.generation !== generation) return;
      const answer = await pc.createAnswer();
      if (entry.generation !== generation) return;
      await pc.setLocalDescription(answer);
      if (entry.generation !== generation || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "answer", slot: slot, sdp: pc.localDescription }));
    }

    function lowLatency(receiver) {
      if (!receiver || !("jitterBufferTarget" in receiver)) return;
      try { receiver.jitterBufferTarget = 0; } catch (error) {}
    }

    function lowLatencyList(pc) {
      const list = pc.getReceivers ? pc.getReceivers() : [];
      for (let index = 0; index < list.length; index += 1) lowLatency(list[index]);
    }

    function addIce(slot, candidate) {
      if (!candidate) return;
      const entry = ensure(slot);
      if (!entry.pc || !entry.remoteReady) {
        entry.pendingIce.push(candidate);
        return;
      }
      entry.pc.addIceCandidate(candidate).catch(function () { log("ice add failed"); });
    }

    async function reportPath(entry, slot) {
      if (!entry.pc || !entry.pc.getStats) return;
      try {
        const stats = await entry.pc.getStats();
        let pair = null;
        stats.forEach(function (report) {
          if (report.type === "transport" && report.selectedCandidatePairId) pair = stats.get(report.selectedCandidatePairId);
          if (report.type === "candidate-pair" && (report.selected || report.nominated) && report.state === "succeeded") pair = report;
        });
        if (!pair) return;
        const remote = stats.get(pair.remoteCandidateId);
        const local = stats.get(pair.localCandidateId);
        const kind = (remote && remote.candidateType) || (local && local.candidateType) || "unknown";
        entry.networkKind = kind === "host" ? "Direct" : "Web";
        paintPath(entry);
        log("network path slot " + slot + " " + kind);
      } catch (error) {
        log("path unavailable");
      }
    }

    function jpegSize(bytes) {
      if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
      let index = 2;
      while (index + 8 < bytes.length) {
        if (bytes[index] !== 0xff) {
          index += 1;
          continue;
        }
        const marker = bytes[index + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
          index += 2;
          continue;
        }
        const length = (bytes[index + 2] << 8) | bytes[index + 3];
        if (length < 2) return null;
        if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
          return { height: (bytes[index + 5] << 8) | bytes[index + 6], width: (bytes[index + 7] << 8) | bytes[index + 8] };
        }
        index += 2 + length;
      }
      return null;
    }

    function currentFps(entry) {
      const now = performance.now();
      const cutoff = now - 2000;
      while (entry.arrivals.length && entry.arrivals[0] < cutoff) entry.arrivals.shift();
      if (entry.arrivals.length < 2) return entry.arrivals.length;
      const span = entry.arrivals[entry.arrivals.length - 1] - entry.arrivals[0];
      return span > 0 ? Math.max(1, Math.round(((entry.arrivals.length - 1) * 1000) / span)) : entry.arrivals.length;
    }

    function noteArrival(entry) {
      entry.arrivals.push(performance.now());
      entry.fps = currentFps(entry);
    }

    function armFrames(entry) {
      if (entry.armed || typeof entry.video.requestVideoFrameCallback !== "function") return;
      entry.armed = true;
      const tick = function () {
        if (entry.direct) noteArrival(entry);
        if (entry.video.srcObject) entry.video.requestVideoFrameCallback(tick);
        else entry.armed = false;
      };
      entry.video.requestVideoFrameCallback(tick);
    }

    function paintPath(entry) {
      const network = entry.networkKind || (entry.direct ? "Direct" : "Web");
      const picture = entry.direct ? "Native" : "JPEG";
      entry.pathBadge.textContent = network + " · " + picture;
    }

    function paintMeter(entry) {
      paintPath(entry);
      const counted = !entry.direct || typeof entry.video.requestVideoFrameCallback === "function";
      if (counted) entry.fps = currentFps(entry);
      const meters = window.__meters || { fps: false, resolution: false };
      if (!meters.fps && !meters.resolution) {
        entry.meter.textContent = "";
        return;
      }
      const parts = [entry.direct ? "Native" : "JPEG"];
      if (meters.fps) parts.push((entry.fps || 0) + " fps");
      if (meters.resolution) parts.push(entry.width && entry.height ? entry.width + "×" + entry.height : "—");
      entry.meter.textContent = parts.join("  ·  ");
    }

    function sampleNative(entry) {
      if (!entry.pc || !entry.pc.getStats) return Promise.resolve();
      return entry.pc.getStats().then(function (stats) {
        stats.forEach(function (report) {
          if (report.type !== "inbound-rtp") return;
          if (report.kind && report.kind !== "video") return;
          if (!report.frameWidth && typeof report.framesPerSecond !== "number" && report.mediaType && report.mediaType !== "video") return;
          if (!entry.video.requestVideoFrameCallback && typeof report.framesPerSecond === "number") entry.fps = Math.round(report.framesPerSecond);
          if (report.frameWidth) entry.width = report.frameWidth;
          if (report.frameHeight) entry.height = report.frameHeight;
        });
        if (!entry.width && entry.video.videoWidth) {
          entry.width = entry.video.videoWidth;
          entry.height = entry.video.videoHeight;
        }
      }).catch(function () {});
    }

    window.setMeters = function (meters) {
      window.__meters = { fps: !!(meters && meters.fps), resolution: !!(meters && meters.resolution) };
      document.documentElement.dataset.meters = window.__meters.fps || window.__meters.resolution ? "1" : "0";
      slots.forEach(paintMeter);
    };

    window.setDebug = function (on) {
      window.__debug = !!on;
      document.documentElement.dataset.debug = window.__debug ? "1" : "0";
      if (!window.__debug) {
        soundLevel = 0;
        paintSoundBar();
      }
    };

    window.setMeterLift = function (px) {
      const lift = Math.max(0, Number(px) || 0);
      document.documentElement.style.setProperty("--meter-lift", lift + "px");
    };

    window.setSoundInset = function (inset) {
      const right = inset && typeof inset.right === "number" ? inset.right : 22;
      const bottom = inset && typeof inset.bottom === "number" ? inset.bottom : 132;
      document.documentElement.style.setProperty("--sound-right", right + "px");
      document.documentElement.style.setProperty("--sound-bottom", bottom + "px");
    };

    let sampling = false;
    setInterval(function () {
      slots.forEach(paintMeter);
      if (!sampling) {
        const jobs = [];
        slots.forEach(function (entry) {
          if (entry.direct) jobs.push(sampleNative(entry));
        });
        if (jobs.length) {
          sampling = true;
          Promise.all(jobs).then(function () {
            sampling = false;
            slots.forEach(paintMeter);
          }, function () { sampling = false; });
        }
      }
      if (window.__debug && !audioSampling) {
        const jobs = [];
        slots.forEach(function (entry) {
          if (entry.pc) jobs.push(sampleAudio(entry));
        });
        if (jobs.length) {
          audioSampling = true;
          Promise.all(jobs).then(function () {
            audioSampling = false;
            noteAudioStats();
          }, function () { audioSampling = false; });
        } else {
          soundLevel = 0;
          paintSoundBar();
        }
      }
      const now = performance.now();
      if (now - lastMeterLog < 2000) return;
      lastMeterLog = now;
      slots.forEach(function (entry, slot) {
        if (!entry.shown) return;
        post({
          type: "meter",
          text: (entry.direct ? "native" : "jpeg") + " slot " + slot + " " + (entry.width || 0) + "x" + (entry.height || 0) + " " + (entry.fps || 0) + " fps",
        });
      });
    }, 500);

    window.applyPicture = function (picture) {
      window.__picture = picture;
      const nextLatency = picture.latency === "queue" ? "queue" : "skip";
      if (nextLatency !== "queue") {
        slots.forEach(function (entry) {
          if (entry.queue.length) entry.latest = entry.queue[entry.queue.length - 1];
          entry.queue = [];
        });
      }
      latency = nextLatency;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "config",
          width: picture.width,
          fps: picture.fps,
          quality: picture.quality,
          latency: latency,
        }));
      }
    };
    window.setOrder = function (next) {
      const incoming = Array.isArray(next) ? next.map(Number) : [];
      const known = [];
      slots.forEach(function (_entry, slot) { known.push(slot); });
      order = incoming.filter((slot) => known.indexOf(slot) !== -1);
      for (const slot of known) if (order.indexOf(slot) === -1) order.push(slot);
      layout();
    };
    window.dropClient = function (slot) {
      dropped.add(slot);
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "hangup", slot: slot }));
      removeSlot(slot);
    };
    window.addEventListener("pagehide", function () {
      if (ws.readyState !== WebSocket.OPEN) return;
      order.slice().forEach(function (slot) {
        ws.send(JSON.stringify({ type: "hangup", slot: slot }));
      });
    });

    ws.onopen = () => {
      log("connected");
      post({ type: "status", text: "Waiting for a laptop to open this code" });
      if (window.__picture) window.applyPicture(window.__picture);
    };
    ws.onerror = () => {
      log("socket error");
      post({ type: "status", text: "Could not reach the room signal server" });
    };
    ws.onclose = (event) => log("socket closed " + event.code + (event.reason ? " " + event.reason : ""));
    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        showBinary(new Uint8Array(event.data));
        return;
      }
      if (typeof event.data !== "string") {
        log("ignored non-text message");
        return;
      }
      const message = JSON.parse(event.data);
      log("message " + (message.type || "unknown") + (Number.isInteger(message.slot) ? " slot " + message.slot : ""));
      if (message.type === "sender" && Number.isInteger(message.slot)) {
        dropped.delete(message.slot);
        ensure(message.slot);
        post({ type: "status", text: "Laptop connected. Waiting for the picture…" });
        post({ type: "clients", slots: order.slice() });
        if (window.__picture) window.applyPicture(window.__picture);
      }
      if (message.type === "offer" && Number.isInteger(message.slot) && message.sdp) {
        acceptOffer(message.slot, message.sdp).catch(function () {
          log("offer failed slot " + message.slot);
          const entry = slots.get(message.slot);
          if (entry) hideDirect(entry, message.slot);
        });
      }
      if (message.type === "ice" && Number.isInteger(message.slot)) addIce(message.slot, message.candidate);
      if (message.type === "audio") {
        log(
          "sound sender slot " + (Number.isInteger(message.slot) ? message.slot : "?") +
          " tracks=" + (message.tracks || 0) +
          " label=" + (message.label || "") +
          " state=" + (message.readyState || "none") +
          " enabled=" + !!message.enabled +
          " muted=" + !!message.muted +
          " transceiver=" + (message.transceiver || "?")
        );
      }
      if (message.type === "display-state" && Number.isInteger(message.slot)) {
        const entry = ensure(message.slot);
        entry.cell.dataset.state = message.state === "frozen" ? "frozen" : message.state === "paused" ? "paused" : "live";
        applyView(entry);
        syncSound(entry, message.slot);
      }
      if ((message.type === "peer-left" || message.type === "hangup") && Number.isInteger(message.slot)) {
        dropped.add(message.slot);
        removeSlot(message.slot);
      }
    };
  </script>
</body>
</html>`;
}

function signalingUrl(controlApiUrl: string, code: string, deviceToken: string) {
  const url = new URL(controlApiUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = new URLSearchParams({ role: "receiver", code, token: deviceToken }).toString();
  return url.toString();
}
