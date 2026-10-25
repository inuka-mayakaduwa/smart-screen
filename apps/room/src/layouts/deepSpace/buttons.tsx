import { useState } from "react";
import { Animated, Pressable, Text } from "react-native";
import { FocusRing, usePressScale } from "./motion";
import { useScale } from "./scale";
import { color, radius, size, type } from "./tokens";

/** Ghost button: 64 high, 2px inner ring, white 24/600. */
export function GhostButton({ label, onPress, width, focusable = true }: { label: string; onPress: () => void; width?: number; focusable?: boolean }) {
  const { s } = useScale();
  const press = usePressScale();
  const [focused, setFocused] = useState(false);
  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        focusable={focusable}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width,
          height: s(size.ghostButtonH),
          paddingHorizontal: width ? 0 : s(32),
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
