// Screen pulse on a Join press: a spark at the button's centre and a thin radial wave that
// grows until it reaches every screen corner. Sits above the background, below all content.
import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import { useScale } from "./scale";
import { color, joinMotion } from "./tokens";

export type Pulse = { id: number; cx: number; cy: number };

/** The wave Svg is drawn at this size and scaled up to 2R, so no huge canvas is allocated. */
const BASE = 1024;

export function ScreenPulse({ pulse, width, height, reduced }: { pulse: Pulse | null; width: number; height: number; reduced: boolean }) {
  const { s } = useScale();
  const spark = useRef(new Animated.Value(0)).current;
  const wave = useRef(new Animated.Value(0)).current;
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!pulse || reduced) return;
    spark.setValue(0);
    wave.setValue(0);
    setRunning(true);
    const animation = Animated.parallel([
      Animated.timing(spark, { toValue: 1, duration: joinMotion.spark.duration, easing: joinMotion.easeOut, useNativeDriver: true }),
      Animated.timing(wave, { toValue: 1, duration: joinMotion.wave.duration, delay: joinMotion.wave.delay, easing: joinMotion.easeOut, useNativeDriver: true }),
    ]);
    animation.start(({ finished }) => {
      if (finished) setRunning(false);
    });
    return () => animation.stop();
  }, [pulse, reduced, spark, wave]);

  if (!pulse || reduced || !running) return null;

  // R: distance from the press point to the farthest screen corner.
  const radius = Math.max(
    Math.hypot(pulse.cx, pulse.cy),
    Math.hypot(width - pulse.cx, pulse.cy),
    Math.hypot(pulse.cx, height - pulse.cy),
    Math.hypot(width - pulse.cx, height - pulse.cy),
  );
  const toScreen = (2 * radius) / BASE;
  const sparkSize = s(joinMotion.spark.size);
  const sparkScale = spark.interpolate({ inputRange: [...joinMotion.spark.keyframes], outputRange: [...joinMotion.spark.scale] });
  const sparkOpacity = spark.interpolate({ inputRange: [...joinMotion.spark.keyframes], outputRange: [...joinMotion.spark.opacity] });
  const waveScale = wave.interpolate({ inputRange: [...joinMotion.wave.keyframes], outputRange: joinMotion.wave.scale.map((value) => value * toScreen) });
  const waveOpacity = wave.interpolate({ inputRange: [...joinMotion.wave.keyframes], outputRange: [...joinMotion.wave.opacity] });

  return (
    <View style={[StyleSheet.absoluteFill, { overflow: "hidden" }]} pointerEvents="none">
      <Animated.View
        style={{
          position: "absolute",
          left: pulse.cx - BASE / 2,
          top: pulse.cy - BASE / 2,
          width: BASE,
          height: BASE,
          opacity: waveOpacity,
          transform: [{ scale: waveScale }],
        }}
      >
        <Svg width={BASE} height={BASE} viewBox={`0 0 ${BASE} ${BASE}`}>
          <Defs>
            <RadialGradient id="wave" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
              {joinMotion.wave.stops.map((stop) => (
                <Stop key={stop.offset} offset={stop.offset} stopColor={color.white} stopOpacity={stop.opacity} />
              ))}
            </RadialGradient>
          </Defs>
          <Circle cx={BASE / 2} cy={BASE / 2} r={BASE / 2} fill="url(#wave)" />
        </Svg>
      </Animated.View>
      <Animated.View
        style={{
          position: "absolute",
          left: pulse.cx - sparkSize / 2,
          top: pulse.cy - sparkSize / 2,
          width: sparkSize,
          height: sparkSize,
          borderRadius: sparkSize,
          backgroundColor: color.white,
          opacity: sparkOpacity,
          transform: [{ scale: sparkScale }],
        }}
      />
    </View>
  );
}
