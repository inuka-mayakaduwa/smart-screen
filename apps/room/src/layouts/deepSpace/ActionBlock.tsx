// Join, Joining (spinner and Cancel) and Try again (HANDOFF 4 and 6.4).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { providerLabel } from "../../meetingPresentation";
import type { Meeting } from "../../types";
import { RetryIcon, SpinnerArc } from "./icons";
import { FocusRing, usePressScale } from "./motion";
import { useScale } from "./scale";
import { color, motion, radius, size, type, type ScreenState } from "./tokens";

export function ActionBlock({
  state,
  meeting,
  busy,
  reduced,
  onJoin,
  onRetry,
  onCancel,
}: {
  state: ScreenState;
  meeting: Meeting | null;
  busy: boolean;
  reduced: boolean;
  onJoin: (meeting: Meeting) => void;
  onRetry: (meeting: Meeting) => void;
  onCancel: () => void;
}) {
  const { s } = useScale();
  if (!meeting) return null;
  const platform = providerLabel(meeting.provider);
  const named = meeting.provider !== "other";
  const joinable = Boolean(meeting.joinUrl);

  if (state === "upcoming" && joinable) {
    return <PrimaryButton label={named ? `Join on ${platform}` : "Join"} disabled={busy} onPress={() => onJoin(meeting)} />;
  }
  if ((state === "starting" || state === "live") && joinable) {
    return <PrimaryButton label={named ? `Join now on ${platform}` : "Join now"} disabled={busy} onPress={() => onJoin(meeting)} />;
  }
  if (state === "joining") {
    return (
      <View style={{ alignItems: "center", gap: s(28) }}>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={`Joining ${platform}`}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: s(16),
            height: s(size.joiningPillH),
            paddingHorizontal: s(40),
            borderRadius: s(radius.button),
            backgroundColor: color.joiningFill,
            borderWidth: 1,
            borderColor: color.joiningRing,
          }}
        >
          <Spinner size={s(32)} reduced={reduced} />
          <Text style={{ color: color.white, fontSize: s(type.button), fontWeight: "600" }}>Joining {platform}…</Text>
        </View>
        <GhostButton label="Cancel" onPress={onCancel} />
      </View>
    );
  }
  if (state === "error") {
    return (
      <PrimaryButton
        label="Try again"
        icon={<RetryIcon size={s(28)} color={color.navy900} />}
        disabled={busy}
        onPress={() => onRetry(meeting)}
      />
    );
  }
  return null;
}

export function PrimaryButton({ label, icon, disabled, onPress }: { label: string; icon?: ReactNode; disabled?: boolean; onPress: () => void }) {
  const { s } = useScale();
  const press = usePressScale();
  const [focused, setFocused] = useState(false);
  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          height: s(size.primaryButtonH),
          paddingHorizontal: s(56),
          borderRadius: s(radius.button),
          backgroundColor: color.white,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: s(12),
          opacity: disabled ? 0.7 : 1,
        }}
      >
        {icon}
        <Text style={{ color: color.navy900, fontSize: s(type.button), fontWeight: "600" }}>{label}</Text>
      </Pressable>
      <FocusRing visible={focused} radius={s(radius.button)} />
    </Animated.View>
  );
}

export function GhostButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { s } = useScale();
  const press = usePressScale();
  const [focused, setFocused] = useState(false);
  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          height: s(size.ghostButtonH),
          paddingHorizontal: s(32),
          borderRadius: s(radius.ghost),
          borderWidth: Math.max(1, s(2)),
          borderColor: color.ghostRing,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: color.white, fontSize: s(type.ghostButton), fontWeight: "600" }}>{label}</Text>
      </Pressable>
      <FocusRing visible={focused} radius={s(radius.ghost)} />
    </Animated.View>
  );
}

/** Arc rotating once a second; under reduced motion an opacity pulse instead (HANDOFF 6.7). */
function Spinner({ size: px, reduced }: { size: number; reduced: boolean }) {
  const turn = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    turn.setValue(0);
    pulse.setValue(1);
    const loop = reduced
      ? Animated.loop(
          Animated.sequence([
            Animated.timing(pulse, { toValue: 0.4, duration: motion.reduced.spinnerPulse, easing: motion.easeInOut, useNativeDriver: true }),
            Animated.timing(pulse, { toValue: 1, duration: motion.reduced.spinnerPulse, easing: motion.easeInOut, useNativeDriver: true }),
          ]),
        )
      : Animated.loop(Animated.timing(turn, { toValue: 1, duration: motion.spinner.duration, easing: (t) => t, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced, turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Animated.View style={{ width: px, height: px, opacity: pulse, transform: [{ rotate: reduced ? "0deg" : rotate }] }}>
      <SpinnerArc size={px} />
    </Animated.View>
  );
}
