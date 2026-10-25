# GovTech Meet: room waiting screen, React Native handoff

Implementation spec for the final animated waiting screen set. Everything here comes from the approved design canvas ("Final · Waiting screen states" and "Final · Animated" rows). When this file and the reference HTML disagree, the reference HTML in `reference/` wins for visuals and this file wins for behaviour.

## 1. What's in this bundle

| Path | What it is |
| --- | --- |
| `HANDOFF.md` | This spec |
| `CLAUDE_CODE_PROMPT.md` | Paste-ready prompt for Claude Code |
| `tokens.ts` | Colours, type, spacing, radii, motion and state table, ready to import |
| `assets/govtech-logo-white.png` | White GovTech Sri Lanka logo, 1200 × 317 (use `@full` for 4091 × 1080) |
| `reference/prototype/index.html` | Working web prototype of all states and animations. Open in a browser to see the target behaviour |
| `reference/canvas/Animated.dc.html` | Source of truth for the animated room screen (markup, values, motion code) |
| `reference/canvas/Final.dc.html` | Static master for all seven states |
| `reference/canvas/State*.dc.html` | One file per state (they import `Final`) |
| `reference/canvas/ShareEntry.dc.html` | Laptop page for entering the room code (web, see section 9) |

The `.dc.html` files are a design-tool format: plain HTML with inline styles plus a small `renderVals()` class. Read them as specs, don't port the format.

## 2. Target

- A full-screen app on the meeting room display. Designed at **1920 × 1080 (16:9, landscape)**. Scale everything by `scale = screenWidth / 1920` so the layout is identical on 1280 × 720 and 3840 × 2160 panels.
- Touch first. The display may also take a remote or keyboard (Android TV via `react-native-tvos`), so every control needs a focus state.
- No status bar, no navigation bar (immersive mode), screen kept awake.

## 3. Screen anatomy (1920 × 1080 units)

```
padding: 56 top, 64 bottom, 80 left and right
┌ Header (row, space-between, 24 font) ─────────────────────────────┐
│ GovTech logo 44 high                     Room name · Clock (600)   │
├ Main (flex 1, centred column, gap 56) ────────────────────────────┤
│   Status line (dot 12 + label 26/500)                              │
│   Title block   (state dependent, see 4)                           │
│   Detail block  (state dependent)                                  │
│   Action block  (state dependent)                                  │
├ Footer (row, align end, min height 64) ───────────────────────────┤
│ Glass share card (left)                                            │
└──────────────────────────── Whiteboard tile, bottom-right, bleeds ─┘
```

Background, back to front:
1. Linear gradient, top to bottom: `#0C0D49` 0%, `#0C0D49` 35%, `#0A2276` 100%.
2. Glow layer (animated, see 6.1): radial ellipse 70% × 60% centred at x 50%, y 112%: `#0A55DB` 0%, `#0839A4` 40%, transparent 80%. Use `react-native-svg` `RadialGradient` on an absolute-fill `Svg`.

### Glass share card
- Outer: padding 12, radius 28, fill `rgba(255,255,255,0.07)`, background blur 16 (`expo-blur` `BlurView`, intensity about 30, tint "dark"), 1px inner ring `rgba(255,255,255,0.18)`, 1px top highlight `rgba(255,255,255,0.45)`, drop shadow `0 16 40 rgba(6,10,58,0.30)`.
- Label row: monitor icon 22 (stroke 1.5) + "Share your screen", 22, `rgba(255,255,255,0.92)`, padding 10/14/14/14.
- Inner well: radius 16 (concentric: 28 − 12), padding 22/28/24, fill `rgba(255,255,255,0.03)`, ring `rgba(255,255,255,0.12)`, top highlight `rgba(255,255,255,0.22)`.
- Code: two halves ("4NQ" "WRV"), gap 28, 72/700, letter spacing 0.08em, tabular numbers. Accessibility label reads characters one by one: "Share code 4 N Q W R V".
- URL line: "Go to **meet.govtech.lk/4NQWRV**", 22.

### Whiteboard tile
- 500 × 340, anchored right −56 and bottom −84 (it bleeds off the corner), rotated −7deg around its bottom-right corner.
- 10 white border, radius 40, fill `#F1F1F4`, dot grid (1.5 dots every 22, `rgba(12,13,73,0.14)`), a small sketch (sticky note, blue arrow `#054BC9`, navy circle and scribble `#0C0D49`).
- Label chip top-left (28, 26): navy `#0C0D49`, radius 16, white icon square 40 with pen icon, "Open whiteboard" 26/600.
- The whole tile is one pressable. Accessibility label "Open whiteboard".

## 4. States

| # | id | Status label | Dot | Title block | Detail block | Action block | Footer |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `idle` | This room is free | `#4ADE80` | "Share your screen" 72 + code 200 (two halves, gap 56) | "Go to **meet.govtech.lk/CODE** on your laptop" 32 | none | "Next booking" + booking line |
| 2 | `upcoming` | Next meeting, starts in N min | `#FFFFFF` | Meeting name 96/700, balanced wrap, never truncated | `10:00–11:00 · Organised by NAME · PLATFORM` 30 | "Join on PLATFORM" | Glass share card |
| 3 | `starting` | Starting now | `#FBBF24` + ripple | as 2 | as 2 | "Join now on PLATFORM" | Glass share card |
| 4 | `live` | In progress, started N min ago | `#FF6B5E` + ripple | as 2 | as 2 | "Join now on PLATFORM" | Glass share card |
| 5 | `joining` | Connecting this room | `#FFFFFF` | as 2 | as 2 | Pill "Joining PLATFORM…" with spinner, then "Cancel" ghost button | Glass share card |
| 6 | `error` | Couldn't join the meeting | `#FF6B5E` | as 2 | as 2 + "PLATFORM didn't respond. Try again, or join from your laptop and share your screen with the code below." | "Try again" with retry icon | Glass share card |
| 7 | `offline` | No network connection | `#FBBF24` | "This screen is offline" 88 | "Joining and screen sharing will come back on their own when the network returns. If it's down for more than a few minutes, call IT support on [IT EXTENSION]." | none | none |

The status line is a live region (`accessibilityLiveRegion="polite"`) so screen readers announce state changes. Every dot colour is paired with words; never rely on colour alone.

Buttons: primary 88 high, padding 56, radius 16, white fill, navy text 28/600. Ghost: 64 high, 2px inner ring `rgba(255,255,255,0.35)`, white text 24/600. Press feedback scale 0.96 over 160ms.

## 5. State machine

```
idle      → upcoming   15 min before a booking
upcoming  → starting   at start time
starting  → live       1 min after start
live      → idle       meeting ends, nothing booked within 15 min
live      → upcoming   meeting ends, next booking within 15 min
upcoming | starting | live → joining     Join pressed
joining   → (leave this screen)          call connected
joining   → error                        no answer after 20 s
joining   → previous state               Cancel
error     → joining                      Try again
error     → previous state               60 s with no touch
any       → offline                      network lost for 10 s (NetInfo)
offline   → previous state               network back
```

Implement as a reducer (or XState) with the timings as constants. The whiteboard opens from every state, offline included.

## 6. Motion

All values are exact. Use `react-native-reanimated` 3. Animate transform and opacity only.

| Token | Value | Reanimated |
| --- | --- | --- |
| ease-out | cubic-bezier(0.23, 1, 0.32, 1) | `Easing.bezier(0.23, 1, 0.32, 1)` |
| ease-in-out | cubic-bezier(0.77, 0, 0.175, 1) | `Easing.bezier(0.77, 0, 0.175, 1)` |
| ease (hover) | cubic-bezier(0.25, 0.1, 0.25, 1) | `Easing.bezier(0.25, 0.1, 0.25, 1)` |

### 6.1 Breathing glow (always on)
Glow layer: scale 1 → 1.06 and opacity 0.85 → 1, 14 000 ms, ease-in-out, repeat forever, reversing. Transform origin is the bottom centre: scale around it by translating Y in step, or wrap the layer so its pivot sits at the bottom edge.
`withRepeat(withTiming(1, { duration: 14000, easing: easeInOut }), -1, true)` driving both values.

### 6.2 Soft handover (every state change)
Five blocks animate: status, title, detail, action, footer.
- Exit: opacity 1 → 0 and translateY 0 → −8, 200 ms, ease-out, all at once.
- Swap content after 200 ms.
- Enter: opacity 0 → 1 and translateY 8 → 0, 400 ms, ease-out, delays 0, 80, 160, 240, 320 ms in block order.
Use custom Reanimated `entering`/`exiting` layout animations (the built-in FadeInDown travels too far). A new state change mid-transition must cancel and retarget, never queue.

### 6.3 Live ripple (starting and live only)
A 2px ring in the dot's colour behind the dot: scale 1 → 2.4 and opacity 0.5 → 0 over 2 400 ms (ease-out), then hold invisible for 3 000 ms. Loop. Total cycle 5 400 ms.

### 6.4 Joining spinner
Arc (12 radius, 3 stroke, track `rgba(255,255,255,0.25)`, arc white) rotates 360deg every 1 000 ms, linear, forever.

### 6.5 Burn-in drift
Every 5 minutes move the whole content layer (not the background) to a random offset within ±4 on each axis over 2 000 ms, ease-in-out. Nobody should notice it.

### 6.6 Whiteboard lift (approved variant: diagonal)
On focus (remote or keyboard), or on mouse hover where a pointer exists:
- Tile: translate (−14, −14), keep rotate −7deg, scale 1.03, 200 ms, ease.
- Deeper shadow layer `0 16 24 rgba(6,10,58,0.30)` + `0 48 96 rgba(6,10,58,0.55)` fades in, 200 ms. Animate a separate shadow view's opacity, not the shadow itself.
- Reverses the same way on blur. Must retarget smoothly if focus flips quickly.
- Touch screens have no hover: on touch, use the standard press feedback (scale 0.96, 160 ms) instead, then open the whiteboard.

### 6.7 Reduced motion
Read `useReducedMotion()` (Reanimated) or `AccessibilityInfo.isReduceMotionEnabled()`.
- Glow: frozen at rest.
- Handover: opacity only, 200 ms both ways, no stagger, no movement.
- Ripple: a still ring at opacity 0.3.
- Spinner: opacity pulse 0.4 ↔ 1, 1 600 ms, reversing.
- Whiteboard lift: shadow only, no movement.
- Burn-in drift: keep it (invisible, protects the panel).

## 7. Accessibility checklist

- Every pressable has a role and label. The tile and code use the labels in section 3.
- Visible focus for remote or keyboard: 4px white outline, offset 6.
- Text contrast is AA or better on every state (all body text is white at 0.8 opacity or higher on navy).
- Status announced on change. Meeting names wrap; nothing truncates.
- Minimum touch target 88 high on primary actions.

## 8. Things to confirm before building

- **Fonts.** The design uses Helvetica Now Display, a paid Monotype font. Ship the licensed `.otf` files in the app (`expo-font`) or fall back to the platform sans. Android has no Helvetica, so without the files it renders Roboto.
- **IT support number** for the offline screen (placeholder `[IT EXTENSION]`).
- **Sample data.** Meeting names, times, organiser, room name, booking line and clock values in the reference are samples. Wire them to the calendar and room config.
- **Join behaviour** for Meet and Teams on the device (deep link, embedded web view, or a room system integration).

## 9. The laptop page (`ShareEntry.dc.html`) is web, not native

People open meet.govtech.lk on their own laptop and type the code. Sharing a screen from a browser uses `navigator.mediaDevices.getDisplayMedia`, which only exists on the web. Build this page as a web app (Next.js or similar). If the team wants one codebase, React Native Web can render it, but the capture call is still the browser API. States: enter (empty), code entered, wrong code (inline error, red ring), connecting (spinner in button), sharing ("You're sharing to ROOM", Stop sharing). Code input: one real text field behind six display boxes (3 + 3), uppercase, letters and numbers only, max 6, submit disabled until 6.
