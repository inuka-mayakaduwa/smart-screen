// GovTech Meet room waiting screen: design tokens.
// All sizes are in design units at 1920 × 1080. Multiply by `s()` from scale.ts.
import { Easing } from "react-native";

export { color } from "./palette";
export { states, timing, type ScreenState } from "./state";

export const type = {
  header: 24,
  status: 26,
  titleMeeting: 96, // lineHeight 1.04, letterSpacing -0.03em
  titleIdle: 72,
  titleOffline: 88,
  meta: 30,
  body: 30,
  bodyIdleUrl: 32,
  codeHero: 200, // idle; halves gap 56; letterSpacing 0.06em
  codeCard: 72, // share card; halves gap 28; letterSpacing 0.08em
  cardLabel: 22,
  button: 28,
  ghostButton: 24,
  tileLabel: 26,
  nextBookingLabel: 22,
  nextBookingValue: 28,
} as const;

export const space = {
  screenPadTop: 56,
  screenPadBottom: 64,
  screenPadX: 80,
  mainGap: 56,
  stackGap: 24,
  statusDotGap: 12,
  cardPad: 12,
  cardLabelPad: { top: 10, x: 14, bottom: 14 },
  wellPad: { top: 22, x: 28, bottom: 24 },
} as const;

export const radius = { card: 28, well: 16, button: 16, ghost: 14, tile: 40, tileChip: 16, logoMark: 10 } as const;

export const size = {
  logoHeight: 44,
  dot: 12,
  primaryButtonH: 88,
  ghostButtonH: 64,
  joiningPillH: 88,
  tile: { w: 500, h: 340, right: -56, bottom: -84, rotate: "-7deg", border: 10 },
} as const;

export const motion = {
  easeOut: Easing.bezier(0.23, 1, 0.32, 1),
  easeInOut: Easing.bezier(0.77, 0, 0.175, 1),
  ease: Easing.bezier(0.25, 0.1, 0.25, 1),
  glow: { duration: 14000, scaleTo: 1.06, opacityFrom: 0.85, opacityTo: 1 },
  handover: { exit: 200, enter: 400, stagger: 80, distance: 8 },
  ripple: { grow: 2400, rest: 3000, scaleTo: 2.4, opacityFrom: 0.5 },
  spinner: { duration: 1000 },
  drift: { every: 300000, duration: 2000, max: 4 },
  tileLift: { duration: 200, translate: { x: -14, y: -14 }, scale: 1.03 },
  press: { duration: 160, scale: 0.96 },
  reduced: { fade: 200, spinnerPulse: 1600, rippleStillOpacity: 0.3 },
} as const;
