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

export const FALLBACK_SWATCH: ThemeSwatch = {
  screen: "#1f2421",
  card: "rgba(255,255,255,0.1)",
  featured: "rgba(255,255,255,0.22)",
  text: "#ffffff",
  muted: "#d0d4d1",
  accent: "#b8c4bd",
  joinBackground: "#ffffff",
  joinText: "#1f2421",
};

/** Kept in sync with services/api PANEL_THEMES so the picker stays complete if the API is stale. */
export const KNOWN_PANEL_THEMES: PanelThemeInfo[] = [
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
  {
    id: "deep-space",
    label: "Deep Space",
    description: "GovTech Meet waiting screen. Navy gradient, centred share code, glass share card, whiteboard tile.",
    swatch: {
      screen: "#0C0D49",
      card: "rgba(255,255,255,0.07)",
      featured: "#0A2276",
      text: "#ffffff",
      muted: "rgba(255,255,255,0.80)",
      accent: "#054BC9",
      joinBackground: "#ffffff",
      joinText: "#0C0D49",
    },
  },
];

export function mergePanelThemes(fromApi: PanelThemeInfo[] | undefined): PanelThemeInfo[] {
  const byId = new Map<string, PanelThemeInfo>();
  for (const theme of KNOWN_PANEL_THEMES) byId.set(theme.id, theme);
  for (const theme of fromApi ?? []) byId.set(theme.id, theme);
  return [...byId.values()];
}

export const SAMPLE_MEETING = {
  title: "Quarterly planning",
  organizer: "Priya Fernando",
  method: "Microsoft Teams",
};

export const PRIVACY_MODES: { id: MeetingPrivacyMode; label: string; example: string }[] = [
  { id: "details", label: "Full details", example: "Name, organizer, app" },
  { id: "booked-by", label: "Booked by", example: `Booked by ${SAMPLE_MEETING.organizer}` },
  { id: "busy", label: "Busy only", example: "Busy" },
];

export function withMode<T extends MeetingSlotSettings>(slot: T, mode: MeetingPrivacyMode): T {
  if (mode === "busy") return { ...slot, mode, showTitle: false, showOrganizer: false, showMethod: false, showTime: true };
  if (mode === "booked-by") return { ...slot, mode, showTitle: false, showOrganizer: true, showMethod: false, showTime: true };
  return { ...slot, mode, showTitle: true, showOrganizer: true, showMethod: true, showTime: true };
}

export function previewHeadline(slot: MeetingSlotSettings): string {
  if (slot.mode === "busy") return "Busy";
  if (slot.mode === "booked-by") return slot.showOrganizer ? `Booked by ${SAMPLE_MEETING.organizer}` : "Booked";
  if (slot.showTitle) return SAMPLE_MEETING.title;
  if (slot.showOrganizer) return SAMPLE_MEETING.organizer;
  return "Meeting";
}

export function previewSubtitle(slot: MeetingSlotSettings): string | null {
  if (slot.mode !== "details") return null;
  const parts: string[] = [];
  if (slot.showTitle && slot.showOrganizer) parts.push(SAMPLE_MEETING.organizer);
  if (slot.showMethod) parts.push(SAMPLE_MEETING.method);
  return parts.length ? parts.join(" · ") : null;
}

export function modeLabel(mode: MeetingPrivacyMode): string {
  return PRIVACY_MODES.find((item) => item.id === mode)?.label ?? mode;
}

export function refreshLabel(seconds: number): string {
  if (seconds % 60 === 0) return seconds === 60 ? "1 minute" : `${seconds / 60} minutes`;
  return `${seconds} seconds`;
}
