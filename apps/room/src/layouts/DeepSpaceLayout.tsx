// GovTech Meet waiting screen: the Deep Space theme. Built from design/govtech-meet-rn-handoff.
// HomeScreen owns the data (meetings, share code, joining flags); this layout derives the
// seven-state model from it and renders the screen at 1920 × 1080 design units.
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import type { PanelTheme } from "../themes";
import type { Meeting, MeetingSlotSettings } from "../types";
import { normalizeShareCode, shareHostPath, splitShareCode, spokenShareCode } from "../shareCode";
import { ActionBlock } from "./deepSpace/ActionBlock";
import { Background } from "./deepSpace/Background";
import { ErrorDetail, FooterNote, IdleDetail, IdleTitle, MeetingDetail, MeetingTitle, NextBooking, OfflineDetail, OfflineTitle } from "./deepSpace/blocks";
import { GlassShareCard } from "./deepSpace/GlassShareCard";
import { Header } from "./deepSpace/Header";
import { DriftLayer, HandoverBlock, useReducedMotion } from "./deepSpace/motion";
import { useScale } from "./deepSpace/scale";
import { deriveScreen } from "./deepSpace/state";
import { StatusLine } from "./deepSpace/StatusLine";
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
  const { s } = useScale();
  const reduced = useReducedMotion();
  const model = deriveScreen({ meetings, nowMs: now.getTime(), offline, joining: joiningMeeting, error: errorMeeting });
  const slot = model.meetingIsCurrent ? nowSlot : nextSlot;
  const code = normalizeShareCode(shareCode);
  const halves = splitShareCode(code);
  const spoken = spokenShareCode(code);
  const hostPath = shareHostPath(shareUrl, code, shareHost);
  const key = model.state;

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
    <View style={styles.root} pointerEvents="box-none">
      <Background reduced={reduced} />
      <DriftLayer style={[styles.root, { paddingTop: s(space.screenPadTop), paddingBottom: s(space.screenPadBottom), paddingHorizontal: s(space.screenPadX) }]}>
        <Header logoUrl={logoUrl} brandName={brandName} roomName={roomName} clock={clock} sessionControl={sessionControl} />

        <View style={[styles.main, { gap: s(space.mainGap) }]} pointerEvents="box-none">
          <View style={{ alignItems: "center", gap: s(space.stackGap), maxWidth: s(1240) }} pointerEvents="box-none">
            <HandoverBlock stateKey={key} index={0} reduced={reduced}>
              <StatusLine label={model.statusLabel} dot={model.dot} ripple={model.ripple} reduced={reduced} />
            </HandoverBlock>
            <HandoverBlock stateKey={key} index={1} reduced={reduced} style={{ alignItems: "center" }}>
              {title}
            </HandoverBlock>
            <HandoverBlock stateKey={key} index={2} reduced={reduced} style={{ alignItems: "center" }}>
              {detail}
            </HandoverBlock>
          </View>
          <HandoverBlock stateKey={key} index={3} reduced={reduced} style={{ minHeight: s(size.primaryButtonH), alignItems: "center" }}>
            <ActionBlock state={key} meeting={model.meeting} busy={busy} reduced={reduced} onJoin={onJoin} onRetry={onRetryJoin} onCancel={onCancelJoin} />
          </HandoverBlock>
        </View>

        <HandoverBlock stateKey={key} index={4} reduced={reduced} style={[styles.footer, { minHeight: s(64) }]}>
          {footer}
        </HandoverBlock>

        {/* The whiteboard opens from every state, offline included (HANDOFF 5). */}
        <WhiteboardTile onPress={onOpenBoard} disabled={busy} reduced={reduced} />
      </DriftLayer>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  main: { flex: 1, alignItems: "center", justifyContent: "center" },
  footer: { flexDirection: "row", alignItems: "flex-end" },
});
