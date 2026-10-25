// Motion primitives for the waiting screen, built on React Native's Animated with the
// native driver (transform and opacity only). Reduced motion follows the system setting.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, View, type StyleProp, type ViewStyle } from "react-native";
import { useScale } from "./scale";
import { color, motion } from "./tokens";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active) setReduced(value);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

/**
 * Soft handover (HANDOFF 6.2). When `stateKey` changes the block fades out and lifts 8px over
 * 200 ms, swaps its content, then fades in from 8px below over 400 ms with a stagger of
 * 80 ms × `index`. A change mid-transition stops the running animation and retargets from
 * the current values. While the key is unchanged, children render live (clock-driven copy).
 */
export function HandoverBlock({
  stateKey,
  index,
  reduced,
  style,
  children,
}: {
  stateKey: string;
  index: number;
  reduced: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const { k } = useScale();
  const opacity = useRef(new Animated.Value(1)).current;
  const shift = useRef(new Animated.Value(0)).current;
  const [shownKey, setShownKey] = useState(stateKey);
  const frozen = useRef<ReactNode>(children);
  const running = useRef<Animated.CompositeAnimation | null>(null);
  const interrupted = useRef(false);
  if (stateKey === shownKey) frozen.current = children;

  useEffect(() => {
    const distance = motion.handover.distance * k;
    const enter = (delay: number) => {
      const animation = reduced
        ? Animated.timing(opacity, { toValue: 1, duration: motion.reduced.fade, easing: motion.easeOut, useNativeDriver: true })
        : Animated.parallel([
            Animated.timing(opacity, { toValue: 1, duration: motion.handover.enter, delay, easing: motion.easeOut, useNativeDriver: true }),
            Animated.timing(shift, { toValue: 0, duration: motion.handover.enter, delay, easing: motion.easeOut, useNativeDriver: true }),
          ]);
      running.current = animation;
      animation.start(({ finished }) => {
        if (finished && running.current === animation) running.current = null;
      });
    };

    if (stateKey === shownKey) {
      if (interrupted.current) {
        interrupted.current = false;
        running.current?.stop();
        enter(0);
      }
      return;
    }

    running.current?.stop();
    interrupted.current = true;
    const exit = reduced
      ? Animated.timing(opacity, { toValue: 0, duration: motion.reduced.fade, easing: motion.easeOut, useNativeDriver: true })
      : Animated.parallel([
          Animated.timing(opacity, { toValue: 0, duration: motion.handover.exit, easing: motion.easeOut, useNativeDriver: true }),
          Animated.timing(shift, { toValue: -distance, duration: motion.handover.exit, easing: motion.easeOut, useNativeDriver: true }),
        ]);
    running.current = exit;
    exit.start(({ finished }) => {
      if (!finished) return;
      interrupted.current = false;
      shift.setValue(reduced ? 0 : distance);
      opacity.setValue(0);
      setShownKey(stateKey);
      enter(reduced ? 0 : index * motion.handover.stagger);
    });
  }, [stateKey, shownKey, reduced, index, k, opacity, shift]);

  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY: shift }] }]} pointerEvents="box-none">
      {stateKey === shownKey ? children : frozen.current}
    </Animated.View>
  );
}

/** Press feedback: scale 0.96 over 160 ms and back. */
export function usePressScale() {
  const scale = useRef(new Animated.Value(1)).current;
  const animateTo = useCallback(
    (value: number) => {
      Animated.timing(scale, { toValue: value, duration: motion.press.duration, easing: motion.ease, useNativeDriver: true }).start();
    },
    [scale],
  );
  return {
    scale,
    onPressIn: () => animateTo(motion.press.scale),
    onPressOut: () => animateTo(1),
  };
}

/** Burn-in drift (HANDOFF 6.5): every 5 minutes nudge the content layer within ±4 design px. Kept under reduced motion. */
export function DriftLayer({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { k } = useScale();
  const offset = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  useEffect(() => {
    const max = motion.drift.max * k;
    const timer = setInterval(() => {
      const random = () => (Math.random() * 2 - 1) * max;
      Animated.timing(offset, {
        toValue: { x: random(), y: random() },
        duration: motion.drift.duration,
        easing: motion.easeInOut,
        useNativeDriver: true,
      }).start();
    }, motion.drift.every);
    return () => clearInterval(timer);
  }, [k, offset]);
  return (
    <Animated.View style={[style, { transform: offset.getTranslateTransform() }]} pointerEvents="box-none">
      {children}
    </Animated.View>
  );
}

/** Visible focus for remote or keyboard: 4px white outline, offset 6. */
export function FocusRing({ visible, radius }: { visible: boolean; radius: number }) {
  const { s } = useScale();
  if (!visible) return null;
  const inset = -(s(6) + s(4));
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: inset,
        left: inset,
        right: inset,
        bottom: inset,
        borderWidth: Math.max(2, s(4)),
        borderColor: color.white,
        borderRadius: radius - inset,
      }}
    />
  );
}
