// A label that rolls vertically when its text changes: the old line lifts out, the new one
// rises in. Two slots alternate so a change mid-roll retargets from the current values
// (Cancel reverses the roll instead of restarting it). Both texts stay mounted, so the box
// is as wide as the wider label and each label is centred in it.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Text, View, type LayoutChangeEvent, type TextStyle } from "react-native";
import { joinMotion } from "./tokens";

export type RollTiming = { out: number; inDelay: number; in: number; travel: number; easing: (t: number) => number };

type Slot = { text: string; color: string; icon?: ReactNode };
type SlotAnim = { opacity: Animated.Value; y: Animated.Value; opacityNow: number; yNow: number };

export function RollingLabel({
  text,
  color,
  icon,
  textStyle,
  timing,
  reduced,
  snapKey,
  gap = 0,
  onMeasure,
}: {
  text: string;
  color: string;
  icon?: ReactNode;
  textStyle: TextStyle;
  timing: RollTiming;
  reduced: boolean;
  /** When this changes together with the text, the label snaps instead of rolling (the block around it is doing a handover). */
  snapKey?: string;
  /** Space between icon and text. */
  gap?: number;
  /** Width of the current label and of the wider label, after layout. */
  onMeasure?: (activeWidth: number, maxWidth: number) => void;
}) {
  const [slots, setSlots] = useState<[Slot, Slot]>([{ text, color, icon }, { text: "", color }]);
  const [active, setActive] = useState(0);
  const [widths, setWidths] = useState<[number, number]>([0, 0]);
  const heights = useRef<[number, number]>([0, 0]);
  const anim = useRef<[SlotAnim, SlotAnim]>([
    { opacity: new Animated.Value(1), y: new Animated.Value(0), opacityNow: 1, yNow: 0 },
    { opacity: new Animated.Value(0), y: new Animated.Value(0), opacityNow: 0, yNow: 0 },
  ]).current;
  const lastSnap = useRef(snapKey);

  useEffect(() => {
    const subscriptions = anim.map((slot) => ({
      y: slot.y.addListener(({ value }) => {
        slot.yNow = value;
      }),
      opacity: slot.opacity.addListener(({ value }) => {
        slot.opacityNow = value;
      }),
    }));
    return () => {
      anim.forEach((slot, index) => {
        slot.y.removeListener(subscriptions[index]!.y);
        slot.opacity.removeListener(subscriptions[index]!.opacity);
      });
    };
  }, [anim]);

  useEffect(() => {
    const snap = snapKey !== lastSnap.current;
    lastSnap.current = snapKey;
    const current = slots[active];
    if (current.text === text && current.color === color) return;
    const next = (1 - active) as 0 | 1;
    const lineHeight = Math.max(heights.current[0], heights.current[1]) || Number(textStyle.fontSize ?? 24) * 1.25;
    const travel = lineHeight * timing.travel;
    const leaving = anim[active as 0 | 1];
    const entering = anim[next];

    setSlots((previous) => {
      const copy: [Slot, Slot] = [previous[0], previous[1]];
      copy[next] = { text, color, icon };
      return copy;
    });
    setActive(next);

    if (snap) {
      leaving.opacity.setValue(0);
      leaving.y.setValue(-travel);
      entering.opacity.setValue(1);
      entering.y.setValue(0);
      return;
    }
    if (reduced) {
      leaving.y.setValue(0);
      entering.y.setValue(0);
      Animated.timing(leaving.opacity, { toValue: 0, duration: joinMotion.reduced.crossfade, useNativeDriver: true }).start();
      Animated.timing(entering.opacity, { toValue: 1, duration: joinMotion.reduced.crossfade, useNativeDriver: true }).start();
      return;
    }
    // A label still rising from below (Cancel mid-roll) goes back down; one at rest lifts out.
    const leaveTo = leaving.yNow > 0 ? travel : -travel;
    Animated.timing(leaving.opacity, { toValue: 0, duration: timing.out, easing: timing.easing, useNativeDriver: true }).start();
    Animated.timing(leaving.y, { toValue: leaveTo, duration: timing.out, easing: timing.easing, useNativeDriver: true }).start();
    // A hidden label starts below; one caught mid-exit comes back from where it is.
    if (entering.opacityNow <= 0.001) entering.y.setValue(travel);
    Animated.timing(entering.opacity, { toValue: 1, duration: timing.in, delay: timing.inDelay, easing: timing.easing, useNativeDriver: true }).start();
    Animated.timing(entering.y, { toValue: 0, duration: timing.in, delay: timing.inDelay, easing: timing.easing, useNativeDriver: true }).start();
  }, [text, color, icon, snapKey, reduced, timing, active, slots, anim, textStyle.fontSize]);

  useEffect(() => {
    onMeasure?.(widths[active as 0 | 1], Math.max(widths[0], widths[1]));
  }, [widths, active, onMeasure]);

  const measure = (index: 0 | 1) => (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    heights.current[index] = height;
    setWidths((previous) => (previous[index] === width ? previous : index === 0 ? [width, previous[1]] : [previous[0], width]));
  };

  const maxWidth = Math.max(widths[0], widths[1]);
  const line = (index: 0 | 1, absolute: boolean) => (
    <Animated.View
      key={index}
      pointerEvents="none"
      style={[
        absolute ? { position: "absolute", left: 0, right: 0, top: 0 } : null,
        { alignItems: "center", opacity: anim[index].opacity, transform: [{ translateY: anim[index].y }] },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap }} onLayout={measure(index)}>
        {slots[index].icon}
        <Text style={[textStyle, { color: slots[index].color }]} numberOfLines={1}>
          {slots[index].text}
        </Text>
      </View>
    </Animated.View>
  );

  return (
    <View style={{ minWidth: maxWidth, alignItems: "center", overflow: "hidden" }} accessible accessibilityLabel={text}>
      {line(0, false)}
      {line(1, true)}
    </View>
  );
}
