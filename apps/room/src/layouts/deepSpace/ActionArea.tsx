// The action area: one 520 × 88 element that is the Join button, morphs into the Joining
// pill (glass background, rolling label, progress sweep) and back, with Cancel below.
// Join → Joining transition, approved version "D, calm pace".
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { providerLabel } from "../../meetingPresentation";
import type { Meeting } from "../../types";
import { GhostButton } from "./buttons";
import { RetryIcon } from "./icons";
import { FocusRing } from "./motion";
import { RollingLabel } from "./RollingLabel";
import { useScale } from "./scale";
import { color, joinMotion, type, type ScreenState } from "./tokens";

export function ActionArea({
  state,
  meeting,
  busy,
  reduced,
  onJoin,
  onRetry,
  onCancel,
  onPulse,
}: {
  state: ScreenState;
  meeting: Meeting | null;
  busy: boolean;
  reduced: boolean;
  onJoin: (meeting: Meeting) => void;
  onRetry: (meeting: Meeting) => void;
  onCancel: () => void;
  /** Centre of the button in window coordinates, reported on a Join press. */
  onPulse: (cx: number, cy: number) => void;
}) {
  const { s } = useScale();
  if (!meeting) return null;
  const platform = providerLabel(meeting.provider);
  const named = meeting.provider !== "other";
  const joining = state === "joining";
  const error = state === "error";
  const label = joining
    ? `Joining ${platform}…`
    : error
      ? "Try again"
      : state === "upcoming"
        ? named
          ? `Join on ${platform}`
          : "Join"
        : state === "starting" || state === "live"
          ? named
            ? `Join now on ${platform}`
            : "Join now"
          : null;
  if (!label || (!meeting.joinUrl && !error)) return null;

  return (
    <View style={{ alignItems: "center" }}>
      <MorphButton
        label={label}
        glass={joining}
        icon={error ? <RetryIcon size={s(28)} color={color.navy900} /> : undefined}
        busy={busy}
        reduced={reduced}
        onPress={() => (error ? onRetry(meeting) : onJoin(meeting))}
        onPulse={onPulse}
      />
      <CancelButton visible={joining} reduced={reduced} onPress={onCancel} />
    </View>
  );
}

function MorphButton({
  label,
  glass,
  icon,
  busy,
  reduced,
  onPress,
  onPulse,
}: {
  label: string;
  glass: boolean;
  icon?: ReactNode;
  busy: boolean;
  reduced: boolean;
  onPress: () => void;
  onPulse: (cx: number, cy: number) => void;
}) {
  const { s } = useScale();
  const ref = useRef<View>(null);
  const press = useRef(new Animated.Value(1)).current;
  const mix = useRef(new Animated.Value(glass ? 1 : 0)).current; // 0 solid white, 1 glass
  const sweepOpacity = useRef(new Animated.Value(glass ? 1 : 0)).current;
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [focused, setFocused] = useState(false);
  const w = s(joinMotion.button.w);
  const h = s(joinMotion.button.h);

  useEffect(() => {
    Animated.timing(mix, { toValue: glass ? 1 : 0, duration: joinMotion.button.background, easing: joinMotion.easeOut, useNativeDriver: true }).start();
    // The sweep fades in with the joining label and out with it.
    Animated.timing(sweepOpacity, {
      toValue: glass ? 1 : 0,
      duration: glass ? joinMotion.label.in : joinMotion.label.out,
      delay: glass ? joinMotion.label.inDelay : 0,
      easing: joinMotion.easeOut,
      useNativeDriver: true,
    }).start();
  }, [glass, mix, sweepOpacity]);

  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );

  const scaleTo = (value: number) =>
    Animated.timing(press, { toValue: value, duration: joinMotion.press.duration, easing: joinMotion.easeOut, useNativeDriver: true }).start();

  function handlePress() {
    if (glass || busy) return;
    ref.current?.measureInWindow((x, y, width, height) => onPulse(x + width / 2, y + height / 2));
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(onPress, joinMotion.switchDelay);
  }

  return (
    <Animated.View style={{ transform: [{ scale: press }] }}>
      <Pressable
        ref={ref}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy: glass, disabled: busy }}
        disabled={busy || glass}
        onPressIn={() => {
          if (!reduced) scaleTo(joinMotion.press.scale);
        }}
        onPressOut={() => scaleTo(1)}
        onPress={handlePress}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ width: w, height: h, borderRadius: s(joinMotion.button.radius), overflow: "hidden", alignItems: "center", justifyContent: "center" }}
      >
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: color.white, opacity: mix.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]} />
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: color.joiningFill, borderWidth: 1, borderColor: joinMotion.button.ringColor, borderRadius: s(joinMotion.button.radius), opacity: mix },
          ]}
        />
        <RollingLabel
          text={label}
          color={glass ? color.white : color.navy900}
          icon={icon}
          gap={s(12)}
          textStyle={{ fontSize: s(type.button), fontWeight: "600" }}
          timing={{ ...joinMotion.label, easing: joinMotion.easeOut }}
          reduced={reduced}
        />
        <Sweep active={glass} opacity={sweepOpacity} pillWidth={w} reduced={reduced} />
      </Pressable>
      <FocusRing visible={focused} radius={s(joinMotion.button.radius)} />
    </Animated.View>
  );
}

/** A short bar sweeping along the bottom edge of the pill. Under reduced motion it pulses in place. */
function Sweep({ active, opacity, pillWidth, reduced }: { active: boolean; opacity: Animated.Value; pillWidth: number; reduced: boolean }) {
  const { s } = useScale();
  const width = pillWidth * joinMotion.sweep.widthRatio;
  const x = useRef(new Animated.Value(joinMotion.sweep.from * width)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    pulse.setValue(1);
    if (!active) return;
    if (reduced) {
      x.setValue((pillWidth - width) / 2);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: joinMotion.reduced.sweepMin, duration: joinMotion.reduced.sweepPulse, easing: joinMotion.easeInOut, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: joinMotion.reduced.sweepPulse, easing: joinMotion.easeInOut, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    x.setValue(joinMotion.sweep.from * width);
    const loop = Animated.loop(
      Animated.timing(x, { toValue: joinMotion.sweep.to * width, duration: joinMotion.sweep.duration, easing: joinMotion.easeInOut, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [active, reduced, width, pillWidth, x, pulse]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        bottom: 0,
        width,
        height: s(joinMotion.sweep.h),
        borderRadius: s(joinMotion.sweep.radius),
        backgroundColor: joinMotion.sweep.color,
        opacity: Animated.multiply(opacity, pulse),
        transform: [{ translateX: x }],
      }}
    />
  );
}

/** Cancel enters 120 ms after the pill, leaves in 150 ms, and is neither focusable nor pressable while hidden. */
function CancelButton({ visible, reduced, onPress }: { visible: boolean; reduced: boolean; onPress: () => void }) {
  const { s } = useScale();
  const [mounted, setMounted] = useState(visible);
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const y = useRef(new Animated.Value(visible || reduced ? 0 : s(joinMotion.cancel.travel))).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(opacity, { toValue: 1, duration: joinMotion.cancel.in, delay: joinMotion.cancel.inDelay, easing: joinMotion.easeOut, useNativeDriver: true }).start();
      Animated.timing(y, { toValue: 0, duration: joinMotion.cancel.in, delay: joinMotion.cancel.inDelay, easing: joinMotion.easeOut, useNativeDriver: true }).start();
      return;
    }
    Animated.timing(y, { toValue: reduced ? 0 : s(joinMotion.cancel.travel), duration: joinMotion.cancel.out, easing: joinMotion.easeOut, useNativeDriver: true }).start();
    Animated.timing(opacity, { toValue: 0, duration: joinMotion.cancel.out, easing: joinMotion.easeOut, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [visible, reduced, opacity, y, s]);

  if (!mounted) return null;
  return (
    <Animated.View pointerEvents={visible ? "auto" : "none"} style={{ marginTop: s(joinMotion.cancel.gap), opacity, transform: [{ translateY: y }] }}>
      <GhostButton label="Cancel" width={s(joinMotion.cancel.w)} focusable={visible} onPress={onPress} />
    </Animated.View>
  );
}
