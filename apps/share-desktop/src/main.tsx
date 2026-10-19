import { FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./styles.css";

type DisplayMode = "live" | "paused" | "frozen";

type Source = { id: string; kind: "display" | "window"; label: string };

type ShareEvent =
  | { kind: "status"; text: string }
  | { kind: "ended"; text: string }
  | { kind: "preview"; jpeg: string };

function App() {
  const [server, setServer] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("Enter the code on the room panel.");
  const [starting, setStarting] = useState(false);
  const [live, setLive] = useState(false);
  const [picking, setPicking] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("live");
  const [preview, setPreview] = useState("");

  useEffect(() => {
    void invoke<{ server: string }>("load_settings").then((settings) => {
      if (settings.server) setServer(settings.server);
    });
  }, []);

  useEffect(() => {
    const unlisten = listen<ShareEvent>("share", (event) => {
      const message = event.payload;
      if (message.kind === "status") setStatus(message.text);
      if (message.kind === "preview") setPreview(message.jpeg);
      if (message.kind === "ended") finish(message.text);
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  function finish(message: string) {
    setDisplayMode("live");
    setLive(false);
    setStarting(false);
    setPicking(false);
    setPreview("");
    setStatus(message);
  }

  async function share(event: FormEvent) {
    event.preventDefault();
    const roomCode = normalize(code);
    if (roomCode.length < 4) {
      setStatus("Enter the room code shown on the panel.");
      return;
    }
    setCode(roomCode);
    setStarting(true);
    setStatus("Choose what to share.");
    try {
      await invoke("save_settings", { server: server.trim() });
      await invoke("prepare_share", { server: server.trim(), code: roomCode });
      const found = await invoke<Source[]>("list_sources");
      setSources(found);
      setPicking(true);
      setStatus(found.length ? "Choose what to share." : "No screen is available to share.");
    } catch (error) {
      setStatus(failure(error));
    } finally {
      setStarting(false);
    }
  }

  async function choose(source: Source) {
    setPicking(false);
    setStarting(true);
    setDisplayMode("live");
    setLive(true);
    setStatus("You are sharing your screen.");
    try {
      await invoke("start_share", { server: server.trim(), code: normalize(code), sourceId: source.id });
      setStarting(false);
    } catch (error) {
      finish(failure(error));
    }
  }

  function toggleDisplayMode(next: Exclude<DisplayMode, "live">) {
    const mode = displayMode === next ? "live" : next;
    setDisplayMode(mode);
    void invoke("set_display_mode", { mode });
  }

  const displays = sources.filter((source) => source.kind === "display");
  const windows = sources.filter((source) => source.kind === "window");

  return (
    <main>
      <div className={live ? "live" : "prelive"}>
        <div className="preview-wrap">
          <div className="stage">{preview ? <img alt="" src={`data:image/jpeg;base64,${preview}`} /> : null}</div>
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
            <button type="button" className={displayMode === "paused" ? "pause on" : "pause"} onClick={() => toggleDisplayMode("paused")}>
              {displayMode === "paused" ? "Resume live" : "Pause display"}
            </button>
            <button type="button" className={displayMode === "frozen" ? "freeze on" : "freeze"} onClick={() => toggleDisplayMode("frozen")}>
              {displayMode === "frozen" ? "Resume live" : "Freeze frame"}
            </button>
            <button
              type="button"
              className="stop"
              onClick={() => {
                void invoke("stop_share");
                finish("Sharing stopped.");
              }}
            >
              Stop sharing
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="eyebrow">Room receiver</p>
          <h1>Share to the panel</h1>
          {picking ? (
            <div className="picker">
              {displays.length ? <h2>Displays</h2> : null}
              {displays.map((source) => (
                <button key={source.id} type="button" className="choice" onClick={() => void choose(source)}>
                  {source.label}
                </button>
              ))}
              {windows.length ? <h2>Windows</h2> : null}
              {windows.map((source) => (
                <button key={source.id} type="button" className="choice" onClick={() => void choose(source)}>
                  {source.label}
                </button>
              ))}
              <button type="button" className="cancel" onClick={() => finish("Screen sharing was cancelled.")}>
                Cancel
              </button>
            </div>
          ) : (
            <form onSubmit={(event) => void share(event)}>
              <label>
                Room code
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  autoCapitalize="characters"
                  disabled={starting}
                />
              </label>
              <button type="submit" disabled={starting}>
                {starting ? "Starting…" : "Share screen"}
              </button>
              <label className="server">
                Control server
                <input
                  value={server}
                  onChange={(event) => setServer(event.target.value)}
                  placeholder="http://localhost:4000"
                  spellCheck={false}
                  disabled={starting}
                />
              </label>
            </form>
          )}
        </>
      )}
      <p className="status" role="status">{status}</p>
    </main>
  );
}

function failure(error: unknown) {
  if (typeof error === "string" && error.trim()) return error;
  return "Could not start sharing";
}

function normalize(value: string) {
  const trimmed = value.trim();
  if (trimmed.includes("://")) {
    try {
      const url = new URL(trimmed);
      const query = url.searchParams.get("code");
      const segment = url.pathname.split("/").filter(Boolean)[0] ?? "";
      return (query || segment).replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    } catch {
      // A half-typed address falls through to the plain code rules.
    }
  }
  return trimmed.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

createRoot(document.getElementById("root")!).render(<App />);
