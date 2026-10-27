// The glass share card in the footer (HANDOFF 3). React Native has no backdrop blur without a
// native module, so the glass is a translucent fill with rings and highlights.
import { Text, View } from "react-native";
import { CodeHalves, FooterNote } from "./blocks";
import { MonitorIcon } from "./icons";
import { useScale } from "./scale";
import { color, radius, space, type } from "./tokens";

export function GlassShareCard({
  halves,
  hostPath,
  showCode,
  showUrl,
  label,
  note,
}: {
  halves: [string, string];
  hostPath: string;
  showCode: boolean;
  showUrl: boolean;
  label: string;
  note?: string;
}) {
  const { s } = useScale();
  return (
    <View
      accessibilityLabel="Share your screen"
      style={{
        alignSelf: "flex-start",
        padding: s(space.cardPad),
        borderRadius: s(radius.card),
        backgroundColor: color.glass.fill,
        borderWidth: 1,
        borderColor: color.glass.ring,
        shadowColor: color.shadow,
        shadowOpacity: 0.3,
        shadowRadius: s(40),
        shadowOffset: { width: 0, height: s(16) },
        elevation: 12,
      }}
    >
      <View style={{ position: "absolute", top: 0, left: s(radius.card), right: s(radius.card), height: 1, backgroundColor: color.glass.highlight }} />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: s(10),
          paddingTop: s(space.cardLabelPad.top),
          paddingBottom: s(space.cardLabelPad.bottom),
          paddingHorizontal: s(space.cardLabelPad.x),
        }}
      >
        <MonitorIcon size={s(22)} color={color.text.strong} />
        <Text style={{ color: color.text.strong, fontSize: s(type.cardLabel) }}>Share your screen</Text>
      </View>
      <View
        style={{
          gap: s(14),
          paddingTop: s(space.wellPad.top),
          paddingBottom: s(space.wellPad.bottom),
          paddingHorizontal: s(space.wellPad.x),
          borderRadius: s(radius.well),
          backgroundColor: color.glass.wellFill,
          borderWidth: 1,
          borderColor: color.glass.wellRing,
          overflow: "hidden",
        }}
      >
        <View style={{ position: "absolute", top: 0, left: s(radius.well), right: s(radius.well), height: 1, backgroundColor: color.glass.wellHighlight }} />
        {showCode ? <CodeHalves halves={halves} fontSize={type.codeCard} lineHeight={type.codeCard} gap={28} tracking={0.08} label={label} /> : null}
        {showUrl && hostPath ? (
          <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: s(type.cardLabel) }}>
            Go to <Text style={{ color: color.white, fontWeight: "600" }}>{hostPath}</Text>
          </Text>
        ) : null}
        {!showCode && !showUrl ? <Text style={{ color: color.text.muted, fontSize: s(type.cardLabel) }}>Ask the room host for the code</Text> : null}
        <FooterNote note={note} />
      </View>
    </View>
  );
}
