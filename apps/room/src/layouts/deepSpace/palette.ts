// Colours for the GovTech Meet waiting screen (the Deep Space theme).
// No React Native imports here: state.ts shares this file and runs in plain Node tests.
export const color = {
  navy900: "#0C0D49", // gradient top, button text, tile label
  navy700: "#0A2276", // gradient bottom
  blue600: "#0839A4", // glow mid stop
  blue500: "#054BC9", // brand bright blue, whiteboard arrow
  glow: "#0A55DB", // glow centre
  white: "#FFFFFF",
  text: {
    primary: "#FFFFFF",
    strong: "rgba(255,255,255,0.92)",
    body: "rgba(255,255,255,0.88)",
    secondary: "rgba(255,255,255,0.85)",
    muted: "rgba(255,255,255,0.80)",
  },
  status: {
    free: "#4ADE80",
    neutral: "#FFFFFF",
    starting: "#FBBF24",
    live: "#FF6B5E",
    error: "#FF6B5E",
    offline: "#FBBF24",
  },
  glass: {
    fill: "rgba(255,255,255,0.07)",
    ring: "rgba(255,255,255,0.18)",
    highlight: "rgba(255,255,255,0.45)",
    wellFill: "rgba(255,255,255,0.03)",
    wellRing: "rgba(255,255,255,0.12)",
    wellHighlight: "rgba(255,255,255,0.22)",
  },
  ghostRing: "rgba(255,255,255,0.35)",
  joiningFill: "rgba(255,255,255,0.10)",
  joiningRing: "rgba(255,255,255,0.18)",
  tile: { surface: "#F1F1F4", border: "#FFFFFF", dots: "rgba(12,13,73,0.14)", sketchLine: "#B9B9C2", sketchStroke: "#D5D5DB" },
  shadow: "#060A3A",
  errorText: "#FFB4AB",
} as const;
