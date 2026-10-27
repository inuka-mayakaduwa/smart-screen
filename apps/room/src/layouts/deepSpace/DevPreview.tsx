// Dev-only state switcher for the waiting screen. Start the app with
// EXPO_PUBLIC_PREVIEW=1 to render this instead of the connected panel.
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { DeepSpaceLayout } from "../DeepSpaceLayout";
import { themeFor } from "../../themes";
import type { Meeting, MeetingSlotSettings } from "../../types";
import type { ScreenState } from "./state";

const STATES: ScreenState[] = ["idle", "upcoming", "starting", "live", "joining", "error", "offline"];
const MIN = 60_000;
const SLOT: MeetingSlotSettings = { mode: "details", showTitle: true, showOrganizer: true, showMethod: true, showTime: true };

function meeting(anchorMs: number, startOffsetMin: number, title: string, provider: Meeting["provider"], id: string): Meeting {
  return {
    id,
    title,
    organizer: "Nadeesha Fernando",
    start: new Date(anchorMs + startOffsetMin * MIN).toISOString(),
    end: new Date(anchorMs + (startOffsetMin + 60) * MIN).toISOString(),
    provider,
    joinUrl: provider === "meet" ? "https://meet.google.com/abc-defg-hij" : "https://teams.microsoft.com/l/meetup-join/x",
    source: "google",
  };
}

export function DevPreview() {
  const [scenario, setScenario] = useState<ScreenState>("idle");
  const [anchor, setAnchor] = useState(() => Date.now());
  const [now, setNow] = useState(() => new Date());
  const [mode, setMode] = useState<MeetingSlotSettings["mode"]>("details");
  const theme = themeFor("deep-space");

  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(clock);
  }, []);

  const slot = useMemo<MeetingSlotSettings>(
    () =>
      mode === "busy"
        ? { mode, showTitle: false, showOrganizer: false, showMethod: false, showTime: true }
        : mode === "booked-by"
          ? { mode, showTitle: false, showOrganizer: true, showMethod: false, showTime: true }
          : SLOT,
    [mode],
  );

  const review = (offset: number) => meeting(anchor, offset, "Quarterly digital services review", "meet", "review");
  const standup = meeting(anchor, 95, "Weekly team stand-up", "teams", "standup");
  const data = (() => {
    switch (scenario) {
      case "idle":
        return { meetings: [standup], offline: false, joining: null, error: null };
      case "upcoming":
        return { meetings: [review(10), standup], offline: false, joining: null, error: null };
      case "starting":
        return { meetings: [review(-0.3), standup], offline: false, joining: null, error: null };
      case "live":
        return { meetings: [review(-12), standup], offline: false, joining: null, error: null };
      case "joining": {
        const live = review(-12);
        return { meetings: [live, standup], offline: false, joining: live, error: null };
      }
      case "error": {
        const live = review(-12);
        return { meetings: [live, standup], offline: false, joining: null, error: live };
      }
      case "offline":
        return { meetings: [review(-12)], offline: true, joining: null, error: null };
    }
  })();

  const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "Asia/Colombo" }).format(now);

  return (
    <View style={styles.root}>
      <DeepSpaceLayout
        theme={theme}
        roomName="Room 4.2"
        clock={clock}
        now={now}
        timezone="Asia/Colombo"
        meetings={data.meetings}
        nowSlot={slot}
        nextSlot={slot}
        offline={data.offline}
        joiningMeeting={data.joining}
        errorMeeting={data.error}
        shareCode="4NQWRV"
        shareUrl="https://meet.govtech.lk/4NQWRV"
        shareHost="meet.govtech.lk"
        showCode
        showUrl
        supportContact="ext. 2200"
        busy={false}
        onOpenBoard={() => undefined}
        onJoin={() => setScenario("joining")}
        onRetryJoin={() => setScenario("joining")}
        onCancelJoin={() => setScenario("live")}
      />
      <View style={styles.switcher} pointerEvents="box-none">
        {STATES.map((state) => (
          <Pressable
            key={state}
            onPress={() => {
              setAnchor(Date.now());
              setScenario(state);
            }}
            style={[styles.chip, scenario === state && styles.chipOn]}
          >
            <Text style={styles.chipText}>{state}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => setMode(mode === "details" ? "booked-by" : mode === "booked-by" ? "busy" : "details")} style={[styles.chip, styles.chipAlt]}>
          <Text style={styles.chipText}>privacy: {mode}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0C0D49" },
  switcher: { position: "absolute", top: 8, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 6, flexWrap: "wrap" },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.45)" },
  chipOn: { backgroundColor: "#054BC9" },
  chipAlt: { backgroundColor: "rgba(255,255,255,0.18)" },
  chipText: { color: "#fff", fontSize: 12 },
});
