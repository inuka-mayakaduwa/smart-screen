import { FormEvent, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const initialCode = (params.get("code") ?? "").toUpperCase();
const apiBase = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

function App() {
  const [code, setCode] = useState(initialCode);
  const [status, setStatus] = useState(initialCode ? "Ready to share this screen." : "Enter the code on the room panel.");
  const [sharing, setSharing] = useState(false);
  const socketUrl = useMemo(() => signalingUrl(apiBase, normalize(code)), [code]);

  async function share(event: FormEvent) {
    event.preventDefault();
    const roomCode = normalize(code);
    if (roomCode.length < 4) {
      setStatus("Enter the room code shown on the panel.");
      return;
    }
    setSharing(true);
    setStatus("Asking the browser for the screen…");
    try {
      const session = await fetch(`${apiBase}/api/share/${roomCode}`);
      if (!session.ok) {
        const body = (await session.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "This room code is not active");
      }
      await session.json();
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      await publish(stream, socketUrl, setStatus);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not start sharing");
      setSharing(false);
    }
  }

  return (
    <main>
      <p className="eyebrow">Room receiver</p>
      <h1>Share to the panel</h1>
      <form onSubmit={share}>
        <label>
          Room code
          <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} autoCapitalize="characters" />
        </label>
        <button type="submit" disabled={sharing}>
          {sharing ? "Sharing" : "Share screen"}
        </button>
      </form>
      <p className="status">{status}</p>
    </main>
  );
}

async function publish(stream: MediaStream, socketUrl: string, setStatus: (value: string) => void) {
  const preview = document.createElement("video");
  preview.srcObject = stream;
  preview.muted = true;
  preview.playsInline = true;
  preview.autoplay = true;
  preview.style.cssText = "position:fixed;width:320px;height:180px;left:-400px;top:0;opacity:1";
  document.body.appendChild(preview);
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
  const outbound: ArrayBuffer[] = [];
  const track = stream.getVideoTracks()[0];
  const capturer = openGrabber(track);

  function stop(status: string) {
    if (finished) return;
    finished = true;
    window.clearTimeout(timer);
    stream.getTracks().forEach((item) => item.stop());
    preview.remove();
    setStatus(status);
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
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
    if (finished || sending) return;
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
          setStatus("Sending this screen to the panel.");
        }
      }
    } catch {
      if (!sent) setStatus("Waiting for the first picture from this screen…");
    } finally {
      sending = false;
      if (!finished) {
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
    const message = JSON.parse(event.data) as { type?: string; width?: number; fps?: number; quality?: number };
    if (message.type === "config") applyConfig(message);
    if (message.type === "ready" && !timer) {
      debug("panel receiver is connected");
      setStatus("Panel is connected. Sending the picture…");
      void tick();
    }
    if (message.type === "full") stop("This room is already showing 4 screens.");
    if (message.type === "peer-left" || message.type === "hangup" || message.type === "replaced") {
      stop("The panel left the share.");
    }
  };
  ws.onerror = () => setStatus("Could not reach the room signal server.");
  ws.onclose = () => {
    if (!finished) stop("The panel left the share.");
  };
  track?.addEventListener("ended", () => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "hangup" }));
    stop("Sharing stopped.");
  });
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

function normalize(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
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
