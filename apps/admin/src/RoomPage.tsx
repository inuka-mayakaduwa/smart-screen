import { FormEvent, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, type RoomDetail, type RoomShare } from "./api";
import {
  KNOWN_PANEL_THEMES,
  mergePanelThemes,
  modeLabel,
  refreshLabel,
  type PanelDisplaySettings,
  type PanelThemeInfo,
} from "./display";
import { DisplaySettingsForm } from "./DisplaySettingsForm";

type PublicConfig = { googleConfigured: boolean; microsoftConfigured: boolean; turnConfigured: boolean };

export function RoomPage() {
  const { roomId = "" } = useParams();
  const [search] = useSearchParams();
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [error, setError] = useState(search.get("error") ?? "");
  const [notice] = useState(search.get("connected") ? "Calendar account connected." : "");
  const [connectCode, setConnectCode] = useState<{ display: string; expiresAt: string } | null>(null);

  async function reload() {
    const body = await api<{ room: RoomDetail }>(`/api/admin/rooms/${roomId}`);
    setRoom(body.room);
  }

  useEffect(() => {
    reload().catch((err: Error) => setError(err.message));
    api<PublicConfig>("/api/config/public")
      .then(setConfig)
      .catch(() => undefined);
  }, [roomId]);

  if (!room) return <p>{error || "Loading room…"}</p>;

  return (
    <>
      <p>
        <Link to="/rooms">All rooms</Link>
      </p>
      <h1 className="page-title">{room.name}</h1>
      <p className="lede">The panel reads this name, these images, and today’s meetings. Join still happens on the panel.</p>
      {error ? <div className="banner error">{error}</div> : null}
      {notice ? <div className="banner">{notice}</div> : null}
      <div className="split">
        <div>
          <ProfileForm room={room} onSaved={reload} onError={setError} />
          <RoomDisplayPanel room={room} onSaved={reload} onError={setError} />
          <ImagePanel room={room} onChanged={reload} onError={setError} />
          <BackgroundPanel room={room} onChanged={reload} onError={setError} />
          <CalendarPanel room={room} config={config} onChanged={reload} onError={setError} />
        </div>
        <div>
          <ConnectPanel
            room={room}
            code={connectCode}
            onCode={setConnectCode}
            onChanged={reload}
            onError={setError}
          />
          <ShareForm room={room} turnConfigured={Boolean(config?.turnConfigured)} onSaved={reload} onError={setError} />
          <SessionList room={room} />
        </div>
      </div>
    </>
  );
}

function ProfileForm({
  room,
  onSaved,
  onError,
}: {
  room: RoomDetail;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(room.name);
  const [timezone, setTimezone] = useState(room.timezone);
  const [rows, setRows] = useState<{ key: string; value: string }[]>(
    Object.entries(room.meta).map(([key, value]) => ({ key, value })),
  );

  useEffect(() => {
    setName(room.name);
    setTimezone(room.timezone);
    setRows(Object.entries(room.meta).map(([key, value]) => ({ key, value })));
  }, [room]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const meta: Record<string, string> = {};
    for (const row of rows) {
      if (row.key.trim()) meta[row.key.trim()] = row.value;
    }
    try {
      await api(`/api/admin/rooms/${room.id}`, { method: "PATCH", body: { name, timezone, meta } });
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save the room");
    }
  }

  return (
    <form className="panel stack" onSubmit={save}>
      <h2>Profile</h2>
      <label>
        Room name
        <input value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label>
        Timezone
        <input value={timezone} onChange={(event) => setTimezone(event.target.value)} required />
      </label>
      <div className="stack">
        {rows.map((row, index) => (
          <div className="meta-row" key={index}>
            <input
              aria-label="Meta name"
              value={row.key}
              placeholder="Floor"
              onChange={(event) => setRows(rows.map((item, itemIndex) => (itemIndex === index ? { ...item, key: event.target.value } : item)))}
            />
            <input
              aria-label="Meta value"
              value={row.value}
              placeholder="3"
              onChange={(event) => setRows(rows.map((item, itemIndex) => (itemIndex === index ? { ...item, value: event.target.value } : item)))}
            />
            <button className="ghost" type="button" onClick={() => setRows(rows.filter((_, itemIndex) => itemIndex !== index))}>
              Remove
            </button>
          </div>
        ))}
        <button className="ghost" type="button" onClick={() => setRows([...rows, { key: "", value: "" }])}>
          Add meta field
        </button>
      </div>
      <div className="actions">
        <button className="primary" type="submit">
          Save profile
        </button>
        <button
          className="danger"
          type="button"
          onClick={async () => {
            try {
              await api(`/api/admin/rooms/${room.id}`, {
                method: "PATCH",
                body: { status: room.status === "active" ? "retired" : "active" },
              });
              await onSaved();
            } catch (err) {
              onError(err instanceof Error ? err.message : "Could not update status");
            }
          }}
        >
          {room.status === "active" ? "Retire room" : "Activate room"}
        </button>
      </div>
    </form>
  );
}

function RoomDisplayPanel({
  room,
  onSaved,
  onError,
}: {
  room: RoomDetail;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [themes, setThemes] = useState<PanelThemeInfo[]>(KNOWN_PANEL_THEMES);
  const [defaults, setDefaults] = useState<PanelDisplaySettings | null>(null);
  const [useDefaults, setUseDefaults] = useState(room.displayOverrides === null);
  const [display, setDisplay] = useState<PanelDisplaySettings>(room.display);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDisplay(room.display);
    setUseDefaults(room.displayOverrides === null);
  }, [room]);

  useEffect(() => {
    api<{ display: PanelDisplaySettings; themes: PanelThemeInfo[] }>("/api/admin/settings/display")
      .then((body) => {
        setDefaults(body.display);
        setThemes(mergePanelThemes(body.themes));
      })
      .catch(() => setThemes(mergePanelThemes(undefined)));
  }, []);

  function customize() {
    if (room.displayOverrides === null && defaults) setDisplay(defaults);
    setUseDefaults(false);
    setSaved(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    try {
      await api(`/api/admin/rooms/${room.id}`, {
        method: "PATCH",
        body: { displayOverrides: useDefaults ? null : display },
      });
      await onSaved();
      setSaved(true);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save display settings");
    }
  }

  const summary = defaults ?? room.display;
  const themeName = themes.find((theme) => theme.id === summary.themeId)?.label ?? summary.themeId;

  return (
    <form className="panel ds-panel" onSubmit={save}>
      <div className="ds-panel-head">
        <div>
          <h2>Panel display</h2>
          <p className="muted">Theme, refresh, and what the room shows about each meeting.</p>
        </div>
        <div className="ds-segmented" role="group" aria-label="Display source">
          <button
            type="button"
            className={useDefaults ? "is-on" : ""}
            aria-pressed={useDefaults}
            onClick={() => {
              setUseDefaults(true);
              setSaved(false);
            }}
          >
            Organization defaults
          </button>
          <button type="button" className={useDefaults ? "" : "is-on"} aria-pressed={!useDefaults} onClick={customize}>
            Custom for this room
          </button>
        </div>
      </div>

      {useDefaults ? (
        <div className="ds-summary">
          <dl>
            <div>
              <dt>Theme</dt>
              <dd>{themeName}</dd>
            </div>
            <div>
              <dt>Refresh</dt>
              <dd>Every {refreshLabel(summary.refreshSeconds)}</dd>
            </div>
            <div>
              <dt>Now</dt>
              <dd>{modeLabel(summary.now.mode)}</dd>
            </div>
            <div>
              <dt>Next</dt>
              <dd>{modeLabel(summary.next.mode)}</dd>
            </div>
          </dl>
          <p className="muted">
            Change these for every room in <Link to="/settings/display">Display defaults</Link>.
          </p>
        </div>
      ) : (
        <DisplaySettingsForm value={display} themes={themes} onChange={setDisplay} />
      )}

      <div className="ds-actions">
        {saved ? <span className="muted">Saved.</span> : null}
        <button className="primary" type="submit">
          Save display
        </button>
      </div>
    </form>
  );
}

const SOLID_PRESETS = [
  { id: "deep-green", label: "Deep green", color: "#14221c" },
  { id: "slate", label: "Slate", color: "#101820" },
  { id: "deep-space", label: "Deep space", color: "#050816" },
  { id: "charcoal", label: "Charcoal", color: "#1a1a1a" },
  { id: "sand", label: "Sand", color: "#e8dfd0" },
  { id: "white", label: "White", color: "#ffffff" },
] as const;

const GRADIENT_PRESETS = [
  { id: "forest", label: "Forest", from: "#14221c", to: "#0c6b52" },
  { id: "ocean", label: "Ocean", from: "#0b1f33", to: "#2f6fb0" },
  { id: "deep-space", label: "Deep space", from: "#050816", to: "#163a8a" },
  { id: "dusk", label: "Dusk", from: "#1b1430", to: "#5a3d8a" },
  { id: "ember", label: "Ember", from: "#2a1208", to: "#c45c26" },
] as const;

function BackgroundPanel({
  room,
  onChanged,
  onError,
}: {
  room: RoomDetail;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [scrimOpacity, setScrimOpacity] = useState(Math.round((room.scrimOpacity ?? 0.62) * 100));

  useEffect(() => {
    setScrimOpacity(Math.round((room.scrimOpacity ?? 0.62) * 100));
  }, [room.scrimOpacity]);

  async function patch(body: Record<string, unknown>) {
    try {
      await api(`/api/admin/rooms/${room.id}`, { method: "PATCH", body });
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save background");
    }
  }

  return (
    <section className="panel stack">
      <h2>Room background</h2>
      <p className="muted">Presets apply when no uploaded image is selected. Overlay opacity tints the idle room screen.</p>
      <div className="stack">
        <strong>Solid colors</strong>
        <div className="bg-presets" role="group" aria-label="Solid background presets">
          {SOLID_PRESETS.map((preset) => {
            const on = room.backgroundKind === "solid" && room.backgroundSolid === preset.color;
            return (
              <button
                key={preset.id}
                type="button"
                className={`bg-choice${on ? " is-on" : ""}`}
                aria-pressed={on}
                onClick={() => void patch({ backgroundKind: "solid", backgroundSolid: preset.color })}
              >
                <span className="bg-swatch" style={{ background: preset.color }} aria-hidden="true" />
                <span className="bg-choice-label">{preset.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="stack">
        <strong>Gradients</strong>
        <div className="bg-presets" role="group" aria-label="Gradient background presets">
          {GRADIENT_PRESETS.map((preset) => {
            const on =
              room.backgroundKind === "gradient" &&
              room.backgroundGradientFrom === preset.from &&
              room.backgroundGradientTo === preset.to;
            return (
              <button
                key={preset.id}
                type="button"
                className={`bg-choice${on ? " is-on" : ""}`}
                aria-pressed={on}
                onClick={() =>
                  void patch({
                    backgroundKind: "gradient",
                    backgroundGradientFrom: preset.from,
                    backgroundGradientTo: preset.to,
                  })
                }
              >
                <span
                  className="bg-swatch"
                  style={{ background: `linear-gradient(160deg, ${preset.from}, ${preset.to})` }}
                  aria-hidden="true"
                />
                <span className="bg-choice-label">{preset.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <label className="bg-opacity">
        Overlay opacity ({scrimOpacity}%)
        <input
          type="range"
          min={0}
          max={80}
          value={scrimOpacity}
          onChange={(event) => setScrimOpacity(Number(event.target.value))}
          onMouseUp={() => void patch({ scrimOpacity: scrimOpacity / 100 })}
          onTouchEnd={() => void patch({ scrimOpacity: scrimOpacity / 100 })}
        />
      </label>
    </section>
  );
}

function ImagePanel({
  room,
  onChanged,
  onError,
}: {
  room: RoomDetail;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  async function upload(file: File | undefined) {
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    try {
      await api(`/api/admin/rooms/${room.id}/images`, { method: "POST", body: form });
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Upload failed");
    }
  }

  return (
    <section className="panel">
      <h2>Images</h2>
      <p className="muted">The panel uses the background you select. Upload a wide image for the room display.</p>
      <label className="ghost" style={{ width: "fit-content", padding: "11px 16px", borderRadius: 999, border: "1px solid #d9d0c4" }}>
        Upload image
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(event) => upload(event.target.files?.[0])} />
      </label>
      <div className="images">
        {room.images.map((image) => (
          <figure key={image.id}>
            <img src={image.url} alt={image.label} />
            <figcaption>
              <span>{image.label}</span>
              {room.backgroundImageId === image.id ? <strong>Background</strong> : null}
              <button
                className="ghost"
                type="button"
                onClick={async () => {
                  await api(`/api/admin/rooms/${room.id}`, { method: "PATCH", body: { backgroundImageId: image.id } });
                  await onChanged();
                }}
              >
                Use as background
              </button>
              <button
                className="danger"
                type="button"
                onClick={async () => {
                  await api(`/api/admin/rooms/${room.id}/images/${image.id}`, { method: "DELETE" });
                  await onChanged();
                }}
              >
                Delete
              </button>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

function CalendarPanel({
  room,
  config,
  onChanged,
  onError,
}: {
  room: RoomDetail;
  config: PublicConfig | null;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  async function connect(provider: "google" | "microsoft") {
    try {
      const body = await api<{ url: string }>(`/api/admin/rooms/${room.id}/connections/${provider}`, { method: "POST" });
      window.location.href = body.url;
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not start the calendar connection");
    }
  }

  return (
    <section className="panel stack">
      <h2>Calendars</h2>
      <p className="muted">Optional. These accounts stay on the control API and only fill the meeting list.</p>
      {room.connections.map((connection) => (
        <div className="row" key={connection.id}>
          <div style={{ flex: 1 }}>
            <strong>{connection.provider === "google" ? "Google" : "Microsoft"}</strong>
            <div className="muted">{connection.accountLabel}</div>
            {connection.lastError ? <div className="error">{connection.lastError}</div> : null}
          </div>
          <button
            className="danger"
            type="button"
            onClick={async () => {
              await api(`/api/admin/rooms/${room.id}/connections/${connection.id}`, { method: "DELETE" });
              await onChanged();
            }}
          >
            Remove
          </button>
        </div>
      ))}
      <div className="actions">
        <button className="primary" type="button" onClick={() => connect("google")}>
          Connect Google
        </button>
        <button className="primary" type="button" onClick={() => connect("microsoft")}>
          Connect Microsoft
        </button>
      </div>
      {config && !config.googleConfigured ? <p className="muted">Add Google OAuth values to the API environment before connecting Google.</p> : null}
      {config && !config.microsoftConfigured ? <p className="muted">Add Microsoft OAuth values to the API environment before connecting Microsoft.</p> : null}
    </section>
  );
}

function ConnectPanel({
  room,
  code,
  onCode,
  onChanged,
  onError,
}: {
  room: RoomDetail;
  code: { display: string; expiresAt: string } | null;
  onCode: (code: { display: string; expiresAt: string } | null) => void;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  async function issue() {
    onError("");
    try {
      const body = await api<{ display: string; expiresAt: string }>(`/api/admin/rooms/${room.id}/connect`, { method: "POST" });
      onCode(body);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not create a Connect token");
    }
  }

  return (
    <section className="panel">
      <h2>Connect a panel</h2>
      <p className="muted">This token is not an account. Type it into the room app. It expires in 10 minutes and works once.</p>
      <button className="primary" type="button" onClick={issue} disabled={room.status !== "active"}>
        Connect
      </button>
      {code ? (
        <>
          <div className="token">{code.display}</div>
          <p className="muted">Expires {new Date(code.expiresAt).toLocaleTimeString()}</p>
        </>
      ) : null}
      <h2 style={{ marginTop: 28 }}>Panels</h2>
      {room.devices.length === 0 ? <p className="muted">No panel has entered a token for this room.</p> : null}
      {room.devices.map((device) => (
        <div className="row" key={device.id} style={{ marginTop: 10 }}>
          <div style={{ flex: 1 }}>
            <strong>{device.label}</strong>
            <div className="muted">
              {device.revokedAt ? "Revoked" : device.lastSeenAt ? `Seen ${new Date(device.lastSeenAt).toLocaleString()}` : "Not seen yet"}
            </div>
          </div>
          {!device.revokedAt ? (
            <button
              className="danger"
              type="button"
              onClick={async () => {
                await api(`/api/admin/devices/${device.id}`, { method: "DELETE" });
                await onChanged();
              }}
            >
              Revoke
            </button>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function ShareForm({
  room,
  turnConfigured,
  onSaved,
  onError,
}: {
  room: RoomDetail;
  turnConfigured: boolean;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [share, setShare] = useState<RoomShare>(() => withRotateMinutes(room.share));

  useEffect(() => setShare(withRotateMinutes(room.share)), [room]);

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      await api(`/api/admin/rooms/${room.id}`, { method: "PATCH", body: { share } });
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save sharing");
    }
  }

  return (
    <form className="panel stack" onSubmit={save}>
      <h2>Sharing</h2>
      <Check label="Room code receiver" checked={share.roomCode} onChange={(roomCode) => setShare({ ...share, roomCode })} />
      <Check label="OEM share app" checked={share.oem} onChange={(oem) => setShare({ ...share, oem })} />
      <label>
        OEM package
        <input
          value={share.oemPackage ?? ""}
          placeholder="com.vendor.share"
          onChange={(event) => setShare({ ...share, oemPackage: event.target.value })}
        />
      </label>
      <Check label="Show Google Cast slot" checked={share.googleCast} onChange={(googleCast) => setShare({ ...share, googleCast })} />
      <Check label="Show Miracast slot" checked={share.miracast} onChange={(miracast) => setShare({ ...share, miracast })} />
      <Check label="Show AirPlay slot" checked={share.airplay} onChange={(airplay) => setShare({ ...share, airplay })} />
      <label>
        Rotate share code every
        <input
          type="number"
          min={1}
          max={180}
          step={1}
          value={share.codeRotateMinutes ?? 15}
          onChange={(event) => setShare({ ...share, codeRotateMinutes: Number(event.target.value) })}
        />
      </label>
      <p className="muted">Minutes. The panel flashes red and white for the last 10 seconds, then shows a new code.</p>
      <p className="muted">
        Cast, Miracast, and AirPlay stay unavailable in the APK until a licensed receiver is linked.{" "}
        {turnConfigured
          ? "TURN is configured. The panel uses it when a direct path is not available."
          : "TURN is not configured. On one network the panel prefers a direct video path; otherwise frames stay on the server."}
      </p>
      <button className="primary" type="submit">
        Save sharing
      </button>
    </form>
  );
}

function SessionList({ room }: { room: RoomDetail }) {
  const sessions = [...room.sessions].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  return (
    <section className="panel stack">
      <h2>Sessions</h2>
      <p className="muted">
        A session opens in the background when someone shares, opens the whiteboard, or joins a meeting. It stays open across meetings until the panel ends it. Each session keeps its whiteboard.
      </p>
      {sessions.length === 0 ? <p className="muted">No sessions yet.</p> : null}
      {sessions.map((session) => (
        <div key={session.id}>
          <strong>{session.endedAt ? "Ended" : "Open"}</strong>
          <div className="muted">Opened {formatWhen(session.openedAt)}</div>
          <div className="muted">Whiteboard updated {formatWhen(session.whiteboardUpdatedAt)}</div>
          {session.endedAt ? <div className="muted">Ended {formatWhen(session.endedAt)}</div> : null}
        </div>
      ))}
    </section>
  );
}

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function withRotateMinutes(share: RoomShare): RoomShare {
  return { ...share, codeRotateMinutes: share.codeRotateMinutes || 15 };
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label style={{ flexDirection: "row", alignItems: "center" }}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}
