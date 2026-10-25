import { FontAwesome6 } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { openMeeting } from "./launch";
import { providerLabel } from "./meetingPresentation";
import { themeFor } from "./themes";
import type { Meeting } from "./types";

export function JoinScreen({
  meeting,
  timezone,
  themeId,
  brandName,
  logoUrl,
  onBack,
}: {
  meeting: Meeting;
  timezone?: string;
  themeId?: string;
  brandName?: string | null;
  logoUrl?: string | null;
  onBack: () => void;
}) {
  const theme = themeFor(themeId);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const when = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(new Date(meeting.start));
  const until = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(new Date(meeting.end));
  const meta = [
    `${when}–${until}`,
    meeting.organizer ? `Organised by ${meeting.organizer}` : null,
    providerLabel(meeting.provider),
  ]
    .filter(Boolean)
    .join("  ·  ");

  async function join() {
    setPending(true);
    setError("");
    try {
      await openMeeting(meeting.joinUrl, meeting.provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the meeting");
    } finally {
      setPending(false);
    }
  }

  if (theme.layout === "deep-space") {
    const statusColor = error ? theme.statusError : pending ? theme.statusWarn : theme.statusBusy;
    const statusLabel = error ? "Couldn't join the meeting." : pending ? "Connecting this room" : "Ready to join";
    return (
      <LinearGradient
        colors={[theme.gradientFrom ?? theme.screen, theme.gradientTo ?? theme.screen]}
        style={styles.deepRoot}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      >
        <View style={styles.deepHeader}>
          <View style={styles.brand}>
            {logoUrl ? <Image source={{ uri: logoUrl }} style={styles.logo} /> : null}
            {brandName ? <Text style={styles.brandName}>{brandName}</Text> : null}
          </View>
          <Pressable onPress={onBack} hitSlop={8}>
            <Text style={styles.deepBack}>Back to the room</Text>
          </Pressable>
        </View>
        <View style={styles.deepHero}>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={styles.statusText}>{statusLabel}</Text>
          </View>
          <Text style={styles.deepTitle}>{meeting.title}</Text>
          <Text style={styles.deepMeta}>{meta}</Text>
          {error ? (
            <Text style={styles.deepCopy}>
              {error}. Try again, or join from your laptop and share your screen from the room board.
            </Text>
          ) : null}
          {pending ? (
            <View
              style={[
                styles.joiningButton,
                { backgroundColor: theme.secondaryButton.backgroundColor, borderColor: theme.secondaryButton.borderColor },
              ]}
            >
              <ActivityIndicator color="#ffffff" />
              <Text style={[styles.joiningText, { color: theme.secondaryButton.color }]}>
                Joining {providerLabel(meeting.provider)}…
              </Text>
            </View>
          ) : (
            <Pressable
              style={[styles.primaryButton, { backgroundColor: theme.primaryButton.backgroundColor }, !meeting.joinUrl && styles.disabled]}
              disabled={!meeting.joinUrl}
              onPress={join}
            >
              {error ? <FontAwesome6 name="arrows-rotate" size={16} color={theme.primaryButton.color} /> : null}
              <Text style={[styles.primaryButtonText, { color: theme.primaryButton.color }]}>
                {error ? "Try again" : `Join now on ${providerLabel(meeting.provider)}`}
              </Text>
            </Pressable>
          )}
          {pending ? (
            <Pressable style={styles.cancelButton} onPress={onBack}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          ) : null}
          {!meeting.joinUrl ? <Text style={styles.deepCopy}>This event has no join link.</Text> : null}
        </View>
      </LinearGradient>
    );
  }

  return (
    <View style={styles.screen}>
      <Pressable onPress={onBack}>
        <Text style={styles.back}>Back to the room</Text>
      </Pressable>
      <Text style={styles.kicker}>{providerLabel(meeting.provider)}</Text>
      <Text style={styles.title}>{meeting.title}</Text>
      <Text style={styles.when}>{when}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={[styles.button, !meeting.joinUrl && styles.disabled]} disabled={pending || !meeting.joinUrl} onPress={join}>
        <Text style={styles.buttonText}>{pending ? "Opening…" : "Join meeting"}</Text>
      </Pressable>
      {!meeting.joinUrl ? <Text style={styles.error}>This event has no join link.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#14221c", padding: 48, justifyContent: "center" },
  back: { color: "#d7e0da", fontSize: 16, marginBottom: 24 },
  kicker: { color: "#8dceba", letterSpacing: 2, textTransform: "uppercase" },
  title: { color: "white", fontSize: 56, fontWeight: "600", marginTop: 8 },
  when: { color: "#d7e0da", fontSize: 24, marginVertical: 12 },
  error: { color: "#ffb4a8", fontSize: 18, marginBottom: 12 },
  button: { alignSelf: "flex-start", backgroundColor: "#0c6b52", paddingHorizontal: 24, paddingVertical: 16, borderRadius: 999, marginTop: 8 },
  disabled: { opacity: 0.5 },
  buttonText: { color: "white", fontSize: 22 },
  deepRoot: { flex: 1, paddingHorizontal: 48, paddingVertical: 36 },
  deepHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brand: { flexDirection: "row", alignItems: "center", gap: 12 },
  logo: { width: 36, height: 36, borderRadius: 18 },
  brandName: { color: "#ffffff", fontSize: 22, fontWeight: "600" },
  deepBack: { color: "rgba(255,255,255,0.8)", fontSize: 16 },
  deepHero: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 48 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 18 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { color: "rgba(255,255,255,0.88)", fontSize: 18 },
  deepTitle: { color: "#ffffff", fontSize: 48, fontWeight: "700", textAlign: "center", maxWidth: 920 },
  deepMeta: { color: "rgba(255,255,255,0.78)", fontSize: 18, textAlign: "center", marginTop: 12 },
  deepCopy: { color: "rgba(255,255,255,0.82)", fontSize: 18, textAlign: "center", marginTop: 14, maxWidth: 720, lineHeight: 26 },
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
});
