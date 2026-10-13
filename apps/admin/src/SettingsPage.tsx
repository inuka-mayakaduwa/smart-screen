import { FormEvent, useEffect, useState } from "react";
import { api } from "./api";
import type { PanelDisplaySettings, PanelThemeInfo } from "./display";
import { DisplaySettingsForm } from "./DisplaySettingsForm";

export function SettingsPage() {
  const [display, setDisplay] = useState<PanelDisplaySettings | null>(null);
  const [themes, setThemes] = useState<PanelThemeInfo[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<{ display: PanelDisplaySettings; themes: PanelThemeInfo[] }>("/api/admin/settings/display")
      .then((body) => {
        setDisplay(body.display);
        setThemes(body.themes);
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
    </>
  );
}
