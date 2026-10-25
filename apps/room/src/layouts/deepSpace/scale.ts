import { useCallback } from "react";
import { useWindowDimensions } from "react-native";

/** The screen is designed at 1920 × 1080 and every size scales by width / 1920. */
export const DESIGN = { width: 1920, height: 1080 } as const;

export function useScale() {
  const { width, height } = useWindowDimensions();
  const k = width / DESIGN.width;
  const s = useCallback((value: number) => value * k, [k]);
  return { k, s, width, height };
}
