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
    setStarting(true);
    setDisplayMode("live");
    setStatus("Asking the browser for the screen…");
    try {
      const session = await fetch(`${apiBase}/api/share/${encodeURIComponent(formatShareCode(roomCode))}`);
      if (!session.ok) {
        const body = (await session.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "This room code is not active");
      }
      const lookup = (await session.json()) as ShareLookup;
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      await publish(stream, socketUrl, lookup, {
        onStatus: setStatus,
        onReady: (next) => {
          controls.current = next;
          setStarting(false);
          setLive(true);
          setStatus("You are sharing your screen.");
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

type ShareLookup = {
  iceServers?: { urls: string; username?: string; credential?: string }[];
  panelLanIp?: string | null;
};

async function publish(
  stream: MediaStream,
  socketUrl: string,
  lookup: ShareLookup,
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
  const capturer = openGrabber(track);
  let nativeLive = false;
  let pc: RTCPeerConnection | null = null;

  function iceServers() {
    return (lookup.iceServers ?? []).map((server) => ({
      urls: server.urls,
      username: server.username,
      credential: server.credential,
    }));
  }

  async function startNative() {
    if (pc || finished) return;
    pc = new RTCPeerConnection({ iceServers: iceServers() });
    for (const mediaTrack of stream.getTracks()) pc.addTrack(mediaTrack, stream);
    pc.onicecandidate = (event) => {
      if (!event.candidate || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "ice", candidate: event.candidate.toJSON() }));
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "offer", sdp: pc.localDescription }));
  }

  function stopNative() {
    nativeLive = false;
    if (!pc) return;
    pc.onicecandidate = null;
    pc.close();
    pc = null;
  }

  function stop(status: string, notify: boolean) {
    if (finished) return;
    finished = true;
    displayMode = "live";
    window.clearTimeout(timer);
    if (notify && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "hangup" }));
      } catch {
        // The socket is already going away.
      }
    }
    stopNative();
    stream.getTracks().forEach((item) => item.stop());
    showFrozenPreview(false);
    preview.remove();
    frozenPreview.remove();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    hooks.onEnded(status);
  }

  function setDisplayMode(next: DisplayMode) {
    if (finished) return;
    displayMode = next;
    showFrozenPreview(displayMode === "frozen");
    window.clearTimeout(timer);
    if (displayMode === "live") {
      sendDisplayState("live");
      hooks.onStatus("You are sharing your screen.");
      schedule();
      return;
    }
    hooks.onStatus(displayMode === "paused" ? "The panel is showing a resting screen." : "The panel is keeping the current frame.");
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
    for (const step of [1280, 1920, 2560]) if (sourceWidth >= step) chosen = step;
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
    track?.applyConstraints({ frameRate: { ideal: fps, max: fps } }).catch(() => undefined);
  }

  function syncActive() {
    const sourceWidth = availableWidth() || 1920;
    const sourceFps = availableFps();
    activeWidth = widthSetting < 0 ? fitWidth(sourceWidth) : widthSetting;
    activeFps = fpsSetting <= 0 ? fitFps(activeWidth || sourceWidth, sourceFps) : fpsSetting;
    applyRate(activeFps);
    debug(`picture width=${labelWidth(activeWidth)} fps=${activeFps} latency=${latency}`);
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
    }
  }

  function stepUp() {
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
    if (nativeLive) {
      schedule();
      return;
    }
    if (finished || sending || displayMode !== "live") return;
    if (!context || ws.readyState !== WebSocket.OPEN) {
      schedule();
      return;
    }
    noteSource();
    flushOutbound();
    if (latency === "skip" && ws.bufferedAmount > 800_000) {
      schedule();
      return;
    }
    if (latency === "queue" && outbound.length >= 24) {
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
          flushOutbound();
        } else if (ws.bufferedAmount <= 800_000) {
          ws.send(packet);
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
      if (!finished && displayMode === "live") {
        const elapsed = performance.now() - started;
        const behind = elapsed > delay * 1.2 || outbound.length > 4 || (latency === "skip" && ws.bufferedAmount > 500_000);
        if (behind && (widthSetting < 0 || fpsSetting <= 0)) {
          fast = 0;
          slow += 1;
          if (slow >= 4) {
            slow = 0;
            stepDown();
          }
        } else if (elapsed < delay * 0.6 && ws.bufferedAmount < 200_000 && outbound.length === 0) {
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

  ws.onmessage = (event) => {
    if (typeof event.data !== "string") return;
    const message = JSON.parse(event.data) as {
      type?: string;
      width?: number;
      fps?: number;
      quality?: number;
      sdp?: RTCSessionDescriptionInit;
      candidate?: RTCIceCandidateInit;
    };
    if (message.type === "config") applyConfig(message);
    if (message.type === "answer" && message.sdp && pc) {
      void pc.setRemoteDescription(message.sdp).catch(() => undefined);
    }
    if (message.type === "ice" && message.candidate && pc) {
      void pc.addIceCandidate(message.candidate).catch(() => undefined);
    }
    if (message.type === "video-ready") nativeLive = true;
    if (message.type === "video-stopped") stopNative();
    if (message.type === "ready" && !timer) {
      debug("panel receiver is connected");
      void startNative().catch(() => undefined);
      if (displayMode === "live") {
        hooks.onStatus("You are sharing your screen.");
        void tick();
      } else {
        void sendStillFrame(displayMode);
      }
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
  if (code.length !== 5) return code;
  return `${code.slice(0, 2)}-${code.slice(2)}`;
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
