export type PanelLayoutId = "classic" | "deep-space";

export type PanelTheme = {
  id: string;
  label: string;
  layout: PanelLayoutId;
  screen: string;
  scrim: string;
  clock: { color: string; fontSize: number };
  roomName: { color: string; fontSize: number };
  meta: { color: string; fontSize: number };
  section: { color: string; fontSize: number };
  card: { backgroundColor: string; borderRadius: number };
  cardFeatured: { backgroundColor: string };
  when: { color: string; fontSize: number };
  cardTitle: { color: string; fontSize: number };
  cardMeta: { color: string; fontSize: number };
  joinButton: { backgroundColor: string; color: string };
  accent: string;
  gradientFrom?: string;
  gradientTo?: string;
  statusFree: string;
  statusBusy: string;
  statusWarn: string;
  statusError: string;
  primaryButton: { backgroundColor: string; color: string };
  secondaryButton: { backgroundColor: string; color: string; borderColor: string };
  sharePanel: { backgroundColor: string; borderColor: string; labelColor: string; codeColor: string; urlColor: string };
  whiteboardCard: { backgroundColor: string; buttonBackground: string; buttonColor: string };
};

const CLASSIC: PanelTheme = {
  id: "classic",
  label: "Classic",
  layout: "classic",
  screen: "#14221c",
  scrim: "rgba(10, 16, 14, 0.62)",
  clock: { color: "white", fontSize: 72 },
  roomName: { color: "white", fontSize: 40 },
  meta: { color: "#d7e0da", fontSize: 18 },
  section: { color: "white", fontSize: 22 },
  card: { backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 16 },
  cardFeatured: { backgroundColor: "rgba(12, 107, 82, 0.85)" },
  when: { color: "white", fontSize: 22 },
  cardTitle: { color: "white", fontSize: 22 },
  cardMeta: { color: "#d7e0da", fontSize: 16 },
  joinButton: { backgroundColor: "#ffffff", color: "#0c6b52" },
  accent: "#8dceba",
  statusFree: "#8dceba",
  statusBusy: "#ff8a80",
  statusWarn: "#f0c36a",
  statusError: "#ff8a80",
  primaryButton: { backgroundColor: "#ffffff", color: "#0c6b52" },
  secondaryButton: { backgroundColor: "transparent", color: "#d7e0da", borderColor: "rgba(255,255,255,0.35)" },
  sharePanel: {
    backgroundColor: "rgba(20, 24, 22, 0.88)",
    borderColor: "transparent",
    labelColor: "#8dceba",
    codeColor: "#ffffff",
    urlColor: "#d7e0da",
  },
  whiteboardCard: { backgroundColor: "#ffffff", buttonBackground: "#14352c", buttonColor: "#ffffff" },
};

const SLATE: PanelTheme = {
  id: "slate",
  label: "Slate",
  layout: "classic",
  screen: "#101820",
  scrim: "rgba(8, 14, 22, 0.74)",
  clock: { color: "#f4f7fb", fontSize: 64 },
  roomName: { color: "#f4f7fb", fontSize: 34 },
  meta: { color: "#9db0c7", fontSize: 16 },
  section: { color: "#c7d6e8", fontSize: 20 },
  card: { backgroundColor: "rgba(148, 176, 210, 0.12)", borderRadius: 12 },
  cardFeatured: { backgroundColor: "rgba(47, 111, 176, 0.88)" },
  when: { color: "#e7eef7", fontSize: 20 },
  cardTitle: { color: "#f4f7fb", fontSize: 20 },
  cardMeta: { color: "#9db0c7", fontSize: 15 },
  joinButton: { backgroundColor: "#e7eef7", color: "#1f4f82" },
  accent: "#7eb6ff",
  statusFree: "#7eb6ff",
  statusBusy: "#ff8a80",
  statusWarn: "#f0c36a",
  statusError: "#ff8a80",
  primaryButton: { backgroundColor: "#e7eef7", color: "#1f4f82" },
  secondaryButton: { backgroundColor: "transparent", color: "#c7d6e8", borderColor: "rgba(231,238,247,0.35)" },
  sharePanel: {
    backgroundColor: "rgba(16, 24, 36, 0.88)",
    borderColor: "transparent",
    labelColor: "#7eb6ff",
    codeColor: "#f4f7fb",
    urlColor: "#9db0c7",
  },
  whiteboardCard: { backgroundColor: "#f4f7fb", buttonBackground: "#1f4f82", buttonColor: "#ffffff" },
};

const DEEP_SPACE: PanelTheme = {
  id: "deep-space",
  label: "Deep Space",
  layout: "deep-space",
  screen: "#050816",
  scrim: "rgba(4, 8, 22, 0.35)",
  clock: { color: "#ffffff", fontSize: 28 },
  roomName: { color: "#ffffff", fontSize: 22 },
  meta: { color: "rgba(255,255,255,0.78)", fontSize: 18 },
  section: { color: "rgba(255,255,255,0.7)", fontSize: 16 },
  card: { backgroundColor: "rgba(18, 36, 78, 0.55)", borderRadius: 18 },
  cardFeatured: { backgroundColor: "rgba(28, 58, 120, 0.85)" },
  when: { color: "#ffffff", fontSize: 18 },
  cardTitle: { color: "#ffffff", fontSize: 42 },
  cardMeta: { color: "rgba(255,255,255,0.78)", fontSize: 18 },
  joinButton: { backgroundColor: "#ffffff", color: "#0b1c4a" },
  accent: "#5ee0a0",
  gradientFrom: "#050816",
  gradientTo: "#163a8a",
  statusFree: "#5ee0a0",
  statusBusy: "#ff6b6b",
  statusWarn: "#f0c36a",
  statusError: "#ff6b6b",
  primaryButton: { backgroundColor: "#ffffff", color: "#0b1c4a" },
  secondaryButton: { backgroundColor: "rgba(10, 24, 64, 0.55)", color: "#ffffff", borderColor: "rgba(255,255,255,0.28)" },
  sharePanel: {
    backgroundColor: "rgba(10, 24, 64, 0.55)",
    borderColor: "rgba(255,255,255,0.14)",
    labelColor: "rgba(255,255,255,0.78)",
    codeColor: "#ffffff",
    urlColor: "rgba(255,255,255,0.72)",
  },
  whiteboardCard: { backgroundColor: "#f4f6fb", buttonBackground: "#0b1c4a", buttonColor: "#ffffff" },
};

const THEMES: Record<string, PanelTheme> = {
  classic: CLASSIC,
  slate: SLATE,
  "deep-space": DEEP_SPACE,
};

export function themeFor(id: string | undefined): PanelTheme {
  return THEMES[id ?? "classic"] ?? CLASSIC;
}
