// GovTech Meet waiting screen: the Deep Space theme. Built from design/govtech-meet-rn-handoff.
// HomeScreen owns the data (meetings, share code, joining flags); this layout derives the
// seven-state model from it and renders the screen at 1920 × 1080 design units.
import { useCallback, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import type { PanelTheme } from "../themes";
import type { Meeting, MeetingSlotSettings } from "../types";
import { normalizeShareCode, shareHostPath, splitShareCode, spokenShareCode } from "../shareCode";
import { ActionArea } from "./deepSpace/ActionArea";
import { Background } from "./deepSpace/Background";
import { ErrorDetail, FooterNote, IdleDetail, IdleTitle, MeetingDetail, MeetingTitle, NextBooking, OfflineDetail, OfflineTitle } from "./deepSpace/blocks";
import { GlassShareCard } from "./deepSpace/GlassShareCard";
import { Header } from "./deepSpace/Header";
import { DriftLayer, HandoverBlock, useReducedMotion } from "./deepSpace/motion";
import { useScale } from "./deepSpace/scale";
import { ScreenPulse, type Pulse } from "./deepSpace/ScreenPulse";
import { deriveScreen, type ScreenState } from "./deepSpace/state";
import { StatusRoll } from "./deepSpace/StatusRoll";
import { size, space } from "./deepSpace/tokens";
import { WhiteboardTile } from "./deepSpace/WhiteboardTile";

export type DeepSpaceLayoutProps = {
  theme: PanelTheme;
  brandName?: string | null;
  logoUrl?: string | null;
  roomName: string;
  clock: string;
  now: Date;
  timezone?: string;
  meetings: Meeting[];
  nowSlot: MeetingSlotSettings;
  nextSlot: MeetingSlotSettings;
  offline: boolean;
  /** The meeting a Join press is connecting to, while the launch is in flight. */
  joiningMeeting: Meeting | null;
  /** The meeting whose join attempt failed, with the reason the launcher gave. */
  errorMeeting: Meeting | null;
  joinErrorText?: string;
  shareCode?: string;
  shareUrl?: string;
  /** Share host from the API, shown on the idle screen before a code has been minted. */
  shareHost?: string;
  showCode: boolean;
  showUrl: boolean;
  shareNote?: string;
  supportContact?: string | null;
  busy: boolean;
  sessionControl?: ReactNode;
  onOpenBoard: () => void;
  onJoin: (meeting: Meeting) => void;
  onRetryJoin: (meeting: Meeting) => void;
  onCancelJoin: () => void;
};

export function DeepSpaceLayout({
  brandName,
  logoUrl,
  roomName,
  clock,
  now,
  timezone,
  meetings,
  nowSlot,
  nextSlot,
  offline,
  joiningMeeting,
  errorMeeting,
  joinErrorText,
  shareCode,
  shareUrl,
  shareHost,
  showCode,
  showUrl,
  shareNote,
  supportContact,
  busy,
  sessionControl,
  onOpenBoard,
  onJoin,
  onRetryJoin,
  onCancelJoin,
}: DeepSpaceLayoutProps) {
  const { s, width, height } = useScale();
  const reduced = useReducedMotion();
  const rootRef = useRef<View>(null);
  const pulseCount = useRef(0);
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const model = deriveScreen({ meetings, nowMs: now.getTime(), offline, joining: joiningMeeting, error: errorMeeting });
  const slot = model.meetingIsCurrent ? nowSlot : nextSlot;
  const code = normalizeShareCode(shareCode);
  const halves = splitShareCode(code);
  const spoken = spokenShareCode(code);
  const hostPath = shareHostPath(shareUrl, code, shareHost);
  const key = model.state;
  // Blocks hand over (HANDOFF 6.2) between the idle, meeting and offline groups. Within the
  // meeting group the status line rolls and the action area morphs instead, and the title,
  // details, share card and tile stay put.
  const group = groupOf(key);
  const meetingKey = `${group}:${model.meeting?.id ?? ""}`;

  // Screen pulse on a Join press: convert the button's window centre into this layout's space.
  const handlePulse = useCallback((wx: number, wy: number) => {
    rootRef.current?.measureInWindow((rx, ry) => {
      pulseCount.current += 1;
      setPulse({ id: pulseCount.current, cx: wx - rx, cy: wy - ry });
    });
  }, []);

  const title =
    key === "offline" ? (
      <OfflineTitle />
    ) : key === "idle" ? (
      <IdleTitle halves={halves} showCode={showCode} label={spoken} />
    ) : model.meeting ? (
      <MeetingTitle meeting={model.meeting} slot={slot} />
    ) : null;

  const detail =
    key === "offline" ? (
      <OfflineDetail supportContact={supportContact} />
    ) : key === "idle" ? (
      showUrl ? <IdleDetail hostPath={hostPath} /> : null
    ) : model.meeting ? (
      <View style={{ alignItems: "center" }}>
        <MeetingDetail meeting={model.meeting} slot={slot} timezone={timezone} />
        {key === "error" ? <ErrorDetail meeting={model.meeting} reason={joinErrorText} /> : null}
      </View>
    ) : null;

  const footer =
    key === "offline" ? (
      <FooterNote note={shareNote} />
    ) : key === "idle" ? (
      <View>
        <NextBooking meeting={model.nextBooking} slot={nextSlot} timezone={timezone} />
        <FooterNote note={shareNote} />
      </View>
    ) : (
      <GlassShareCard halves={halves} hostPath={hostPath} showCode={showCode} showUrl={showUrl} label={spoken} note={shareNote} />
    );

  return (
    <View ref={rootRef} style={styles.root} pointerEvents="box-none" collapsable={false}>
      <Background reduced={reduced} />
      <ScreenPulse pulse={pulse} width={width} height={height} reduced={reduced} />
      <DriftLayer style={[styles.root, { paddingTop: s(space.screenPadTop), paddingBottom: s(space.screenPadBottom), paddingHorizontal: s(space.screenPadX) }]}>
        <Header logoUrl={logoUrl} brandName={brandName} roomName={roomName} clock={clock} sessionControl={sessionControl} />

        <View style={[styles.main, { gap: s(space.mainGap) }]} pointerEvents="box-none">
          <View style={{ alignItems: "center", gap: s(space.stackGap), maxWidth: s(1240) }} pointerEvents="box-none">
            <HandoverBlock stateKey={group} index={0} reduced={reduced}>
              <StatusRoll label={model.statusLabel} dot={model.dot} ripple={model.ripple} reduced={reduced} snapKey={group} />
            </HandoverBlock>
            <HandoverBlock stateKey={meetingKey} index={1} reduced={reduced} style={{ alignItems: "center" }}>
              {title}
            </HandoverBlock>
            <HandoverBlock stateKey={key === "error" ? `${meetingKey}:error` : meetingKey} index={2} reduced={reduced} style={{ alignItems: "center" }}>
              {detail}
            </HandoverBlock>
          </View>
          <HandoverBlock stateKey={meetingKey} index={3} reduced={reduced} style={{ minHeight: s(size.primaryButtonH), alignItems: "center" }}>
            <ActionArea
              state={key}
              meeting={model.meeting}
              busy={busy}
              reduced={reduced}
              onJoin={onJoin}
              onRetry={onRetryJoin}
              onCancel={onCancelJoin}
              onPulse={handlePulse}
            />
          </HandoverBlock>
        </View>

        <HandoverBlock stateKey={group} index={4} reduced={reduced} style={[styles.footer, { minHeight: s(64) }]}>
          {footer}
        </HandoverBlock>

        {/* The whiteboard opens from every state, offline included (HANDOFF 5). */}
        <WhiteboardTile onPress={onOpenBoard} disabled={busy} reduced={reduced} />
      </DriftLayer>
    </View>
  );
}

function groupOf(state: ScreenState): "idle" | "meeting" | "offline" {
  if (state === "idle" || state === "offline") return state;
  return "meeting";
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: "hidden" },
  main: { flex: 1, alignItems: "center", justifyContent: "center" },
  footer: { flexDirection: "row", alignItems: "flex-end" },
});
