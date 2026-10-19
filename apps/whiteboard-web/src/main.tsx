import { CaptureUpdateAction, Excalidraw, MainMenu, reconcileElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type {
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  NormalizedZoomValue,
} from "@excalidraw/excalidraw/types";
import { FormEvent, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@excalidraw/excalidraw/index.css";
import "./styles.css";

const initialCode = codeFromLocation();
const embed = new URLSearchParams(window.location.search).get("embed") === "1";
const apiBase = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

type Phase = "code" | "loading" | "open" | "ended" | "missing";
type Scene = { elements: readonly ExcalidrawElement[]; files: BinaryFiles };

function App() {
  const [code, setCode] = useState(initialCode);
  const [draft, setDraft] = useState(initialCode);
  const [phase, setPhase] = useState<Phase>(initialCode ? "loading" : "code");
  const [initial, setInitial] = useState<Scene | null>(null);

  useEffect(() => {
    if (!code) {
      setPhase("code");
      setInitial(null);
      return;
    }
    let stopped = false;
    let ended = false;
    let socket: WebSocket | null = null;
    let retry = 0;
    setPhase("loading");

    async function load() {
      try {
        const response = await fetch(`${apiBase}/api/whiteboard/${encodeURIComponent(code)}`);
        if (stopped) return;
        if (response.status === 404) {
          setPhase("missing");
          return;
        }
        const body = (await response.json()) as { open?: boolean; elements?: ExcalidrawElement[]; files?: BinaryFiles };
        if (!body.open) {
          setPhase("ended");
          return;
        }
        setInitial({ elements: body.elements ?? [], files: body.files ?? {} });
        setPhase("open");
        connect();
      } catch {
        if (!stopped) setPhase("missing");
      }
    }

    function connect() {
      if (stopped) return;
      socket?.close();
      socket = new WebSocket(socketUrl(apiBase, code));
      boardSocket.current = socket;
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as { type?: string; elements?: ExcalidrawElement[]; files?: BinaryFiles };
        if (message.type === "closed") {
          ended = true;
          setPhase("ended");
          return;
        }
        if (message.type === "scene") applyRemote({ elements: message.elements ?? [], files: message.files ?? {} });
      };
      socket.onclose = () => {
        if (stopped || ended) return;
        retry = window.setTimeout(connect, 1000);
      };
    }

    load();
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      socket?.close();
      if (boardSocket.current === socket) boardSocket.current = null;
    };
  }, [code]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const next = normalize(draft);
    if (next.length < 4) return;
    const url = new URL(window.location.href);
    url.pathname = `/${next}`;
    url.searchParams.delete("code");
    window.history.replaceState(null, "", url);
    setCode(next);
  }

  return (
    <div className={embed ? "app embed" : "app"}>
      {embed ? null : (
        <header>
          <span className="mark" aria-hidden="true" />
          <h1>Whiteboard</h1>
        </header>
      )}
      {phase === "code" ? (
        <form className="gate" onSubmit={submit}>
          <p>Enter the code on the room panel.</p>
          <input value={draft} onChange={(event) => setDraft(event.target.value.toUpperCase())} autoCapitalize="characters" autoFocus />
          <button type="submit">Open</button>
        </form>
      ) : null}
      {phase === "loading" ? <p className="gate">Opening the whiteboard…</p> : null}
      {phase === "ended" ? <p className="gate">This session has ended.</p> : null}
      {phase === "missing" ? <p className="gate">This whiteboard is not available.</p> : null}
      {phase === "open" && initial ? <Board initial={initial} /> : null}
    </div>
  );
}

const boardSocket = { current: null as WebSocket | null };

function applyRemote(scene: Scene) {
  const api = boardApi.current;
  if (!api) {
    boardQueue.current = scene;
    return;
  }
  boardApplying.current = true;
  const local = api.getSceneElementsIncludingDeleted();
  const elements =
    local.length === 0
      ? scene.elements
      : reconcileElements(local, scene.elements as readonly RemoteExcalidrawElement[], api.getAppState());
  api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
  const files = Object.values(scene.files) as BinaryFileData[];
  if (files.length) api.addFiles(files);
  window.requestAnimationFrame(() => {
    boardApplying.current = false;
  });
}

const boardApi = { current: null as ExcalidrawImperativeAPI | null };
const boardQueue = { current: null as Scene | null };
const boardApplying = { current: false };

function Board({ initial }: { initial: Scene }) {
  const readyAt = useRef(Date.now() + 500);
  const timer = useRef(0);
  const pending = useRef<Scene | null>(null);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function onChange(elements: readonly ExcalidrawElement[], _appState: unknown, files: BinaryFiles) {
    if (Date.now() < readyAt.current || boardApplying.current) return;
    pending.current = { elements, files };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const payload = pending.current;
      const socket = boardSocket.current;
      if (!payload || socket?.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: "scene", elements: payload.elements, files: payload.files }));
    }, 150);
  }

  return (
    <div className={embed ? "board board-panel" : "board"}>
      <Excalidraw
        name="whiteboard"
        aiEnabled={false}
        autoFocus
        initialData={{
          elements: initial.elements,
          files: initial.files,
          appState: panelAppState(),
        }}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
            export: false,
            saveAsImage: true,
            clearCanvas: true,
            toggleTheme: true,
            changeViewBackgroundColor: true,
          },
        }}
        excalidrawAPI={(api) => {
          boardApi.current = api;
          readyAt.current = Date.now() + 500;
          // Keep panel-friendly stroke/font defaults even after scene restore.
          api.updateScene({ appState: panelAppState(), captureUpdate: CaptureUpdateAction.NEVER });
          if (boardQueue.current) {
            applyRemote(boardQueue.current);
            boardQueue.current = null;
          }
        }}
        onChange={onChange}
      >
        <MainMenu>
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          <MainMenu.DefaultItems.ToggleTheme />
        </MainMenu>
      </Excalidraw>
    </div>
  );
}

/** Thinner strokes and smaller type for room panels / digital screens. */
function panelAppState() {
  return {
    exportEmbedScene: false,
    viewBackgroundColor: "#ffffff",
    // Excalidraw widths: 0.5 (thin), 1, 2, 4
    currentItemStrokeWidth: 0.5,
    // Excalidraw sizes: 16, 20, 28, 36
    currentItemFontSize: 16,
    currentItemRoughness: 0,
    currentItemOpacity: 100,
    zoom: { value: 0.7 as NormalizedZoomValue },
    gridModeEnabled: false,
  };
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
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function socketUrl(api: string, code: string) {
  const url = api ? new URL(api) : new URL(window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/whiteboard";
  url.search = new URLSearchParams({ code }).toString();
  url.hash = "";
  return url.toString();
}

createRoot(document.getElementById("root")!).render(<App />);
