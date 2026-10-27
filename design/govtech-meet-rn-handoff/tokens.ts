// GovTech Meet room waiting screen: design tokens.
// All sizes are in design units at 1920 x 1080. Multiply by `scale = screenWidth / 1920`.

import { Easing } from 'react-native-reanimated';

export const DESIGN = { width: 1920, height: 1080 } as const;

export const color = {
  navy900: '#0C0D49', // gradient top, button text, tile label
  navy700: '#0A2276', // gradient bottom
  blue600: '#0839A4', // glow mid stop
  blue500: '#054BC9', // brand bright blue, whiteboard arrow
  glow: '#0A55DB',    // glow centre
  white: '#FFFFFF',
  text: {
    primary: '#FFFFFF',
    strong: 'rgba(255,255,255,0.92)',
    body: 'rgba(255,255,255,0.88)',
    secondary: 'rgba(255,255,255,0.85)',
    muted: 'rgba(255,255,255,0.80)',
  },
  status: {
    free: '#4ADE80',
    neutral: '#FFFFFF',
    starting: '#FBBF24',
    live: '#FF6B5E',
    error: '#FF6B5E',
    offline: '#FBBF24',
  },
  glass: {
    fill: 'rgba(255,255,255,0.07)',
    ring: 'rgba(255,255,255,0.18)',
    highlight: 'rgba(255,255,255,0.45)',
    wellFill: 'rgba(255,255,255,0.03)',
    wellRing: 'rgba(255,255,255,0.12)',
    wellHighlight: 'rgba(255,255,255,0.22)',
    shadow: 'rgba(6,10,58,0.30)',
  },
  ghostRing: 'rgba(255,255,255,0.35)',
  joiningFill: 'rgba(255,255,255,0.10)',
  tile: { surface: '#F1F1F4', border: '#FFFFFF', dots: 'rgba(12,13,73,0.14)', sketchLine: '#B9B9C2', sketchStroke: '#D5D5DB' },
  tileShadowRest: ['0 2 6 rgba(6,10,58,0.30)', '0 24 60 rgba(6,10,58,0.50)'],
  tileShadowLift: ['0 16 24 rgba(6,10,58,0.30)', '0 48 96 rgba(6,10,58,0.55)'],
  danger: '#B42318',
  errorText: '#FFB4AB',
} as const;

export const gradient = {
  base: { colors: ['#0C0D49', '#0C0D49', '#0A2276'], locations: [0, 0.35, 1] },
  // Radial ellipse 70% x 60% of the screen, centred at x 50%, y 112%
  glow: { cx: 0.5, cy: 1.12, rx: 0.7, ry: 0.6, stops: [{ offset: 0, color: '#0A55DB' }, { offset: 0.4, color: '#0839A4' }, { offset: 0.8, color: 'rgba(8,57,164,0)' }] },
} as const;

export const font = {
  family: 'HelveticaNowDisplay', // load licensed files with expo-font; fallback to the platform sans
  weight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
} as const;

export const type = {
  header: 24,
  status: 26,
  titleMeeting: 96, // lineHeight 1.04, letterSpacing -0.03em
  titleIdle: 72,
  titleOffline: 88,
  meta: 30,
  body: 30,
  bodyIdleUrl: 32,
  codeHero: 200,  // idle; halves gap 56; letterSpacing 0.06em
  codeCard: 72,   // share card; halves gap 28; letterSpacing 0.08em
  cardLabel: 22,
  button: 28,
  ghostButton: 24,
  tileLabel: 26,
  nextBookingLabel: 22,
  nextBookingValue: 28,
} as const;

export const space = {
  screenPadTop: 56, screenPadBottom: 64, screenPadX: 80,
  mainGap: 56, stackGap: 24, statusDotGap: 12,
  cardPad: 12, cardLabelPad: { top: 10, x: 14, bottom: 14 }, wellPad: { top: 22, x: 28, bottom: 24 },
} as const;

export const radius = { card: 28, well: 16, button: 16, ghost: 14, tile: 40, tileChip: 16, logoMark: 12 } as const;

export const size = {
  logoHeight: 44, dot: 12, primaryButtonH: 88, ghostButtonH: 64, joiningPillH: 88,
  tile: { w: 500, h: 340, right: -56, bottom: -84, rotate: '-7deg', border: 10 },
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

export type ScreenState = 'idle' | 'upcoming' | 'starting' | 'live' | 'joining' | 'error' | 'offline';

export const states: Record<ScreenState, { status: string; dot: string; ripple: boolean }> = {
  idle:     { status: 'This room is free',              dot: color.status.free,     ripple: false },
  upcoming: { status: 'Next meeting, starts in {mins} min', dot: color.status.neutral, ripple: false },
  starting: { status: 'Starting now',                   dot: color.status.starting, ripple: true },
  live:     { status: 'In progress, started {mins} min ago', dot: color.status.live, ripple: true },
  joining:  { status: 'Connecting this room',           dot: color.status.neutral,  ripple: false },
  error:    { status: 'Couldn’t join the meeting',  dot: color.status.error,    ripple: false },
  offline:  { status: 'No network connection',          dot: color.status.offline,  ripple: false },
};

export const timing = {
  upcomingLeadMin: 15,
  startingToLiveMin: 1,
  joinTimeoutSec: 20,
  errorIdleReturnSec: 60,
  offlineAfterSec: 10,
} as const;
