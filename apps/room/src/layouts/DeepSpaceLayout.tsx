import { FontAwesome6 } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { meetingHeadline, meetingSubtitle, providerLabel } from "../meetingPresentation";
import type { PanelTheme } from "../themes";
import type { Meeting, MeetingSlotSettings } from "../types";

export type DeepSpacePhase = "free" | "meeting" | "joining" | "join-error" | "offline";

export function DeepSpaceLayout({
  theme,
  brandName,
  logoUrl,
  roomName,
  clock,
  phase,
  statusLabel,
  shareCode,
  shareUrl,
  showCode,
  showUrl,
  shareNote,
  current,
  upcoming,
  nowSlot,
  timezone,
  busy,
  joinError,
  sessionControl,
  onOpenBoard,
  onJoin,
  onJoinNow,
  onRetryJoin,
  onCancelJoin,
}: {
  theme: PanelTheme;
  brandName?: string | null;
  logoUrl?: string | null;
  roomName: string;
  clock: string;
  phase: DeepSpacePhase;
  statusLabel: string;
  shareCode?: string;
  shareUrl?: string;
  showCode: boolean;
  showUrl: boolean;
  shareNote?: string;
  current?: Meeting | null;
  upcoming: Meeting[];
  nowSlot: MeetingSlotSettings;
  timezone?: string;
  busy: boolean;
  joinError?: string;
  sessionControl?: ReactNode;
  onOpenBoard: () => void;
  onJoin?: () => void;
  onJoinNow?: () => void;
  onRetryJoin?: () => void;
  onCancelJoin?: () => void;
}) {
  const statusColor =
    phase === "free"
      ? theme.statusFree
      : phase === "offline" || phase === "join-error"
        ? theme.statusError
        : phase === "joining"
          ? theme.statusWarn
          : theme.statusBusy;

  const next = upcoming[0];
  const formattedCode = formatShareCode(shareCode);
  const hostPath = shareHostPath(shareUrl, shareCode);

  return (
    <View style={styles.root} pointerEvents="box-none">
      <View style={styles.header} pointerEvents="box-none">
        <View style={styles.brand}>
          {logoUrl ? <Image source={{ uri: logoUrl }} style={styles.logo} /> : null}
          {brandName ? <Text style={styles.brandName}>{brandName}</Text> : null}
        </View>
        <View style={styles.headerTrail} pointerEvents="box-none">
          <Text style={styles.roomClock}>
            {roomName}
            {"  "}
            {clock}
          </Text>
          {sessionControl}
        </View>
      </View>

      <View style={styles.hero} pointerEvents="box-none">
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={styles.statusText}>{statusLabel}</Text>
        </View>

        {phase === "offline" ? (
          <>
            <Text style={styles.heroTitle}>This screen is offline</Text>
            <Text style={styles.heroCopy}>
              Check the network cable or Wi‑Fi, then wait a moment. The room board comes back when the connection returns.
            </Text>
          </>
        ) : null}

        {phase === "free" ? (
          <>
            <Text style={styles.heroEyebrow}>Share your screen</Text>
            {showCode ? <Text style={styles.heroCode}>{formattedCode}</Text> : null}
            {showUrl && hostPath ? (
              <Text style={styles.heroCopy}>
                Go to <Text style={styles.heroCopyStrong}>{hostPath}</Text> on your laptop
              </Text>
            ) : shareNote ? (
              <Text style={styles.heroCopy}>{shareNote}</Text>
            ) : null}
          </>
        ) : null}

        {phase === "meeting" && current ? (
          <>
            <Text style={styles.heroTitle}>{meetingHeadline(current, nowSlot)}</Text>
            <Text style={styles.heroMeta}>{meetingMetaLine(current, nowSlot, timezone)}</Text>
            {onJoinNow && current.joinUrl ? (
              <Pressable
                style={[styles.primaryButton, { backgroundColor: theme.primaryButton.backgroundColor }]}
                onPress={onJoinNow}
                disabled={busy}
              >
                <Text style={[styles.primaryButtonText, { color: theme.primaryButton.color }]}>
                  Join now on {providerLabel(current.provider)}
                </Text>
              </Pressable>
            ) : onJoin ? (
              <Pressable
                style={[styles.primaryButton, { backgroundColor: theme.primaryButton.backgroundColor }]}
                onPress={onJoin}
                disabled={busy}
              >
                <Text style={[styles.primaryButtonText, { color: theme.primaryButton.color }]}>View meeting</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}

        {phase === "joining" && current ? (
          <>
            <Text style={styles.heroTitle}>{meetingHeadline(current, nowSlot)}</Text>
            <Text style={styles.heroMeta}>{meetingMetaLine(current, nowSlot, timezone)}</Text>
            <View style={[styles.joiningButton, { backgroundColor: theme.secondaryButton.backgroundColor, borderColor: theme.secondaryButton.borderColor }]}>
              <ActivityIndicator color="#ffffff" />
              <Text style={[styles.joiningText, { color: theme.secondaryButton.color }]}>
                Joining {providerLabel(current.provider)}…
              </Text>
            </View>
            {onCancelJoin ? (
              <Pressable style={styles.cancelButton} onPress={onCancelJoin}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}

        {phase === "join-error" && current ? (
          <>
            <Text style={styles.heroTitle}>{meetingHeadline(current, nowSlot)}</Text>
            <Text style={styles.heroMeta}>{meetingMetaLine(current, nowSlot, timezone)}</Text>
            <Text style={styles.heroCopy}>
              {joinError || `${providerLabel(current.provider)} didn't respond. Try again, or join from your laptop and share your screen with the code below.`}
            </Text>
            {onRetryJoin ? (
              <Pressable
                style={[styles.primaryButton, { backgroundColor: theme.primaryButton.backgroundColor }]}
                onPress={onRetryJoin}
                disabled={busy}
              >
                <FontAwesome6 name="arrows-rotate" size={16} color={theme.primaryButton.color} />
                <Text style={[styles.primaryButtonText, { color: theme.primaryButton.color }]}>Try again</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </View>

      <View style={styles.footer} pointerEvents="box-none">
        {phase === "free" ? (
          <View style={styles.nextBooking}>
            <Text style={styles.nextLabel}>Next booking</Text>
            <Text style={styles.nextValue}>{next ? formatNextBooking(next, timezone) : "Nothing else scheduled."}</Text>
          </View>
        ) : (
          <View style={[styles.sharePanel, { backgroundColor: theme.sharePanel.backgroundColor, borderColor: theme.sharePanel.borderColor }]}>
            <View style={styles.sharePanelHead}>
              <FontAwesome6 name="display" size={14} color={theme.sharePanel.labelColor} />
              <Text style={[styles.sharePanelLabel, { color: theme.sharePanel.labelColor }]}>Share your screen</Text>
            </View>
            {showCode ? <Text style={[styles.sharePanelCode, { color: theme.sharePanel.codeColor }]}>{formattedCode}</Text> : null}
            {showUrl && hostPath ? (
              <Text style={[styles.sharePanelUrl, { color: theme.sharePanel.urlColor }]}>Go to {hostPath}</Text>
            ) : null}
            {shareNote ? <Text style={[styles.sharePanelUrl, { color: theme.sharePanel.urlColor }]}>{shareNote}</Text> : null}
          </View>
        )}

        <Pressable
          style={[styles.whiteboardCard, { backgroundColor: theme.whiteboardCard.backgroundColor }]}
          disabled={busy}
          onPress={onOpenBoard}
          accessibilityLabel="Open whiteboard"
        >
          <View style={[styles.whiteboardButton, { backgroundColor: theme.whiteboardCard.buttonBackground }]}>
            <FontAwesome6 name="pen" size={14} color={theme.whiteboardCard.buttonColor} />
            <Text style={[styles.whiteboardButtonText, { color: theme.whiteboardCard.buttonColor }]}>Open whiteboard</Text>
          </View>
          <WhiteboardSketch accent="#2f6fed" />
        </Pressable>
      </View>
    </View>
  );
}

function WhiteboardSketch({ accent }: { accent: string }) {
  return (
    <View style={styles.sketch}>
      <View style={[styles.sketchLine, { backgroundColor: accent, opacity: 0.55 }]} />
      <View style={[styles.sketchLine, { width: "62%", backgroundColor: accent, opacity: 0.4 }]} />
      <View style={[styles.sketchLine, { width: "48%", backgroundColor: accent, opacity: 0.3 }]} />
      <View style={styles.sketchRow}>
        <View style={[styles.sketchArrow, { borderLeftColor: accent }]} />
        <View style={[styles.sketchCircle, { borderColor: accent }]} />
      </View>
    </View>
  );
}

function formatShareCode(code?: string) {
  if (!code) return "·····";
  const digits = code.replace(/\D/g, "").slice(0, 5);
  return digits || "·····";
}

function shareHostPath(url?: string, code?: string) {
  const digits = (code ?? "").replace(/\D/g, "").slice(0, 5);
  if (url) {
    try {
      const parsed = new URL(url);
      const segment = digits || parsed.pathname.replace(/\D/g, "").slice(0, 5);
      return segment ? `${parsed.host}/${segment}` : parsed.host;
    } catch {
      const host = url.replace(/^https?:\/\//, "").split("/")[0] ?? "";
      return digits ? `${host}/${digits}` : host;
    }
  }
  return digits;
}

function meetingMetaLine(meeting: Meeting, slot: MeetingSlotSettings, timezone?: string) {
  const parts: string[] = [];
  if (slot.showTime) {
    const start = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(new Date(meeting.start));
    const end = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(new Date(meeting.end));
    parts.push(`${start}–${end}`);
  }
  if (slot.showOrganizer && meeting.organizer) parts.push(`Organised by ${meeting.organizer}`);
  if (slot.showMethod) parts.push(providerLabel(meeting.provider));
  const subtitle = meetingSubtitle(meeting, slot);
  if (!parts.length && subtitle) return subtitle;
  return parts.join("  ·  ");
}

function formatNextBooking(meeting: Meeting, timezone?: string) {
  const when = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(new Date(meeting.start));
  return `${when}, ${meeting.title}`;
}

function startedAgoLabel(meeting: Meeting, now: Date) {
  const minutes = Math.max(1, Math.round((now.getTime() - Date.parse(meeting.start)) / 60_000));
  return `In progress, started ${minutes} min ago.`;
}

export function deepSpaceStatusForMeeting(meeting: Meeting, now: Date) {
  return startedAgoLabel(meeting, now);
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 48, paddingVertical: 36 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  brand: { flexDirection: "row", alignItems: "center", gap: 12, flexShrink: 1 },
  logo: { width: 36, height: 36, borderRadius: 18 },
  brandName: { color: "#ffffff", fontSize: 22, fontWeight: "600" },
  headerTrail: { alignItems: "flex-end", gap: 4 },
  roomClock: { color: "#ffffff", fontSize: 22, fontWeight: "500" },
  hero: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 48 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 18 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { color: "rgba(255,255,255,0.88)", fontSize: 18 },
  heroEyebrow: { color: "#ffffff", fontSize: 42, fontWeight: "700", textAlign: "center" },
  heroTitle: { color: "#ffffff", fontSize: 48, fontWeight: "700", textAlign: "center", maxWidth: 920 },
  heroCode: {
    color: "#ffffff",
    fontSize: 96,
    fontWeight: "700",
    letterSpacing: 6,
    marginTop: 10,
    fontVariant: ["tabular-nums"],
    textAlign: "center",
  },
  heroCopy: { color: "rgba(255,255,255,0.82)", fontSize: 20, textAlign: "center", marginTop: 14, maxWidth: 720, lineHeight: 28 },
  heroCopyStrong: { color: "#ffffff", fontWeight: "700" },
  heroMeta: { color: "rgba(255,255,255,0.78)", fontSize: 18, textAlign: "center", marginTop: 12 },
  primaryButton: {
    marginTop: 28,
    minWidth: 320,
    borderRadius: 16,
    paddingHorizontal: 28,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  primaryButtonText: { fontSize: 20, fontWeight: "600" },
  joiningButton: {
    marginTop: 28,
    minWidth: 360,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 28,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  joiningText: { fontSize: 20, fontWeight: "600" },
  cancelButton: { marginTop: 16, paddingHorizontal: 18, paddingVertical: 10 },
  cancelText: { color: "rgba(255,255,255,0.85)", fontSize: 18 },
  footer: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 24 },
  nextBooking: { flex: 1, maxWidth: 520 },
  nextLabel: { color: "rgba(255,255,255,0.65)", fontSize: 15, marginBottom: 6 },
  nextValue: { color: "#ffffff", fontSize: 20, fontWeight: "600" },
  sharePanel: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingVertical: 16,
    maxWidth: 360,
  },
  sharePanelHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  sharePanelLabel: { fontSize: 15 },
  sharePanelCode: { fontSize: 36, fontWeight: "700", letterSpacing: 3, marginTop: 8, fontVariant: ["tabular-nums"] },
  sharePanelUrl: { fontSize: 14, marginTop: 6 },
  whiteboardCard: {
    width: 280,
    borderRadius: 18,
    padding: 18,
    transform: [{ rotate: "-4deg" }],
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  whiteboardButton: {
    alignSelf: "flex-start",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  whiteboardButtonText: { fontSize: 15, fontWeight: "600" },
  sketch: { marginTop: 18, gap: 8 },
  sketchLine: { height: 3, width: "78%", borderRadius: 2 },
  sketchRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
  sketchArrow: {
    width: 0,
    height: 0,
    borderTopWidth: 7,
    borderBottomWidth: 7,
    borderLeftWidth: 14,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
  },
  sketchCircle: { width: 28, height: 28, borderRadius: 14, borderWidth: 3 },
});
