// Title, detail and footer text blocks for each state (HANDOFF 4). Privacy modes from the
// admin Now and Next settings decide how much of a meeting is shown.
import { Text, View } from "react-native";
import { meetingHeadline, providerLabel } from "../../meetingPresentation";
import type { Meeting, MeetingSlotSettings } from "../../types";
import { useScale } from "./scale";
import { color, space, type } from "./tokens";

export function CodeHalves({
  halves,
  fontSize,
  lineHeight,
  gap,
  tracking,
  label,
}: {
  halves: [string, string];
  fontSize: number;
  lineHeight: number;
  gap: number;
  /** Letter spacing as a fraction of the font size (0.06 for 0.06em). */
  tracking: number;
  label: string;
}) {
  const { s } = useScale();
  const letterSpacing = s(fontSize * tracking);
  return (
    <View style={{ flexDirection: "row", gap: s(gap) }} accessible accessibilityLabel={label}>
      {halves.map((half, index) => (
        <Text
          key={index}
          importantForAccessibility="no"
          style={{
            color: color.white,
            fontSize: s(fontSize),
            lineHeight: s(lineHeight),
            fontWeight: "700",
            letterSpacing,
            marginRight: -letterSpacing,
            fontVariant: ["tabular-nums"],
          }}
        >
          {half}
        </Text>
      ))}
    </View>
  );
}

export function MeetingTitle({ meeting, slot }: { meeting: Meeting; slot: MeetingSlotSettings }) {
  const { s } = useScale();
  return (
    <Text
      accessibilityRole="header"
      style={{
        color: color.white,
        fontSize: s(type.titleMeeting),
        lineHeight: s(type.titleMeeting * 1.04),
        letterSpacing: s(type.titleMeeting * -0.03),
        fontWeight: "700",
        textAlign: "center",
        maxWidth: s(1240),
      }}
    >
      {meetingHeadline(meeting, slot)}
    </Text>
  );
}

export function IdleTitle({ halves, showCode, label }: { halves: [string, string]; showCode: boolean; label: string }) {
  const { s } = useScale();
  return (
    <View style={{ alignItems: "center", gap: s(space.stackGap) }}>
      <Text
        accessibilityRole="header"
        style={{
          color: color.white,
          fontSize: s(type.titleIdle),
          lineHeight: s(type.titleIdle * 1.05),
          letterSpacing: s(type.titleIdle * -0.03),
          fontWeight: "700",
          textAlign: "center",
        }}
      >
        Share your screen
      </Text>
      {showCode ? <CodeHalves halves={halves} fontSize={type.codeHero} lineHeight={type.codeHero * 0.95} gap={56} tracking={0.06} label={label} /> : null}
    </View>
  );
}

export function OfflineTitle() {
  const { s } = useScale();
  return (
    <Text
      accessibilityRole="header"
      style={{
        color: color.white,
        fontSize: s(type.titleOffline),
        lineHeight: s(type.titleOffline * 1.05),
        letterSpacing: s(type.titleOffline * -0.03),
        fontWeight: "700",
        textAlign: "center",
      }}
    >
      This screen is offline
    </Text>
  );
}

export function formatTime(iso: string, timezone?: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", ...(timezone ? { timeZone: timezone } : {}) }).format(new Date(iso));
}

export function formatTimeRange(meeting: Meeting, timezone?: string): string {
  return `${formatTime(meeting.start, timezone)}–${formatTime(meeting.end, timezone)}`;
}

/** The detail parts under a meeting title, in display order, each marked strong or not. */
export function meetingDetailParts(meeting: Meeting, slot: MeetingSlotSettings, timezone?: string): { text: string; strong: boolean }[] {
  const parts: { text: string; strong: boolean }[] = [];
  if (slot.showTime) parts.push({ text: formatTimeRange(meeting, timezone), strong: true });
  if (slot.mode === "details" && slot.showOrganizer && meeting.organizer) parts.push({ text: `Organised by ${meeting.organizer}`, strong: false });
  if (slot.showMethod) parts.push({ text: providerLabel(meeting.provider), strong: false });
  return parts;
}

export function MeetingDetail({ meeting, slot, timezone }: { meeting: Meeting; slot: MeetingSlotSettings; timezone?: string }) {
  const { s } = useScale();
  const parts = meetingDetailParts(meeting, slot, timezone);
  if (!parts.length) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", columnGap: s(20), rowGap: s(8), maxWidth: s(1240) }}>
      {parts.map((part, index) => (
        <View key={index} style={{ flexDirection: "row", columnGap: s(20) }}>
          {index > 0 ? (
            <Text importantForAccessibility="no" style={{ color: color.text.muted, fontSize: s(type.meta) }}>
              ·
            </Text>
          ) : null}
          <Text
            style={{
              color: part.strong ? color.white : color.text.muted,
              fontSize: s(type.meta),
              fontWeight: part.strong ? "600" : "400",
              fontVariant: part.strong ? ["tabular-nums"] : undefined,
            }}
          >
            {part.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function IdleDetail({ hostPath }: { hostPath: string }) {
  const { s } = useScale();
  if (!hostPath) return null;
  return (
    <Text style={{ color: color.text.body, fontSize: s(type.bodyIdleUrl), textAlign: "center" }}>
      Go to <Text style={{ color: color.white, fontWeight: "600" }}>{hostPath}</Text> on your laptop
    </Text>
  );
}

export function OfflineDetail({ supportContact }: { supportContact?: string | null }) {
  const { s } = useScale();
  const support = supportContact?.trim();
  return (
    <Text style={{ color: color.text.secondary, fontSize: s(type.body), lineHeight: s(type.body * 1.4), textAlign: "center", maxWidth: s(980) }}>
      Joining and screen sharing will come back on their own when the network returns.
      {support ? ` If it’s down for more than a few minutes, call IT support on ${support}.` : ""}
    </Text>
  );
}

export function ErrorDetail({ meeting, reason }: { meeting: Meeting; reason?: string }) {
  const { s } = useScale();
  const lead = reason?.trim().replace(/\.$/, "") || `${providerLabel(meeting.provider)} didn’t respond`;
  return (
    <Text
      style={{
        color: color.text.body,
        fontSize: s(type.body),
        lineHeight: s(type.body * 1.4),
        textAlign: "center",
        maxWidth: s(980),
        marginTop: s(space.stackGap),
      }}
    >
      {lead}. Try again, or join from your laptop and share your screen with the code below.
    </Text>
  );
}

export function NextBooking({ meeting, slot, timezone }: { meeting: Meeting | null; slot: MeetingSlotSettings; timezone?: string }) {
  const { s } = useScale();
  const line = meeting ? `Today at ${formatTime(meeting.start, timezone)}, ${meetingHeadline(meeting, slot)}` : "Nothing else booked today";
  return (
    <View style={{ gap: s(6), maxWidth: s(900) }}>
      <Text style={{ color: color.text.secondary, fontSize: s(type.nextBookingLabel) }}>Next booking</Text>
      <Text style={{ color: color.white, fontSize: s(type.nextBookingValue), fontWeight: "600" }}>{line}</Text>
    </View>
  );
}

export function FooterNote({ note }: { note?: string }) {
  const { s } = useScale();
  if (!note) return null;
  return (
    <Text style={{ color: color.text.muted, fontSize: s(20), marginTop: s(10), maxWidth: s(700) }} numberOfLines={2}>
      {note}
    </Text>
  );
}
