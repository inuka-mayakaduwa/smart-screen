import type { ReactNode } from "react";
import { Image, Text, View } from "react-native";
import { useScale } from "./scale";
import { color, size, type } from "./tokens";

const GOVTECH_LOGO = require("../../../assets/govtech-logo-white.png");
const GOVTECH_LOGO_RATIO = 1200 / 317;

export function Header({
  logoUrl,
  brandName,
  roomName,
  clock,
  sessionControl,
}: {
  logoUrl?: string | null;
  brandName?: string | null;
  roomName: string;
  clock: string;
  sessionControl?: ReactNode;
}) {
  const { s } = useScale();
  const logoHeight = s(size.logoHeight);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: s(32) }} pointerEvents="box-none">
      <View style={{ flexDirection: "row", alignItems: "center", gap: s(16), flexShrink: 1 }}>
        <Image
          source={logoUrl ? { uri: logoUrl } : GOVTECH_LOGO}
          style={{ height: logoHeight, width: logoHeight * GOVTECH_LOGO_RATIO }}
          resizeMode="contain"
          accessibilityLabel={brandName ?? "GovTech Sri Lanka"}
        />
        {brandName ? (
          <Text style={{ color: color.white, fontSize: s(type.header), fontWeight: "600" }} numberOfLines={1}>
            {brandName}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: s(4) }} pointerEvents="box-none">
        <View style={{ flexDirection: "row", alignItems: "center", gap: s(24) }}>
          <Text style={{ color: color.text.muted, fontSize: s(type.header) }} numberOfLines={1}>
            {roomName}
          </Text>
          <Text style={{ color: color.white, fontSize: s(type.header), fontWeight: "600", fontVariant: ["tabular-nums"] }}>{clock}</Text>
        </View>
        {sessionControl}
      </View>
    </View>
  );
}
