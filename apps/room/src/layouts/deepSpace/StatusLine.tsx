// Status dot, optional live ripple (HANDOFF 6.3) and the announced status label.
import { useEffect, useRef } from "react";
import { Animated, Text, View } from "react-native";
import { useScale } from "./scale";
import { color, motion, size, space, type } from "./tokens";

export function StatusLine({ label, dot, ripple, reduced }: { label: string; dot: string; ripple: boolean; reduced: boolean }) {
  const { s } = useScale();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    progress.setValue(0);
    if (!ripple || reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, { toValue: 1, duration: motion.ripple.grow, easing: motion.easeOut, useNativeDriver: true }),
        Animated.delay(motion.ripple.rest),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [progress, ripple, reduced]);

  const dotSize = s(size.dot);
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [1, motion.ripple.scaleTo] });
  const opacity = progress.interpolate({ inputRange: [0, 1], outputRange: [motion.ripple.opacityFrom, 0] });

  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: s(space.statusDotGap) }}
      accessible
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      accessibilityLabel={label}
    >
      <View style={{ width: dotSize, height: dotSize }}>
        {ripple ? (
          <Animated.View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: dotSize,
              height: dotSize,
              borderRadius: dotSize,
              borderWidth: Math.max(1, s(2)),
              borderColor: dot,
              opacity: reduced ? motion.reduced.rippleStillOpacity : opacity,
              transform: [{ scale: reduced ? 1 : scale }],
            }}
          />
        ) : null}
        <View style={{ width: dotSize, height: dotSize, borderRadius: dotSize, backgroundColor: dot }} />
      </View>
      <Text style={{ color: color.text.body, fontSize: s(type.status), fontWeight: "500" }}>{label}</Text>
    </View>
  );
}
