import { HttpError } from "./http.js";

export type MeetingPrivacyMode = "details" | "booked-by" | "busy";

export type MeetingSlotSettings = {
  mode: MeetingPrivacyMode;
  showTitle: boolean;
  showOrganizer: boolean;
  showMethod: boolean;
  showTime: boolean;
};

export type NowSlotSettings = MeetingSlotSettings & { joinInCard: boolean };

export type PanelDisplaySettings = {
  themeId: string;
  refreshSeconds: number;
  now: NowSlotSettings;
  next: MeetingSlotSettings;
};

export type ThemeSwatch = {
  screen: string;
  card: string;
  featured: string;
  text: string;
  muted: string;
  accent: string;
  joinBackground: string;
  joinText: string;
};

export type PanelThemeInfo = { id: string; label: string; description: string; swatch: ThemeSwatch };

export const PANEL_THEMES: PanelThemeInfo[] = [
  {
    id: "classic",
    label: "Classic",
    description: "Deep green board, large clock, two columns.",
    swatch: {
      screen: "#14221c",
      card: "rgba(255,255,255,0.1)",
      featured: "rgba(12,107,82,0.85)",
      text: "#ffffff",
      muted: "#d7e0da",
      accent: "#8dceba",
      joinBackground: "#ffffff",
      joinText: "#0c6b52",
    },
  },
  {
    id: "slate",
    label: "Slate",
    description: "Cool blue tones with tighter type.",
    swatch: {
      screen: "#101820",
      card: "rgba(148,176,210,0.12)",
      featured: "rgba(47,111,176,0.88)",
      text: "#f4f7fb",
      muted: "#9db0c7",
      accent: "#7eb6ff",
      joinBackground: "#e7eef7",
      joinText: "#1f4f82",
    },
  },
];

const MODES = new Set<MeetingPrivacyMode>(["details", "booked-by", "busy"]);

export function defaultMeetingSlot(mode: MeetingPrivacyMode): MeetingSlotSettings {
  if (mode === "busy") {
    return { mode, showTitle: false, showOrganizer: false, showMethod: false, showTime: true };
  }
  if (mode === "booked-by") {
    return { mode, showTitle: false, showOrganizer: true, showMethod: false, showTime: true };
  }
  return { mode: "details", showTitle: true, showOrganizer: true, showMethod: true, showTime: true };
}

export function defaultDisplaySettings(): PanelDisplaySettings {
  return {
    themeId: "classic",
    refreshSeconds: 20,
    now: { ...defaultMeetingSlot("details"), joinInCard: true },
    next: defaultMeetingSlot("details"),
  };
}

export function resolveDisplaySettings(
  defaults: PanelDisplaySettings | null | undefined,
  overrides: Partial<PanelDisplaySettings> | null | undefined,
): PanelDisplaySettings {
  const base = normalizeDisplaySettings(defaults ?? defaultDisplaySettings());
  const patch = overrides ? normalizeDisplaySettings(overrides, base) : null;
  if (!patch) return base;
  return {
    themeId: patch.themeId,
    refreshSeconds: patch.refreshSeconds,
    now: patch.now,
    next: patch.next,
  };
}

export function normalizeDisplaySettings(
  source: Partial<PanelDisplaySettings> | null | undefined,
  fallback = defaultDisplaySettings(),
): PanelDisplaySettings {
  const input = source ?? {};
  const nowMode = parseMode(input.now?.mode, fallback.now.mode);
  const nextMode = parseMode(input.next?.mode, fallback.next.mode);
  const nowDefaults = defaultMeetingSlot(nowMode);
  const nextDefaults = defaultMeetingSlot(nextMode);
  return {
    themeId: parseThemeId(input.themeId, fallback.themeId),
    refreshSeconds: parseRefreshSeconds(input.refreshSeconds, fallback.refreshSeconds),
    now: {
      mode: nowMode,
      showTitle: booleanField(input.now?.showTitle, nowDefaults.showTitle),
      showOrganizer: booleanField(input.now?.showOrganizer, nowDefaults.showOrganizer),
      showMethod: booleanField(input.now?.showMethod, nowDefaults.showMethod),
      showTime: booleanField(input.now?.showTime, nowDefaults.showTime),
      joinInCard: booleanField(input.now?.joinInCard, fallback.now.joinInCard),
    },
    next: {
      mode: nextMode,
      showTitle: booleanField(input.next?.showTitle, nextDefaults.showTitle),
      showOrganizer: booleanField(input.next?.showOrganizer, nextDefaults.showOrganizer),
      showMethod: booleanField(input.next?.showMethod, nextDefaults.showMethod),
      showTime: booleanField(input.next?.showTime, nextDefaults.showTime),
    },
  };
}

export function parseDisplayPatch(body: unknown, label: string): Partial<PanelDisplaySettings> {
  if (body === undefined) throw new HttpError(400, `${label} is required`);
  if (body === null) return {};
  if (typeof body !== "object") throw new HttpError(400, `${label} must be an object`);
  return body as Partial<PanelDisplaySettings>;
}

function parseMode(value: unknown, fallback: MeetingPrivacyMode): MeetingPrivacyMode {
  if (typeof value === "string" && MODES.has(value as MeetingPrivacyMode)) return value as MeetingPrivacyMode;
  return fallback;
}

function parseThemeId(value: unknown, fallback: string): string {
  if (typeof value === "string" && PANEL_THEMES.some((theme) => theme.id === value)) return value;
  return fallback;
}

function parseRefreshSeconds(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(seconds) || seconds < 10 || seconds > 600) {
    throw new HttpError(400, "Refresh every 10 to 600 seconds");
  }
  return seconds;
}

function booleanField(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
