// The tilted whiteboard tile bleeding off the bottom-right corner (HANDOFF 3 and 6.6).
import { useRef, useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import Svg, { Circle, Defs, Path, Pattern, Rect } from "react-native-svg";
import { PenIcon } from "./icons";
import { FocusRing } from "./motion";
import { useScale } from "./scale";
import { color, motion, radius, size, type } from "./tokens";

const INNER = { w: size.tile.w - size.tile.border * 2, h: size.tile.h - size.tile.border * 2 };

export function WhiteboardTile({ onPress, disabled, reduced }: { onPress: () => void; disabled?: boolean; reduced: boolean }) {
  const { s } = useScale();
  const w = s(size.tile.w);
  const h = s(size.tile.h);
  const lift = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(1)).current;
  const [focused, setFocused] = useState(false);

  const animateLift = (to: number) =>
    Animated.timing(lift, { toValue: to, duration: motion.tileLift.duration, easing: motion.ease, useNativeDriver: true }).start();
  const animatePress = (to: number) =>
    Animated.timing(press, { toValue: to, duration: motion.press.duration, easing: motion.ease, useNativeDriver: true }).start();

  // Under reduced motion the lift is shadow only: the tile does not move or grow.
  const liftX = lift.interpolate({ inputRange: [0, 1], outputRange: [0, reduced ? 0 : s(motion.tileLift.translate.x)] });
  const liftY = lift.interpolate({ inputRange: [0, 1], outputRange: [0, reduced ? 0 : s(motion.tileLift.translate.y)] });
  const liftScale = lift.interpolate({ inputRange: [0, 1], outputRange: [1, reduced ? 1 : motion.tileLift.scale] });
  const scale = Animated.multiply(liftScale, press);

  return (
    <Animated.View
      style={{
        position: "absolute",
        right: s(size.tile.right),
        bottom: s(size.tile.bottom),
        width: w,
        height: h,
        // Rotate and scale around the bottom-right corner: move the pivot to the origin, transform, move back.
        transform: [
          { translateX: w / 2 },
          { translateY: h / 2 },
          { translateX: liftX },
          { translateY: liftY },
          { rotate: size.tile.rotate },
          { scale },
          { translateX: -w / 2 },
          { translateY: -h / 2 },
        ],
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: s(radius.tile),
          backgroundColor: color.tile.surface,
          opacity: lift,
          shadowColor: color.shadow,
          shadowOpacity: 0.55,
          shadowRadius: s(96),
          shadowOffset: { width: 0, height: s(48) },
          elevation: 24,
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open whiteboard"
        disabled={disabled}
        onPress={onPress}
        onHoverIn={() => animateLift(1)}
        onHoverOut={() => animateLift(0)}
        onFocus={() => {
          setFocused(true);
          animateLift(1);
        }}
        onBlur={() => {
          setFocused(false);
          animateLift(0);
        }}
        onPressIn={() => animatePress(motion.press.scale)}
        onPressOut={() => animatePress(1)}
        style={{
          flex: 1,
          borderWidth: s(size.tile.border),
          borderColor: color.tile.border,
          borderRadius: s(radius.tile),
          backgroundColor: color.tile.surface,
          overflow: "hidden",
          shadowColor: color.shadow,
          shadowOpacity: 0.5,
          shadowRadius: s(60),
          shadowOffset: { width: 0, height: s(24) },
          elevation: 12,
        }}
      >
        <Svg
          width={s(INNER.w)}
          height={s(INNER.h)}
          viewBox={`0 0 ${INNER.w} ${INNER.h}`}
          style={{ position: "absolute", top: 0, left: 0 }}
          pointerEvents="none"
        >
          <Defs>
            <Pattern id="dots" patternUnits="userSpaceOnUse" width={22} height={22}>
              <Circle cx={11} cy={11} r={1.5} fill={color.tile.dots} />
            </Pattern>
          </Defs>
          <Rect x={0} y={0} width={INNER.w} height={INNER.h} fill="url(#dots)" />
          <Rect x={44} y={118} width={130} height={96} rx={12} fill={color.white} stroke={color.tile.sketchStroke} strokeWidth={2} />
          <Path d="M64 146h84M64 166h64M64 186h76" stroke={color.tile.sketchLine} strokeWidth={6} strokeLinecap="round" />
          <Path d="M190 166c40-4 62-22 96-20" stroke={color.blue500} strokeWidth={4} strokeLinecap="round" />
          <Path d="m276 136 12 10-14 8" stroke={color.blue500} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
          <Circle cx={350} cy={150} r={40} fill="none" stroke={color.navy900} strokeWidth={4} />
          <Path d="M90 250c26-18 46 14 72-4s40 10 64-6" stroke={color.navy900} strokeWidth={4} strokeLinecap="round" />
        </Svg>
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: s(28),
            top: s(26),
            flexDirection: "row",
            alignItems: "center",
            gap: s(14),
            paddingVertical: s(12),
            paddingLeft: s(14),
            paddingRight: s(20),
            borderRadius: s(radius.tileChip),
            backgroundColor: color.navy900,
          }}
        >
          <View style={{ width: s(40), height: s(40), borderRadius: s(radius.logoMark), backgroundColor: color.white, alignItems: "center", justifyContent: "center" }}>
            <PenIcon size={s(24)} color={color.navy900} />
          </View>
          <Text style={{ color: color.white, fontSize: s(type.tileLabel), fontWeight: "600" }}>Open whiteboard</Text>
        </View>
      </Pressable>
      <FocusRing visible={focused} radius={s(radius.tile)} />
    </Animated.View>
  );
}
