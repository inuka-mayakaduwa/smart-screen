import {
  FALLBACK_SWATCH,
  PRIVACY_MODES,
  previewHeadline,
  previewSubtitle,
  withMode,
  type MeetingSlotSettings,
  type NowSlotSettings,
  type PanelDisplaySettings,
  type PanelThemeInfo,
  type ThemeSwatch,
} from "./display";

const REFRESH_PRESETS = [
  { seconds: 15, label: "15 s" },
  { seconds: 30, label: "30 s" },
  { seconds: 60, label: "1 min" },
  { seconds: 120, label: "2 min" },
  { seconds: 300, label: "5 min" },
];

export function DisplaySettingsForm({
  value,
  themes,
  onChange,
}: {
  value: PanelDisplaySettings;
  themes: PanelThemeInfo[];
  onChange: (next: PanelDisplaySettings) => void;
}) {
  const swatch = themes.find((theme) => theme.id === value.themeId)?.swatch ?? FALLBACK_SWATCH;

  return (
    <div className="ds">
      <section className="ds-section">
        <SectionHead title="Theme" detail="Sets the layout, colors, and type on the panel." />
        <div className="ds-themes">
          {themes.map((theme) => (
            <button
              key={theme.id}
              type="button"
              className={`ds-theme${theme.id === value.themeId ? " is-on" : ""}`}
              aria-pressed={theme.id === value.themeId}
              onClick={() => onChange({ ...value, themeId: theme.id })}
            >
              <ThemeThumb swatch={theme.swatch} />
              <span className="ds-theme-text">
                <strong>{theme.label}</strong>
                <small>{theme.description}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="ds-section">
        <SectionHead title="Calendar refresh" detail="How often the panel reloads today’s meetings from Google or Microsoft." />
        <div className="ds-refresh">
          <div className="ds-segmented" role="group" aria-label="Refresh interval">
            {REFRESH_PRESETS.map((preset) => (
              <button
                key={preset.seconds}
                type="button"
                className={preset.seconds === value.refreshSeconds ? "is-on" : ""}
                aria-pressed={preset.seconds === value.refreshSeconds}
                onClick={() => onChange({ ...value, refreshSeconds: preset.seconds })}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <label className="ds-inline-number">
            <span>Custom</span>
            <input
              type="number"
              min={10}
              max={600}
              value={value.refreshSeconds || ""}
              onChange={(event) => onChange({ ...value, refreshSeconds: Number(event.target.value) || 0 })}
            />
            <span>sec</span>
          </label>
        </div>
      </section>

      <section className="ds-section">
        <SectionHead title="Meetings" detail="Choose how much of each booking people in the room can see." />
        <div className="ds-slots">
          <SlotCard
            title="Now"
            hint="Meeting in progress"
            slot={value.now}
            swatch={swatch}
            featured
            onChange={(now) => onChange({ ...value, now: now as NowSlotSettings })}
          />
          <SlotCard
            title="Next"
            hint="Later today"
            slot={value.next}
            swatch={swatch}
            onChange={(next) => onChange({ ...value, next })}
          />
        </div>
      </section>
    </div>
  );
}

function SectionHead({ title, detail }: { title: string; detail: string }) {
  return (
    <header className="ds-section-head">
      <h3>{title}</h3>
      <p>{detail}</p>
    </header>
  );
}

function ThemeThumb({ swatch }: { swatch: ThemeSwatch }) {
  return (
    <span className="ds-thumb" style={{ background: swatch.screen }} aria-hidden="true">
      <span className="ds-thumb-left">
        <i style={{ background: swatch.text }} />
        <i style={{ background: swatch.muted, width: "60%" }} />
      </span>
      <span className="ds-thumb-right">
        <i style={{ background: swatch.featured }} />
        <i style={{ background: swatch.card }} />
        <i style={{ background: swatch.card }} />
      </span>
    </span>
  );
}

function SlotCard({
  title,
  hint,
  slot,
  swatch,
  featured = false,
  onChange,
}: {
  title: string;
  hint: string;
  slot: MeetingSlotSettings | NowSlotSettings;
  swatch: ThemeSwatch;
  featured?: boolean;
  onChange: (next: MeetingSlotSettings | NowSlotSettings) => void;
}) {
  const details = slot.mode === "details";
  const busy = slot.mode === "busy";
  const now = "joinInCard" in slot ? slot : null;

  return (
    <div className="ds-slot">
      <div className="ds-slot-head">
        <h4>{title}</h4>
        <span>{hint}</span>
      </div>

      <div className="ds-modes" role="radiogroup" aria-label={`${title} privacy`}>
        {PRIVACY_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            role="radio"
            aria-checked={slot.mode === mode.id}
            className={`ds-mode${slot.mode === mode.id ? " is-on" : ""}`}
            onClick={() => onChange(withMode(slot, mode.id))}
          >
            <strong>{mode.label}</strong>
            <small>{mode.example}</small>
          </button>
        ))}
      </div>

      <div className="ds-toggles">
        <Toggle label="Start time" checked={slot.showTime} onChange={(showTime) => onChange({ ...slot, showTime })} />
        <Toggle
          label="Meeting name"
          checked={slot.showTitle}
          disabled={!details}
          onChange={(showTitle) => onChange({ ...slot, showTitle })}
        />
        <Toggle
          label="Organizer"
          checked={slot.showOrganizer}
          disabled={busy}
          onChange={(showOrganizer) => onChange({ ...slot, showOrganizer })}
        />
        <Toggle
          label="Meet or Teams"
          checked={slot.showMethod}
          disabled={!details}
          onChange={(showMethod) => onChange({ ...slot, showMethod })}
        />
        {now ? (
          <Toggle
            label="Join button on the card"
            checked={now.joinInCard}
            onChange={(joinInCard) => onChange({ ...now, joinInCard })}
          />
        ) : null}
      </div>

      <Preview slot={slot} swatch={swatch} featured={featured} join={Boolean(now?.joinInCard)} />
    </div>
  );
}

function Toggle({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={`ds-toggle${disabled ? " is-disabled" : ""}`}>
      <span>{label}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="ds-switch" aria-hidden="true" />
    </label>
  );
}

function Preview({
  slot,
  swatch,
  featured,
  join,
}: {
  slot: MeetingSlotSettings;
  swatch: ThemeSwatch;
  featured: boolean;
  join: boolean;
}) {
  const subtitle = previewSubtitle(slot);
  return (
    <div className="ds-preview" style={{ background: swatch.screen }}>
      <span className="ds-preview-label" style={{ color: swatch.accent }}>
        Panel preview
      </span>
      <div className="ds-preview-card" style={{ background: featured ? swatch.featured : swatch.card }}>
        {slot.showTime ? (
          <span className="ds-preview-time" style={{ color: swatch.text }}>
            10:00
          </span>
        ) : null}
        <span className="ds-preview-body">
          <strong style={{ color: swatch.text }}>{previewHeadline(slot)}</strong>
          {subtitle ? <small style={{ color: swatch.muted }}>{subtitle}</small> : null}
        </span>
        {join ? (
          <span className="ds-preview-join" style={{ background: swatch.joinBackground, color: swatch.joinText }}>
            Join
          </span>
        ) : null}
      </div>
    </div>
  );
}
