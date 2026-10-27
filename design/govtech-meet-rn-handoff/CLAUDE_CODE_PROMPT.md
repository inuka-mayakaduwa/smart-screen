# Prompt for Claude Code

Unzip this bundle into your React Native repo (for example as `design/govtech-meet-rn-handoff/`), open the repo in Claude Code, then paste everything below the line.

---

Implement the GovTech Meet room waiting screen in this React Native app from the handoff bundle in `design/govtech-meet-rn-handoff/`.

Read these first, in order:
1. `design/govtech-meet-rn-handoff/HANDOFF.md`: the spec (anatomy, seven states, state machine, motion, accessibility).
2. `design/govtech-meet-rn-handoff/tokens.ts`: use these values exactly. Don't round or substitute easings.
3. `design/govtech-meet-rn-handoff/reference/canvas/Animated.dc.html`: visual and motion source of truth. Open `reference/prototype/index.html` in a browser to see the target running.

Build:
- A `WaitingScreen` that renders at 1920 × 1080 design units and scales to the device with `scale = width / 1920`, landscape, immersive, screen kept awake.
- Components: `Background` (gradient + breathing glow), `Header`, `StatusLine` (with ripple), `MeetingBlock`, `IdleCodeBlock`, `OfflineBlock`, `ActionBlock` (Join, Joining with spinner and Cancel, Try again), `GlassShareCard`, `WhiteboardTile`.
- A state machine (reducer or XState) for the seven states with the transitions and timings in HANDOFF section 5, fed by props for calendar data and NetInfo for offline.
- All motion in HANDOFF section 6 with react-native-reanimated 3, transform and opacity only, plus the reduced-motion variants in 6.7.
- Accessibility per section 7, including focus states for remote or keyboard (react-native-tvos if the target is Android TV).

Libraries: react-native-reanimated, react-native-svg (radial glow, icons, sketch), expo-linear-gradient, expo-blur, @react-native-community/netinfo, expo-keep-awake. Check what the repo already uses before adding anything, and ask before adding a dependency that duplicates an existing one.

Before writing code:
- Tell me the platform you're targeting (Android TV, Android tablet, iPad) based on the repo, and confirm the scaling approach.
- List any value in HANDOFF that you can't reproduce exactly on React Native (for example the CSS backdrop blur or multi-layer shadows) and propose the closest equivalent.

Then build it in this order, pausing after each for me to check: (1) static layout of all seven states with a dev-only state switcher, (2) state machine and timers, (3) motion, (4) accessibility and reduced motion.

Out of scope: the laptop code entry page (`ShareEntry.dc.html`). It is a web page, see HANDOFF section 9.
