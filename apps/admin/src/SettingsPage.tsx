import { FormEvent, useEffect, useState } from "react";
import { api } from "./api";
import { KNOWN_PANEL_THEMES, mergePanelThemes, type PanelDisplaySettings, type PanelThemeInfo } from "./display";
import { DisplaySettingsForm } from "./DisplaySettingsForm";

type AppRelease = {
  versionCode: number;
  versionName: string;
  bytes: number;
  uploadedAt: string;
  notes: string;
};

export function SettingsPage() {
  const [display, setDisplay] = useState<PanelDisplaySettings | null>(null);
  const [themes, setThemes] = useState<PanelThemeInfo[]>(KNOWN_PANEL_THEMES);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<{ display: PanelDisplaySettings; themes: PanelThemeInfo[] }>("/api/admin/settings/display")
      .then((body) => {
        setDisplay(body.display);
        setThemes(mergePanelThemes(body.themes));
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!display) return;
    setSaved(false);
    try {
      const body = await api<{ display: PanelDisplaySettings }>("/api/admin/settings/display", {
        method: "PATCH",
        body: { display },
      });
      setDisplay(body.display);
      setError("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save display settings");
    }
  }

  if (!display) return <p>{error || "Loading display defaults…"}</p>;

  return (
    <>
      <h1 className="page-title">Display defaults</h1>
      <p className="lede">Every room uses these unless the room is set to Custom for this room.</p>
      {error ? <div className="banner error">{error}</div> : null}
      <form className="panel ds-panel" onSubmit={save}>
        <DisplaySettingsForm
          value={display}
          themes={themes}
          onChange={(next) => {
            setDisplay(next);
            setSaved(false);
          }}
        />
        <div className="ds-actions">
          {saved ? <span className="muted">Saved for all rooms that use the defaults.</span> : null}
          <button className="primary" type="submit">
            Save defaults
          </button>
        </div>
      </form>
      <AppReleasePanel />
      <DownloadAccessPanel />
    </>
  );
}

type AppDownload = { code: string; createdAt: string };

function DownloadAccessPanel() {
  const [download, setDownload] = useState<AppDownload | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const link = `${window.location.origin}/download`;

  useEffect(() => {
    api<{ download: AppDownload | null }>("/api/admin/app/download")
      .then((body) => setDownload(body.download))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoaded(true));
  }, []);

  async function issue() {
    setBusy(true);
    setError("");
    try {
      const body = await api<{ download: AppDownload }>("/api/admin/app/download", { method: "POST" });
      setDownload(body.download);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a download code");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/app/download", { method: "DELETE" });
      setDownload(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not turn off downloads");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel stack">
      <h2>Download page</h2>
      <p className="muted">
        Anyone with the code can download the published APK from <a href={link}>{link}</a>. A new code replaces the old one. Turn it off to close the page.
      </p>
      {error ? <div className="banner error">{error}</div> : null}
      {!loaded ? <p className="muted">Loading…</p> : null}
      {loaded && download ? (
        <>
          <p className="token">{`${download.code.slice(0, 4)}-${download.code.slice(4)}`}</p>
          <p className="muted">Created {new Date(download.createdAt).toLocaleString()}</p>
        </>
      ) : null}
      {loaded && !download ? <p className="muted">Downloads are off.</p> : null}
      <div className="ds-actions">
        {download ? (
          <button className="danger" type="button" disabled={busy} onClick={() => void turnOff()}>
            Turn off downloads
          </button>
        ) : null}
        <button className="primary" type="button" disabled={busy} onClick={() => void issue()}>
          {download ? "New code" : "Turn on with a code"}
        </button>
      </div>
    </section>
  );
}

function AppReleasePanel() {
  const [release, setRelease] = useState<AppRelease | null>(null);
  const [versionName, setVersionName] = useState("");
  const [versionCode, setVersionCode] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    api<{ release: AppRelease | null }>("/api/admin/app/release")
      .then((body) => {
        setRelease(body.release);
        if (body.release) setVersionCode(String(body.release.versionCode + 1));
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function publish(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("Choose an APK");
      return;
    }
    const form = new FormData();
    form.set("file", file);
    form.set("versionName", versionName);
    form.set("versionCode", versionCode);
    form.set("notes", notes);
    setBusy(true);
    setError("");
    try {
      const body = await api<{ release: AppRelease }>("/api/admin/app/release", { method: "POST", body: form });
      setRelease(body.release);
      setVersionName("");
      setNotes("");
      setFile(null);
      setFormKey((key) => key + 1);
      setVersionCode(String(body.release.versionCode + 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish the APK");
    } finally {
      setBusy(false);
    }
  }

  const published = release
    ? `${release.versionName} · code ${release.versionCode} · ${(release.bytes / (1024 * 1024)).toFixed(1)} MB · ${new Date(release.uploadedAt).toLocaleString()}`
    : "No APK is published yet.";

  return (
    <form className="panel stack" onSubmit={publish} style={{ marginTop: 28 }}>
      <h2>Panel app</h2>
      <p className="muted">Upload the room APK once. Each connected panel downloads it and opens the Android installer. Use a version code higher than the published one, and higher than the build already installed on the panels.</p>
      <p className="muted">{published}</p>
      {release?.notes ? <p className="muted">{release.notes}</p> : null}
      {error ? <div className="banner error">{error}</div> : null}
      <label>
        Version name
        <input value={versionName} onChange={(event) => setVersionName(event.target.value)} placeholder="1.1.0" maxLength={40} required />
      </label>
      <label>
        Version code
        <input value={versionCode} onChange={(event) => setVersionCode(event.target.value)} inputMode="numeric" required />
      </label>
      <label>
        Notes
        <input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={280} placeholder="Optional" />
      </label>
      <label>
        APK
        <input
          key={formKey}
          type="file"
          accept=".apk,application/vnd.android.package-archive"
          required
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>
      <div className="ds-actions">
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Publishing…" : "Publish APK"}
        </button>
      </div>
    </form>
  );
}
