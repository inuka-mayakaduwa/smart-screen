// Navy gradient with the breathing glow (HANDOFF 3 and 6.1).
import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Defs, Ellipse, RadialGradient, Stop } from "react-native-svg";
import { DESIGN, useScale } from "./scale";
import { color, motion } from "./tokens";

const BASE = { colors: [color.navy900, color.navy900, color.navy700] as [string, string, string], locations: [0, 0.35, 1] as [number, number, number] };
// Radial ellipse 70% × 60% of the screen, centred at x 50%, y 112%.
const GLOW = { cx: 0.5, cy: 1.12, rx: 0.7, ry: 0.6 };

export function Background({ reduced }: { reduced: boolean }) {
  const { width, height } = useScale();
  const breath = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    breath.setValue(0);
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: motion.glow.duration, easing: motion.easeInOut, useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: motion.glow.duration, easing: motion.easeInOut, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breath, reduced]);

  // Scale around the bottom centre: move the layer down by half the growth so the bottom edge stays put.
  const scale = breath.interpolate({ inputRange: [0, 1], outputRange: [1, motion.glow.scaleTo] });
  const translateY = breath.interpolate({ inputRange: [0, 1], outputRange: [0, ((motion.glow.scaleTo - 1) * height) / 2] });
  const opacity = breath.interpolate({ inputRange: [0, 1], outputRange: [motion.glow.opacityFrom, motion.glow.opacityTo] });

  return (
    <View style={styles.fill} pointerEvents="none">
      <LinearGradient colors={BASE.colors} locations={BASE.locations} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.fill} />
      <Animated.View style={[styles.fill, { opacity, transform: [{ translateY }, { scale }] }]}>
        <Svg width={width} height={height} viewBox={`0 0 ${DESIGN.width} ${DESIGN.height}`} preserveAspectRatio="none">
          <Defs>
            <RadialGradient id="glow" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
              <Stop offset="0" stopColor={color.glow} stopOpacity={1} />
              <Stop offset="0.4" stopColor={color.blue600} stopOpacity={1} />
              <Stop offset="0.8" stopColor={color.blue600} stopOpacity={0} />
              <Stop offset="1" stopColor={color.blue600} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse
            cx={DESIGN.width * GLOW.cx}
            cy={DESIGN.height * GLOW.cy}
            rx={DESIGN.width * GLOW.rx}
            ry={DESIGN.height * GLOW.ry}
            fill="url(#glow)"
          />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
});
