// Status line: dot (with ripple and colour cross-fade) plus a centred rolling label.
// The dot glides sideways by (widest label − current label) / 2 so it keeps touching the
// visible text and the pair stays centred on screen.
import { useEffect, useRef, useState } from "react";
import { Animated, View } from "react-native";
import { RollingLabel } from "./RollingLabel";
import { useScale } from "./scale";
import { color, joinMotion, motion, size, space, type } from "./tokens";

export function StatusRoll({ label, dot, ripple, reduced, snapKey }: { label: string; dot: string; ripple: boolean; reduced: boolean; snapKey: string }) {
  const { s } = useScale();
  const glide = useRef(new Animated.Value(0)).current;
  const measured = useRef(false);
  const [measure, setMeasure] = useState({ active: 0, max: 0 });

  useEffect(() => {
    const target = (measure.max - measure.active) / 2;
    if (!measured.current) {
      measured.current = measure.max > 0;
      glide.setValue(target);
      return;
    }
    Animated.timing(glide, {
      toValue: target,
      duration: reduced ? joinMotion.reduced.glide : joinMotion.status.glide,
      easing: joinMotion.easeCalm,
      useNativeDriver: true,
    }).start();
  }, [glide, measure, reduced]);

  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: s(space.statusDotGap) }}
      accessible
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      accessibilityLabel={label}
    >
      <Animated.View style={{ transform: [{ translateX: glide }] }}>
        <CrossfadeDot color={dot} ripple={ripple} reduced={reduced} />
      </Animated.View>
      <RollingLabel
        text={label}
        color={color.text.body}
        textStyle={{ fontSize: s(type.status), fontWeight: "500" }}
        timing={{ ...joinMotion.status, easing: joinMotion.easeCalm }}
        reduced={reduced}
        snapKey={snapKey}
        onMeasure={(active, max) => setMeasure((previous) => (previous.active === active && previous.max === max ? previous : { active, max }))}
      />
    </View>
  );
}

/** Two stacked dot layers cross-fade on a colour change; the ripple ring (HANDOFF 6.3) sits behind. */
function CrossfadeDot({ color: next, ripple, reduced }: { color: string; ripple: boolean; reduced: boolean }) {
  const { s } = useScale();
  const [pair, setPair] = useState({ from: next, to: next });
  const mix = useRef(new Animated.Value(1)).current;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (next === pair.to) return;
    setPair({ from: pair.to, to: next });
    mix.setValue(0);
    Animated.timing(mix, { toValue: 1, duration: joinMotion.status.dot, easing: joinMotion.easeCalm, useNativeDriver: true }).start();
  }, [next, pair.to, mix]);

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
  const layer = { position: "absolute" as const, top: 0, left: 0, width: dotSize, height: dotSize, borderRadius: dotSize };

  return (
    <View style={{ width: dotSize, height: dotSize }}>
      {ripple ? (
        <Animated.View
          style={[
            layer,
            {
              borderWidth: Math.max(1, s(2)),
              borderColor: pair.to,
              opacity: reduced ? motion.reduced.rippleStillOpacity : opacity,
              transform: [{ scale: reduced ? 1 : scale }],
            },
          ]}
        />
      ) : null}
      <View style={[layer, { backgroundColor: pair.from }]} />
      <Animated.View style={[layer, { backgroundColor: pair.to, opacity: mix }]} />
    </View>
  );
}
