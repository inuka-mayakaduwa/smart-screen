import { FormEvent, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const initialCode = codeFromLocation();
const apiBase = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

type ShareControls = {
  stop: () => void;
  setDisplayMode: (mode: DisplayMode) => void;
};

type DisplayMode = "live" | "paused" | "frozen";

type IceServer = { urls: string | string[]; username?: string; credential?: string };

async function captureDisplay(video: MediaTrackConstraints) {
  try {
    return await navigator.mediaDevices.getDisplayMedia({
      video,
      audio: { suppressLocalAudioPlayback: true },
      systemAudio: "include",
    } as unknown as DisplayMediaStreamOptions);
  } catch (error) {
    const cancelled = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError");
    if (cancelled) throw error;
  }
  try {
    return await navigator.mediaDevices.getDisplayMedia({ video, audio: true });
  } catch (error) {
    const cancelled = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError");
    if (cancelled) throw error;
  }
  return navigator.mediaDevices.getDisplayMedia({ video, audio: false });
}

function App() {
  const [code, setCode] = useState(initialCode);
  const [status, setStatus] = useState(initialCode ? "Ready to share this screen." : "Enter the code on the room panel.");
  const [starting, setStarting] = useState(false);
  const [live, setLive] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("live");
  const controls = useRef<ShareControls | null>(null);
  const previewHost = useRef<HTMLDivElement>(null);
  const socketUrl = useMemo(() => signalingUrl(apiBase, normalize(code)), [code]);

  function finish(message: string) {
    controls.current = null;
    setDisplayMode("live");
    setLive(false);
    setStarting(false);
    setStatus(message);
  }

  async function share(event: FormEvent) {
    event.preventDefault();
    const roomCode = normalize(code);
    if (roomCode.length < 5) {
      setStatus("Enter the 5-digit code on the panel.");
      return;
    }
    const url = new URL(window.location.href);
    url.pathname = `/${roomCode}`;
    url.searchParams.delete("code");
    window.history.replaceState(null, "", url);
    if (!window.isSecureContext) {
      const port = window.location.port ? `:${window.location.port}` : "";
      setStatus(`Screen capture is blocked on this address. Open https://${window.location.hostname}${port}/${roomCode}`);
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setStatus("This browser cannot capture the screen. Use Chrome or Edge.");
      return;
    }
    setStarting(true);
    setDisplayMode("live");
    setStatus("Asking the browser for the screen…");
    try {
      const session = await fetch(`${apiBase}/api/share/${encodeURIComponent(formatShareCode(roomCode))}`);
      if (!session.ok) {
        const body = (await session.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "This room code is not active");
      }
      const body = (await session.json()) as { iceServers?: IceServer[] };
      const video = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
      const stream = await captureDisplay(video);
      await publish(stream, socketUrl, body.iceServers ?? [], {
        onStatus: setStatus,
        onReady: (next) => {
          controls.current = next;
          setStarting(false);
          setLive(true);
        },
        onEnded: finish,
        previewHost: previewHost.current,
      });
    } catch (error) {
      const cancelled = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError");
      finish(cancelled ? "Screen sharing was cancelled." : error instanceof Error ? error.message : "Could not start sharing");
    }
  }

  function toggleDisplayMode(next: Exclude<DisplayMode, "live">) {
    const mode = displayMode === next ? "live" : next;
    setDisplayMode(mode);
    controls.current?.setDisplayMode(mode);
  }

  return (
    <main>
      <div className={live ? "live" : "prelive"}>
        <div className="preview-wrap">
          <div className="stage" ref={previewHost} />
          {displayMode === "paused" ? (
            <div className="pause-cover" aria-label="Display paused">
              <span className="rest-icon">☾</span>
              <strong>Display paused</strong>
              <span>Ready when you are</span>
            </div>
          ) : null}
          {displayMode === "frozen" ? <div className="freeze-badge" aria-label="Frame frozen">❄</div> : null}
        </div>
      </div>
      {live ? (
        <>
          <p className="eyebrow">{displayMode === "paused" ? "Display paused" : displayMode === "frozen" ? "Frame frozen" : "Sharing"}</p>
          <h1>You are sharing your screen</h1>
          <p className={displayMode === "live" ? "live-label" : "live-label held"}>
            <span className="dot" />
            {displayMode === "paused" ? "Paused" : displayMode === "frozen" ? "Frozen" : "Live"}
          </p>
          <div className="actions">
            <button
              type="button"
              className={displayMode === "paused" ? "pause on" : "pause"}
              onClick={() => toggleDisplayMode("paused")}
            >
              {displayMode === "paused" ? "Resume live" : "Pause display"}
            </button>
            <button
              type="button"
              className={displayMode === "frozen" ? "freeze on" : "freeze"}
              onClick={() => toggleDisplayMode("frozen")}
            >
              {displayMode === "frozen" ? "Resume live" : "Freeze frame"}
            </button>
            <button type="button" className="stop" onClick={() => controls.current?.stop()}>
              Stop sharing
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="eyebrow">Room receiver</p>
          <h1>Share to the panel</h1>
          <form onSubmit={share}>
            <label>
              Room code
              <input
                value={code}
                onChange={(event) => setCode(normalize(event.target.value))}
                inputMode="numeric"
                autoComplete="one-time-code"
                disabled={starting}
              />
            </label>
            <button type="submit" disabled={starting}>
              {starting ? "Starting…" : "Share screen"}
            </button>
          </form>
        </>
      )}
      <p className="status" role="status">{status}</p>
    </main>
  );
}

async function publish(
  stream: MediaStream,
  socketUrl: string,
  iceServers: IceServer[],
  hooks: {
    onStatus: (value: string) => void;
    onReady: (controls: ShareControls) => void;
    onEnded: (status: string) => void;
    previewHost: HTMLElement | null;
  },
) {
  const preview = document.createElement("video");
  preview.srcObject = stream;
  preview.muted = true;
  preview.playsInline = true;
  preview.autoplay = true;
  preview.style.cssText = "width:100%;height:100%;object-fit:contain;background:#101410;display:block";
  const frozenPreview = document.createElement("img");
  frozenPreview.alt = "";
  frozenPreview.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#101410;display:none";
  if (hooks.previewHost) hooks.previewHost.replaceChildren(preview, frozenPreview);
  else document.body.appendChild(preview);
  await new Promise<void>((resolve) => {
    if (preview.videoWidth > 0) resolve();
    else preview.onloadedmetadata = () => resolve();
  });
  await preview.play().catch(() => undefined);

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  const ws = new WebSocket(socketUrl);
  debug(`socket ${socketUrl}`);
  ws.onopen = () => sendAudio("pending");
  let timer = 0;
  let sending = false;
  let sent = false;
  let finished = false;
  let widthSetting = -1;
  let fpsSetting = 0;
  let activeWidth = 0;
  let activeFps = 30;
  let latency: "skip" | "queue" = "skip";
  let quality = 0.9;
  let delay = 33;
  let seenWidth = 0;
  let slow = 0;
  let fast = 0;
  let displayMode: DisplayMode = "live";
  const outbound: ArrayBuffer[] = [];
  const track = stream.getVideoTracks()[0];
  const audioTrack = stream.getAudioTracks()[0];
  const capturer = openGrabber(track);
  if (track) track.contentHint = "text";
  let peer: RTCPeerConnection | null = null;
  let rtpSender: RTCRtpSender | null = null;
  let direct = false;
  let lan = false;
  let remoteReady = false;
  let peerGeneration = 0;
  let retryTimer = 0;
  let disconnectTimer = 0;
  let readyWatch = 0;
  let connectWatch = 0;
  let codecPref: "h264" | "vp8" = "h264";
  let retryDelay = 3_000;
  let audioTransceiver: "pending" | "added" | "skipped" = "pending";
  const remoteIce: RTCIceCandidateInit[] = [];
  const JPEG_AUTO_CAP = 1280;
  const OUTBOUND_CAP = 6;

  function stop(status: string, notify: boolean) {
    if (finished) return;
    finished = true;
    displayMode = "live";
    window.clearTimeout(timer);
    window.clearTimeout(retryTimer);
    window.clearTimeout(disconnectTimer);
    window.clearTimeout(readyWatch);
    window.clearTimeout(connectWatch);
    peerGeneration += 1;
    closePeer();
    direct = false;
    if (notify && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "hangup" }));
      } catch {
        // The socket is already going away.
      }
    }
    stream.getTracks().forEach((item) => item.stop());
    showFrozenPreview(false);
    preview.remove();
    frozenPreview.remove();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    hooks.onEnded(status);
  }

  function liveStatus() {
    return audioTrack && audioTrack.readyState === "live"
      ? "The panel is receiving the screen and its sound."
      : "You are sharing your screen.";
  }

  function sendAudio(transceiver: "pending" | "added" | "skipped") {
    audioTransceiver = transceiver;
    const payload = {
      type: "audio",
      tracks: stream.getAudioTracks().length,
      label: (audioTrack?.label || "").slice(0, 80),
      readyState: audioTrack?.readyState || "none",
      enabled: Boolean(audioTrack?.enabled),
      muted: Boolean(audioTrack?.muted),
      transceiver,
    };
    debug(
      `audio tracks=${payload.tracks} label=${payload.label} state=${payload.readyState} enabled=${payload.enabled} muted=${payload.muted} transceiver=${transceiver}`,
    );
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
  }

  function setDisplayMode(next: DisplayMode) {
    if (finished) return;
    displayMode = next;
    if (audioTrack) audioTrack.enabled = displayMode === "live";
    showFrozenPreview(displayMode === "frozen");
    window.clearTimeout(timer);
    if (displayMode === "live") {
      sendDisplayState("live");
      hooks.onStatus(liveStatus());
      if (!direct) schedule();
      return;
    }
    hooks.onStatus(displayMode === "paused" ? "The panel is showing a resting screen." : "The panel is keeping the current frame.");
    sendDisplayState(displayMode);
    const stillMode = displayMode;
    const paintStill = () => {
      if (sending) {
        window.setTimeout(paintStill, 20);
        return;
      }
      void sendStillFrame(stillMode);
    };
    paintStill();
  }

  function showFrozenPreview(on: boolean) {
    if (!on || preview.videoWidth < 2) {
      frozenPreview.style.display = "none";
      frozenPreview.removeAttribute("src");
      return;
    }
    const snap = document.createElement("canvas");
    snap.width = preview.videoWidth;
    snap.height = preview.videoHeight;
    const snapContext = snap.getContext("2d");
    if (!snapContext) return;
    snapContext.drawImage(preview, 0, 0);
    frozenPreview.src = snap.toDataURL("image/jpeg", 0.85);
    frozenPreview.style.display = "block";
  }

  function sendDisplayState(state: DisplayMode) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "display-state", state }));
  }

  async function sendStillFrame(mode: Exclude<DisplayMode, "live">) {
    if (!context || finished || displayMode !== mode) return;
    try {
      if (mode === "paused") {
        paintRestingImage(canvas, context, activeWidth || availableWidth() || 1280, preview.videoWidth, preview.videoHeight);
      } else {
        await grabFrame(capturer, preview, canvas, context, activeWidth || availableWidth() || 1280, quality);
      }
      if (displayMode !== mode || finished || canvas.width < 2) return;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && displayMode === mode && ws.readyState === WebSocket.OPEN) {
        ws.send(await blob.arrayBuffer());
        sendDisplayState(mode);
      }
    } catch {
      // The last frame already on the panel stays there.
    }
  }

  function schedule() {
    if (finished) return;
    timer = window.setTimeout(() => void tick(), delay);
  }

  function availableWidth() {
    const settings = track?.getSettings();
    const fromTrack = settings && typeof settings.width === "number" ? settings.width : 0;
    return preview.videoWidth || fromTrack;
  }

  function availableFps() {
    const settings = track?.getSettings();
    const rate = settings && typeof settings.frameRate === "number" ? settings.frameRate : 0;
    return rate > 0 ? rate : 30;
  }

  function fitWidth(sourceWidth: number) {
    let chosen = 0;
    const steps = direct ? [1280, 1920, 2560] : [1280];
    for (const step of steps) if (sourceWidth >= step) chosen = step;
    if (!direct && chosen > JPEG_AUTO_CAP) chosen = JPEG_AUTO_CAP;
    return chosen;
  }

  function fitFps(sourceWidth: number, sourceFps: number) {
    const ceiling = Math.min(60, Math.max(15, Math.round(sourceFps)));
    const ideal = sourceWidth >= 2560 ? 24 : sourceWidth >= 1920 ? 30 : 60;
    const allowed = [15, 24, 30, 60].filter((fps) => fps <= ceiling);
    const pool = allowed.length > 0 ? allowed : [15];
    return pool.reduce((best, fps) => (Math.abs(fps - ideal) < Math.abs(best - ideal) ? fps : best));
  }

  function applyRate(fps: number) {
    delay = Math.max(16, Math.round(1000 / Math.min(60, fps)));
    const source = availableWidth();
    const video: MediaTrackConstraints = { frameRate: { ideal: fps, max: fps } };
    if (activeWidth > 0) video.width = { ideal: activeWidth, max: activeWidth };
    else if (source > 0) video.width = { ideal: source };
    track?.applyConstraints(video).catch(() => undefined);
  }

  function syncActive() {
    const sourceWidth = availableWidth() || 1920;
    const sourceFps = availableFps();
    let nextWidth = widthSetting < 0 ? fitWidth(sourceWidth) : widthSetting;
    if (!direct) {
      const jpegWidth = widthSetting < 0 || widthSetting === 0 ? fitWidth(sourceWidth) || JPEG_AUTO_CAP : widthSetting;
      nextWidth = Math.min(Math.max(jpegWidth, 0) || JPEG_AUTO_CAP, JPEG_AUTO_CAP);
    }
    activeWidth = nextWidth;
    activeFps = fpsSetting <= 0 ? fitFps(activeWidth || sourceWidth, sourceFps) : fpsSetting;
    applyRate(activeFps);
    tuneSender();
    debug(`picture width=${labelWidth(activeWidth)} fps=${activeFps} latency=${latency} path=${direct ? "native" : "jpeg"}`);
  }

  function stepDown() {
    if (fpsSetting <= 0) {
      const lower = [15, 24, 30, 60].filter((fps) => fps < activeFps);
      if (lower.length > 0) {
        activeFps = lower[lower.length - 1] ?? activeFps;
        applyRate(activeFps);
        debug(`auto fps ${activeFps}`);
        return;
      }
    }
    if (widthSetting < 0 && activeWidth > 1280) {
      const lower = [1280, 1920, 2560].filter((width) => width < activeWidth);
      if (lower.length > 0) {
        activeWidth = lower[lower.length - 1] ?? activeWidth;
        debug(`auto width ${activeWidth}`);
      }
    } else if (!direct && widthSetting < 0 && activeWidth > JPEG_AUTO_CAP) {
      activeWidth = JPEG_AUTO_CAP;
      debug(`auto width ${activeWidth}`);
    }
  }

  function stepUp() {
    if (!direct) return;
    const sourceWidth = availableWidth() || activeWidth || 1920;
    const ceilingWidth = widthSetting < 0 ? fitWidth(sourceWidth) : activeWidth;
    const ceilingFps = fpsSetting <= 0 ? fitFps(ceilingWidth || sourceWidth, availableFps()) : activeFps;
    if (widthSetting < 0 && activeWidth > 0 && activeWidth < ceilingWidth) {
      const higher = [1280, 1920, 2560].find((width) => width > activeWidth && width <= ceilingWidth);
      if (higher) {
        activeWidth = higher;
        debug(`auto width ${activeWidth}`);
        return;
      }
    }
    if (fpsSetting <= 0 && activeFps < ceilingFps) {
      const higher = [15, 24, 30, 60].find((fps) => fps > activeFps && fps <= ceilingFps);
      if (higher) {
        activeFps = higher;
        applyRate(activeFps);
        debug(`auto fps ${activeFps}`);
      }
    }
  }

  function noteSource() {
    const sourceWidth = availableWidth();
    if (sourceWidth > 0 && sourceWidth !== seenWidth) {
      seenWidth = sourceWidth;
      slow = 0;
      fast = 0;
      syncActive();
    }
  }

  function flushOutbound() {
    while (outbound.length > 0 && ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 1_200_000) {
      const packet = outbound.shift();
      if (packet) ws.send(packet);
    }
  }

  async function tick() {
    if (finished || sending || displayMode !== "live" || direct) return;
    if (!context || ws.readyState !== WebSocket.OPEN) {
      schedule();
      return;
    }
    noteSource();
    flushOutbound();
    if (latency === "skip" && ws.bufferedAmount > 500_000) {
      if (widthSetting < 0 || fpsSetting <= 0) stepDown();
      schedule();
      return;
    }
    if (latency === "queue" && outbound.length >= OUTBOUND_CAP) {
      schedule();
      return;
    }
    sending = true;
    const started = performance.now();
    try {
      const packet = await grabFrame(capturer, preview, canvas, context, activeWidth, quality);
      if (finished || displayMode !== "live") return;
      if (packet && ws.readyState === WebSocket.OPEN) {
        if (latency === "queue") {
          outbound.push(packet);
          if (outbound.length > OUTBOUND_CAP) outbound.splice(0, outbound.length - OUTBOUND_CAP);
          flushOutbound();
        } else if (ws.bufferedAmount <= 500_000) {
          ws.send(packet);
        } else if (widthSetting < 0 || fpsSetting <= 0) {
          stepDown();
        }
        if (!sent) {
          sent = true;
          debug(`sent first frame bytes=${packet.byteLength} width=${canvas.width}`);
          hooks.onStatus("You are sharing your screen.");
        }
      }
    } catch {
      if (!sent) hooks.onStatus("Waiting for the first picture from this screen…");
    } finally {
      sending = false;
      if (!finished && displayMode === "live" && !direct) {
        const elapsed = performance.now() - started;
        const behind = elapsed > delay * 1.2 || outbound.length > 2 || (latency === "skip" && ws.bufferedAmount > 250_000);
        if (behind && (widthSetting < 0 || fpsSetting <= 0)) {
          fast = 0;
          slow += 1;
          if (slow >= 2) {
            slow = 0;
            stepDown();
          }
        } else if (direct && elapsed < delay * 0.6 && ws.bufferedAmount < 200_000 && outbound.length === 0) {
          slow = 0;
          fast += 1;
          if (fast >= 12) {
            fast = 0;
            stepUp();
          }
        } else {
          slow = 0;
          fast = 0;
        }
        timer = window.setTimeout(() => void tick(), Math.max(0, delay - elapsed));
      }
    }
  }

  function applyConfig(message: { width?: number; fps?: number; quality?: number; latency?: string }) {
    if (typeof message.width === "number") widthSetting = message.width;
    if (typeof message.fps === "number") fpsSetting = message.fps <= 0 ? 0 : Math.min(60, message.fps);
    if (typeof message.quality === "number") quality = Math.min(0.95, Math.max(0.4, message.quality));
    if (message.latency === "queue" || message.latency === "skip") {
      if (message.latency === "skip") outbound.length = 0;
      latency = message.latency;
    }
    slow = 0;
    fast = 0;
    syncActive();
  }

  function setDirect(on: boolean) {
    if (finished || direct === on) return;
    direct = on;
    debug(on ? "direct video" : "jpeg relay");
    window.clearTimeout(timer);
    timer = 0;
    window.clearTimeout(readyWatch);
    readyWatch = 0;
    if (on) {
      outbound.length = 0;
      window.clearTimeout(retryTimer);
      retryTimer = 0;
      window.clearTimeout(connectWatch);
      connectWatch = 0;
      retryDelay = 3_000;
      syncActive();
      return;
    }
    syncActive();
    if (displayMode === "live") void tick();
  }

  function closePeer() {
    window.clearTimeout(disconnectTimer);
    window.clearTimeout(connectWatch);
    connectWatch = 0;
    remoteReady = false;
    remoteIce.length = 0;
    rtpSender = null;
    const current = peer;
    peer = null;
    if (!current) return;
    current.onconnectionstatechange = null;
    current.onicecandidate = null;
    current.close();
  }

  function scheduleRetry() {
    if (retryTimer || finished || direct) return;
    const wait = retryDelay;
    retryDelay = Math.min(12_000, Math.round(retryDelay * 1.5));
    debug(`retry native in ${wait}ms codec=${codecPref}`);
    retryTimer = window.setTimeout(() => {
      retryTimer = 0;
      if (!finished && !direct) void startPeer();
    }, wait);
  }

  function preferVp8Next(reason: string) {
    if (finished || direct) return;
    if (codecPref === "vp8") {
      debug(`codec vp8 already tried (${reason}); staying on jpeg`);
      return;
    }
    codecPref = "vp8";
    debug(`codec fallback vp8 (${reason})`);
    window.clearTimeout(retryTimer);
    retryTimer = 0;
    retryDelay = 3_000;
    void startPeer();
  }

  function armReadyWatch(generation: number) {
    window.clearTimeout(readyWatch);
    readyWatch = window.setTimeout(() => {
      readyWatch = 0;
      if (finished || direct || generation !== peerGeneration) return;
      if (!peer || peer.connectionState !== "connected") return;
      preferVp8Next("no video-ready");
    }, 5_000);
  }

  function tuneSender() {
    if (!rtpSender) return;
    const source = availableWidth() || 1280;
    const target = activeWidth > 0 ? activeWidth : source;
    const scale = source > target ? source / target : 1;
    try {
      const params = rtpSender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      params.degradationPreference = lan ? "maintain-resolution" : "maintain-framerate";
      const encoding = params.encodings[0];
      if (!encoding) return;
      encoding.maxBitrate = screenBitrate(target, activeFps || 30, quality, lan);
      encoding.maxFramerate = activeFps || 30;
      encoding.scaleResolutionDownBy = scale;
      if (lan) encoding.networkPriority = "high";
      rtpSender.setParameters(params).catch(() => undefined);
    } catch {
      // Parameters can be rejected until the offer is applied.
    }
  }

  async function notePath(connection: RTCPeerConnection) {
    try {
      const stats = await connection.getStats();
      let pair: RTCStats | undefined;
      stats.forEach((report) => {
        if (report.type === "transport" && "selectedCandidatePairId" in report) {
          const selected = stats.get(String(report.selectedCandidatePairId));
          if (selected) pair = selected;
        }
        if (report.type === "candidate-pair" && "state" in report && report.state === "succeeded") {
          const selected = "selected" in report && report.selected;
          const nominated = "nominated" in report && report.nominated;
          if (selected || nominated) pair = report;
        }
      });
      if (!pair || !("localCandidateId" in pair)) return false;
      const remote = "remoteCandidateId" in pair ? stats.get(String(pair.remoteCandidateId)) : undefined;
      const local = stats.get(String(pair.localCandidateId));
      const remoteKind = remote && "candidateType" in remote ? String(remote.candidateType) : "";
      const localKind = local && "candidateType" in local ? String(local.candidateType) : "";
      const host = (remoteKind || localKind) === "host";
      if (host !== lan) {
        lan = host;
        tuneSender();
        debug(host ? "path host" : "path relay");
      }
      return true;
    } catch {
      return false;
    }
  }

  async function startPeer() {
    if (finished || typeof RTCPeerConnection !== "function" || !track) return;
    const generation = ++peerGeneration;
    window.clearTimeout(retryTimer);
    retryTimer = 0;
    window.clearTimeout(readyWatch);
    readyWatch = 0;
    closePeer();
    const connection = new RTCPeerConnection({ iceServers: normalizeIce(iceServers) });
    peer = connection;
    debug(`start peer codec=${codecPref}`);
    try {
      const transceiver = connection.addTransceiver(track, { direction: "sendonly", streams: [stream] });
      rtpSender = transceiver.sender;
      preferCodec(transceiver, codecPref);
      if (audioTrack && audioTrack.readyState === "live") {
        connection.addTransceiver(audioTrack, { direction: "sendonly", streams: [stream] });
        debug("audio transceiver added");
        sendAudio("added");
      } else {
        debug(`audio transceiver skipped tracks=${stream.getAudioTracks().length} state=${audioTrack?.readyState ?? "none"}`);
        sendAudio("skipped");
      }
      tuneSender();
      connection.onicecandidate = (event) => {
        if (generation !== peerGeneration || !event.candidate || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: "ice", candidate: event.candidate.toJSON() }));
      };
      connection.onconnectionstatechange = () => {
        if (generation !== peerGeneration) return;
        debug(`peer ${connection.connectionState}`);
        if (connection.connectionState === "connected") {
          window.clearTimeout(disconnectTimer);
          window.clearTimeout(connectWatch);
          connectWatch = 0;
          tuneSender();
          armReadyWatch(generation);
          void notePath(connection).then((found) => {
            if (found || generation !== peerGeneration) return;
            window.setTimeout(() => {
              if (generation === peerGeneration) void notePath(connection);
            }, 500);
          });
        }
        if (connection.connectionState === "failed") {
          setDirect(false);
          scheduleRetry();
        }
        if (connection.connectionState === "disconnected") {
          window.clearTimeout(disconnectTimer);
          disconnectTimer = window.setTimeout(() => {
            if (generation !== peerGeneration) return;
            if (connection.connectionState === "disconnected" || connection.connectionState === "failed") {
              setDirect(false);
              scheduleRetry();
            }
          }, 3000);
        }
      };
      window.clearTimeout(connectWatch);
      connectWatch = window.setTimeout(() => {
        connectWatch = 0;
        if (generation !== peerGeneration || finished || direct) return;
        if (connection.connectionState === "connected" || connection.connectionState === "failed") return;
        debug(`peer connect timeout state=${connection.connectionState}`);
        setDirect(false);
        scheduleRetry();
      }, 10_000);
      const offer = await connection.createOffer();
      if (generation !== peerGeneration || finished) return;
      await connection.setLocalDescription(offer);
      if (generation !== peerGeneration || finished || ws.readyState !== WebSocket.OPEN || !connection.localDescription) return;
      ws.send(JSON.stringify({ type: "offer", sdp: connection.localDescription }));
    } catch (error) {
      debug(`peer failed ${error instanceof Error ? error.message : "setup"}`);
      if (generation === peerGeneration) scheduleRetry();
    }
  }

  async function acceptAnswer(sdp: RTCSessionDescriptionInit) {
    const connection = peer;
    const generation = peerGeneration;
    if (!connection) return;
    await connection.setRemoteDescription(sdp);
    if (generation !== peerGeneration || peer !== connection) return;
    remoteReady = true;
    const queued = remoteIce.splice(0, remoteIce.length);
    for (const candidate of queued) {
      try {
        await connection.addIceCandidate(candidate);
      } catch {
        debug("ice rejected");
      }
    }
    tuneSender();
  }

  async function acceptIce(candidate: RTCIceCandidateInit | null) {
    if (!candidate) return;
    if (!peer || !remoteReady) {
      remoteIce.push(candidate);
      return;
    }
    await peer.addIceCandidate(candidate);
  }

  syncActive();

  ws.onmessage = (event) => {
    if (typeof event.data !== "string") return;
    const message = JSON.parse(event.data) as {
      type?: string;
      width?: number;
      fps?: number;
      quality?: number;
      latency?: string;
      sdp?: RTCSessionDescriptionInit;
      candidate?: RTCIceCandidateInit | null;
    };
    if (message.type === "config") applyConfig(message);
    if (message.type === "ready") {
      debug("panel receiver is connected");
      const wasDirect = direct;
      codecPref = "h264";
      retryDelay = 3_000;
      setDirect(false);
      void startPeer();
      if (displayMode === "live") {
        hooks.onStatus("You are sharing your screen.");
        if (!wasDirect && !timer) void tick();
      } else {
        void sendStillFrame(displayMode);
      }
    }
    if (message.type === "answer" && message.sdp) void acceptAnswer(message.sdp).catch(() => debug("answer rejected"));
    if (message.type === "ice") void acceptIce(message.candidate ?? null).catch(() => debug("ice rejected"));
    if (message.type === "video-ready") setDirect(true);
    if (message.type === "renegotiate") preferVp8Next("panel");
    if (message.type === "video-stopped") {
      setDirect(false);
      scheduleRetry();
    }
    if (message.type === "full") stop("This room is already showing 4 screens.", false);
    if (message.type === "hangup") stop("The panel stopped the share.", false);
    if (message.type === "peer-left" || message.type === "replaced") stop("The panel left the share.", false);
  };
  ws.onerror = () => hooks.onStatus("Could not reach the room signal server.");
  ws.onclose = () => {
    if (!finished) stop("The panel left the share.", false);
  };
  track?.addEventListener("ended", () => {
    stop("Sharing stopped.", true);
  });
  audioTrack?.addEventListener("ended", () => {
    sendAudio(audioTransceiver === "added" ? "added" : "skipped");
    if (!finished && displayMode === "live") hooks.onStatus(liveStatus());
  });
  hooks.onStatus(liveStatus());
  hooks.onReady({
    stop: () => stop("Sharing stopped.", true),
    setDisplayMode,
  });
}

function paintRestingImage(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  maxWidth: number,
  sourceWidth: number,
  sourceHeight: number,
) {
  const width = Math.max(960, Math.min(maxWidth, sourceWidth || maxWidth));
  const ratio = sourceWidth > 0 && sourceHeight > 0 ? sourceHeight / sourceWidth : 9 / 16;
  const height = Math.max(540, Math.round(width * ratio));
  canvas.width = width;
  canvas.height = height;
  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#173a31");
  background.addColorStop(1, "#0d1713");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  context.fillStyle = "rgba(141, 206, 186, 0.14)";
  context.beginPath();
  context.arc(width * 0.18, height * 0.16, width * 0.2, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#8dceba";
  context.font = `500 ${Math.max(56, Math.round(height * 0.13))}px serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("☾", width / 2, height * 0.4);
  context.fillStyle = "#ffffff";
  context.font = `600 ${Math.max(28, Math.round(height * 0.06))}px Outfit, sans-serif`;
  context.fillText("Display paused", width / 2, height * 0.57);
  context.fillStyle = "#b9c9c2";
  context.font = `400 ${Math.max(18, Math.round(height * 0.032))}px Outfit, sans-serif`;
  context.fillText("Ready when you are", width / 2, height * 0.66);
}

function openGrabber(track: MediaStreamTrack | undefined) {
  if (!track || typeof ImageCapture !== "function") return null;
  return new ImageCapture(track) as unknown as { grabFrame: () => Promise<ImageBitmap> };
}

async function grabFrame(
  capturer: { grabFrame: () => Promise<ImageBitmap> } | null,
  preview: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  maxWidth: number,
  quality: number,
) {
  let limit = maxWidth;
  let sharpness = quality;
  let bitmap: ImageBitmap | null = null;
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (preview.videoWidth > 0) paint(canvas, context, preview.videoWidth, preview.videoHeight, preview, limit);
      else if (capturer) {
        if (!bitmap) bitmap = await capturer.grabFrame();
        paint(canvas, context, bitmap.width, bitmap.height, bitmap, limit);
      } else return null;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", sharpness));
      if (!blob) return null;
      if (blob.size <= 1_600_000 || (canvas.width <= 960 && sharpness <= 0.6)) return blob.arrayBuffer();
      if (sharpness > 0.6) sharpness = Math.max(0.6, sharpness - 0.15);
      else limit = Math.max(960, Math.round(canvas.width * 0.75));
    }
    return null;
  } finally {
    bitmap?.close();
  }
}

function paint(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  sourceWidth: number,
  sourceHeight: number,
  source: CanvasImageSource,
  maxWidth: number,
) {
  const width = maxWidth > 0 ? Math.min(sourceWidth, maxWidth) : Math.min(sourceWidth, 2560);
  const height = Math.max(1, Math.round((sourceHeight / sourceWidth) * width));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.drawImage(source, 0, 0, width, height);
}

function preferCodec(transceiver: RTCRtpTransceiver, preference: "h264" | "vp8") {
  const capabilities = RTCRtpSender.getCapabilities?.("video");
  if (!capabilities || typeof transceiver.setCodecPreferences !== "function") return;
  const primary = preference === "vp8" ? "video/vp8" : "video/h264";
  const secondary = preference === "vp8" ? "video/h264" : "video/vp8";
  const rank = (mimeType: string) => {
    const lower = mimeType.toLowerCase();
    if (lower === primary) return 0;
    if (lower === secondary) return 1;
    return 2;
  };
  const codecs = capabilities.codecs.slice().sort((left, right) => rank(left.mimeType) - rank(right.mimeType));
  try {
    transceiver.setCodecPreferences(codecs);
  } catch {
    // This browser rejects a reordered capability list.
  }
}

function screenBitrate(width: number, fps: number, quality: number, lan: boolean) {
  const base = lan
    ? width >= 2560
      ? 22_000_000
      : width >= 1920
        ? 16_000_000
        : width >= 1280
          ? 12_000_000
          : 4_000_000
    : width >= 2560
      ? 6_000_000
      : width >= 1920
        ? 4_000_000
        : width >= 1280
          ? 2_500_000
          : 1_200_000;
  const scaled = base * (Math.min(60, Math.max(1, fps)) / 30) * Math.min(1, Math.max(0.35, quality));
  return Math.round(Math.min(lan ? 30_000_000 : 8_000_000, Math.max(350_000, scaled)));
}

function normalizeIce(servers: IceServer[]): RTCIceServer[] {
  return servers
    .filter((server) => (Array.isArray(server.urls) ? server.urls.length > 0 : Boolean(server.urls)))
    .map((server) => {
      const next: RTCIceServer = { urls: server.urls };
      if (server.username) next.username = server.username;
      if (server.credential) next.credential = server.credential;
      return next;
    });
}

function labelWidth(width: number) {
  if (width < 0) return "auto";
  if (width === 0) return "source";
  return String(width);
}

function debug(message: string) {
  if (import.meta.env.DEV) console.log(`[share] ${message}`);
}

function codeFromLocation() {
  const query = new URLSearchParams(window.location.search).get("code");
  if (query) return normalize(query);
  const segment = window.location.pathname.split("/").filter(Boolean)[0] ?? "";
  if (!segment || reservedPath(segment)) return "";
  return normalize(segment);
}

function reservedPath(segment: string) {
  return ["admin", "api", "assets", "board", "media", "ws"].includes(segment.toLowerCase());
}

function normalize(value: string) {
  return value.replace(/\D/g, "").slice(0, 5);
}

function formatShareCode(code: string) {
  return normalize(code);
}

function signalingUrl(api: string, code: string) {
  const url = api ? new URL(api) : new URL(window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = new URLSearchParams({ role: "sender", code }).toString();
  url.hash = "";
  return url.toString();
}

createRoot(document.getElementById("root")!).render(<App />);
