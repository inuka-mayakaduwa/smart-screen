import { FontAwesome6 } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Network from "expo-network";
import { LinearGradient } from "expo-linear-gradient";
import {
  Animated,
  Dimensions,
  ImageBackground,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import {
  createShareSession,
  endRoomSession,
  ensureRoomSession,
  fetchRoomSession,
  fetchState,
  postShareLan,
  shareCodeActive,
  submitDebugLogs,
  type RoomActivity,
  type SessionSource,
} from "./api";
import { openMeeting } from "./launch";
import { meetingHeadline, meetingSubtitle } from "./meetingPresentation";
import { lanAddress, lanIpInjection, receiverDocument } from "./receiverDocument";
import { DebugConsole } from "./DebugConsole";
import { debug, getDebugLines, isDebugEnabled, setDebugEnabled } from "./debugLog";
import { clearSession, saveDebugMode } from "./session";
import { SettingsDialog, type ClockMode, type PictureSettings } from "./SettingsDialog";
import { DeepSpaceLayout, deepSpaceStatusForMeeting, type DeepSpacePhase } from "./layouts/DeepSpaceLayout";
import { themeFor, type PanelTheme } from "./themes";
import type { DisplayState, Meeting, MeetingSlotSettings, PanelDisplaySettings, PanelSession, ShareSession } from "./types";

const ROTATE_WARNING_MS = 10_000;

const DEFAULT_PICTURE: PictureSettings = { width: -1, fps: 0, quality: 0.9, latency: "skip" };
const DEFAULT_DISPLAY: PanelDisplaySettings = {
  themeId: "classic",
  refreshSeconds: 20,
  now: { mode: "details", showTitle: true, showOrganizer: true, showMethod: true, showTime: true, joinInCard: true },
  next: { mode: "details", showTitle: true, showOrganizer: true, showMethod: true, showTime: true },
};
export function HomeScreen({
  session,
  onJoin,
  onDisconnected,
}: {
  session: PanelSession;
  onJoin: (
    meeting: Meeting,
    timezone?: string,
    themeId?: string,
    branding?: { brandName?: string | null; logoUrl?: string | null },
  ) => void;
  onDisconnected: (reason?: string) => void;
}) {
  const [state, setState] = useState<DisplayState | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [share, setShare] = useState<ShareSession | null>(null);
  const [shareNote, setShareNote] = useState("");
  const [showingShare, setShowingShare] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [debugOn, setDebugOn] = useState(isDebugEnabled);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [picture, setPicture] = useState<PictureSettings>(DEFAULT_PICTURE);
  const [showCode, setShowCode] = useState(true);
  const [showUrl, setShowUrl] = useState(true);
  const [showFps, setShowFps] = useState(false);
  const [showResolution, setShowResolution] = useState(false);
  const [clockMode, setClockMode] = useState<ClockMode>("auto");
  const [manualZone, setManualZone] = useState("");
  const [order, setOrder] = useState<number[]>([]);
  const [mode, setMode] = useState<"room" | "whiteboard">("room");
  const [activity, setActivity] = useState<RoomActivity | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [connectNote, setConnectNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [offline, setOffline] = useState(false);
  const showingShareRef = useRef(false);
  const holdRoom = useRef(false);
  const endedShare = useRef(false);
  const sessionFetch = useRef(0);
  const shareCodeRef = useRef("");
  const shareExpiryRef = useRef("");
  const shareSessionIdRef = useRef("");
  const receiverMountRef = useRef<{ sessionId: string; source: { html: string; baseUrl: string } } | null>(null);
  const pictureRef = useRef(picture);
  const metersRef = useRef({ fps: false, resolution: false });
  const webRef = useRef<WebView>(null);
  const lanIpRef = useRef("");
  const meterLiftRef = useRef(0);
  const receiverSource = useMemo(() => {
    if (!share) {
      receiverMountRef.current = null;
      return null;
    }
    const cached = receiverMountRef.current;
    if (cached && cached.sessionId === share.sessionId) return cached.source;
    const source = { html: receiverDocument(share, session, lanIpRef.current), baseUrl: session.controlApiUrl };
    receiverMountRef.current = { sessionId: share.sessionId, source };
    return source;
  }, [share?.sessionId, session.controlApiUrl, session.deviceToken, share]);

  useEffect(() => {
    let cancelled = false;
    Network.getIpAddressAsync()
      .then((ip) => {
        const address = lanAddress(ip);
        if (cancelled || !address) return;
        lanIpRef.current = address;
        webRef.current?.injectJavaScript(lanIpInjection(address));
        postShareLan(session.controlApiUrl, session.deviceToken, address).catch(() => undefined);
      })
      .catch(() => undefined);
    Network.getNetworkStateAsync()
      .then((state) => {
        if (!cancelled) setOffline(state.isConnected === false);
      })
      .catch(() => undefined);
    const poll = setInterval(() => {
      Network.getNetworkStateAsync()
        .then((state) => {
          if (!cancelled) setOffline(state.isConnected === false);
        })
        .catch(() => undefined);
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(clock);
  }, []);

  const refreshSeconds = state?.display?.refreshSeconds ?? DEFAULT_DISPLAY.refreshSeconds;
  useEffect(() => {
    let stopped = false;
    async function pull() {
      try {
        const next = await fetchState(session.controlApiUrl, session.deviceToken);
        if (!stopped) {
          setState(next);
          setError("");
          const ticket = ++sessionFetch.current;
          try {
            const open = await fetchRoomSession(session.controlApiUrl, session.deviceToken);
            if (!stopped && ticket === sessionFetch.current) setActivity(open);
          } catch {
            // The clock can stay up when the session lookup fails.
          }
        }
      } catch (err) {
        if (stopped) return;
        const message = err instanceof Error ? err.message : "Could not load the room";
        if (message.includes("not connected") || message.includes("not available")) {
          debug("panel", "error", `Disconnected: ${message}`);
          await clearSession();
          onDisconnected(message);
          return;
        }
        setError(message);
      }
    }
    pull();
    const timer = setInterval(pull, Math.max(10, refreshSeconds) * 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [onDisconnected, refreshSeconds, session.controlApiUrl, session.deviceToken]);

  useEffect(() => {
    let cancelled = false;
    let refresh: ReturnType<typeof setTimeout> | undefined;

    async function openShare() {
      try {
        const currentCode = shareCodeRef.current;
        if (currentCode) {
          const alive = await shareCodeActive(session.controlApiUrl, currentCode);
          if (cancelled) return;
          if (alive) {
            const remaining = new Date(shareExpiryRef.current).getTime() - Date.now();
            refresh = setTimeout(openShare, Math.min(Math.max(1000, remaining), 4000));
            return;
          }
          debug("share", "warn", `Share code ${currentCode} expired`);
          setShareNote("That share code expired. Getting a new one…");
        }
        const created = await createShareSession(session.controlApiUrl, session.deviceToken);
        if (cancelled) return;
        const sameSession = shareSessionIdRef.current === created.sessionId;
        shareCodeRef.current = created.code;
        shareExpiryRef.current = created.expiresAt;
        shareSessionIdRef.current = created.sessionId;
        if (!sameSession) {
          receiverMountRef.current = null;
          showingShareRef.current = false;
          setShowingShare(false);
          setOrder([]);
        }
        setShare(created);
        setShareNote("");
        debug("share", "info", `Share code ${created.code}`, { shareUrl: created.shareUrl, expiresAt: created.expiresAt });
        refresh = setTimeout(openShare, 4000);
      } catch (err) {
        if (cancelled) return;
        setShareNote(err instanceof Error ? err.message : "Share code is unavailable");
        refresh = setTimeout(openShare, 15_000);
      }
    }

    openShare();
    return () => {
      cancelled = true;
      clearTimeout(refresh);
    };
  }, [session.controlApiUrl, session.deviceToken]);

  function onShareMessage(event: WebViewMessageEvent) {
    try {
      const message = JSON.parse(event.nativeEvent.data) as { type?: string; text?: string; slots?: number[] };
      if (message.type === "clients" && Array.isArray(message.slots)) {
        const slots = message.slots.filter((slot): slot is number => typeof slot === "number");
        if (endedShare.current) {
          if (slots.length === 0) return;
          endedShare.current = false;
        }
        setOrder((current) => {
          const next = current.filter((slot) => slots.includes(slot));
          for (const slot of slots) if (!next.includes(slot)) next.push(slot);
          return next;
        });
      }
      if (message.type === "video") {
        if (endedShare.current || holdRoom.current) return;
        if (!showingShareRef.current) debug("share", "info", "A laptop started sharing");
        showingShareRef.current = true;
        setShowingShare(true);
        setShareNote("");
      }
      if (message.type === "idle") {
        debug("share", "info", "Share went idle");
        holdRoom.current = false;
        showingShareRef.current = false;
        setShowingShare(false);
      }
      if (message.type === "status" && message.text && __DEV__) console.log(message.text);
      if (message.type === "log" && message.text) {
        debug("share", "network", message.text);
        if (__DEV__) console.log(message.text);
      }
      if (message.type === "meter" && message.text) debug("share", "info", message.text);
    } catch {
      setShareNote("The share receiver could not be read");
    }
  }

  const room = state?.room;
  const display = state?.display ?? DEFAULT_DISPLAY;
  const theme = themeFor(display.themeId);
  const meetings = state?.meetings ?? [];
  const current = meetings.find((meeting) => Date.parse(meeting.start) <= now.getTime() && Date.parse(meeting.end) > now.getTime());
  const upcoming = meetings.filter((meeting) => Date.parse(meeting.start) > now.getTime()).slice(0, 4);
  const clockZone = clockMode === "system" ? undefined : clockMode === "manual" ? manualZone || room?.timezone : room?.timezone;
  const clockOptions = clockZone ? { timeZone: clockZone } : {};
  const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", ...clockOptions }).format(now);
  const dateLine = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", ...clockOptions }).format(now);

  const remainingMs = share ? new Date(share.expiresAt).getTime() - now.getTime() : Number.POSITIVE_INFINITY;
  const expiring = Boolean(share) && remainingMs <= ROTATE_WARNING_MS;
  const boarding = mode === "whiteboard" && activity;

  useEffect(() => {
    webRef.current?.injectJavaScript(
      `window.setDebug && window.setDebug(${debugOn ? "true" : "false"}); window.setSoundInset && window.setSoundInset(${JSON.stringify({ right: 22, bottom: 132 })}); true;`,
    );
  }, [debugOn]);

  useEffect(() => {
    if (showingShare && !boarding) return;
    meterLiftRef.current = 0;
    webRef.current?.injectJavaScript(`window.setMeterLift && window.setMeterLift(0); true;`);
  }, [showingShare, boarding]);

  const shareCard = (
    <ShareCard
      code={share?.code}
      url={share?.shareUrl}
      note={shareNote}
      expiring={expiring}
      showCode={showCode}
      showUrl={showUrl}
      panel={theme.sharePanel}
    />
  );

  async function useSession(openedBy: SessionSource) {
    const ticket = ++sessionFetch.current;
    const next = await ensureRoomSession(session.controlApiUrl, session.deviceToken, openedBy);
    debug("session", "info", `Room session opened by ${openedBy}`, { code: next.code });
    if (ticket === sessionFetch.current) {
      setActivity(next);
      setConfirmEnd(false);
    }
    return next;
  }

  function leaveLiveShare() {
    holdRoom.current = true;
    showingShareRef.current = false;
    setShowingShare(false);
  }

  async function openBoard() {
    if (busy) return;
    setBusy(true);
    setConnectNote("");
    try {
      await useSession("whiteboard");
      setMode("whiteboard");
    } catch (err) {
      setConnectNote(err instanceof Error ? err.message : "Could not open the whiteboard");
    } finally {
      setBusy(false);
    }
  }

  async function finishSession() {
    if (busy) return;
    setBusy(true);
    setConnectNote("");
    try {
      const ticket = ++sessionFetch.current;
      await endRoomSession(session.controlApiUrl, session.deviceToken);
      debug("session", "info", "Room session ended");
      if (ticket === sessionFetch.current) {
        setActivity(null);
        setConfirmEnd(false);
      }
      if (mode === "whiteboard") setMode("room");
    } catch (err) {
      setConnectNote(err instanceof Error ? err.message : "Could not end the session");
    } finally {
      setBusy(false);
    }
  }

  async function joinFromPanel(meeting: Meeting, joinNow = false) {
    setJoinError("");
    try {
      await useSession("meeting");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open a session");
    }
    if (joinNow) {
      setJoining(true);
      openMeeting(meeting.joinUrl, meeting.provider)
        .then(() => setJoining(false))
        .catch((err) => {
          setJoining(false);
          setJoinError(err instanceof Error ? err.message : "Could not open the meeting");
        });
      return;
    }
    onJoin(meeting, clockZone, display.themeId, { brandName: room?.brandName, logoUrl: room?.logoUrl });
  }

  function deepSpacePhase(): DeepSpacePhase {
    if (offline) return "offline";
    if (joining) return "joining";
    if (joinError && current) return "join-error";
    if (current) return "meeting";
    return "free";
  }

  function deepSpaceStatusLabel(phase: DeepSpacePhase) {
    if (phase === "offline") return "No network connection";
    if (phase === "joining") return "Connecting this room";
    if (phase === "join-error") return "Couldn't join the meeting.";
    if (phase === "meeting" && current) return deepSpaceStatusForMeeting(current, now);
    return "This room is free";
  }

  function pushPicture(next: PictureSettings) {
    pictureRef.current = next;
    setPicture(next);
    webRef.current?.injectJavaScript(`window.applyPicture(${JSON.stringify(next)}); true;`);
  }

  function pushMeters(fps: boolean, resolution: boolean) {
    const next = { fps, resolution };
    metersRef.current = next;
    webRef.current?.injectJavaScript(`window.setMeters && window.setMeters(${JSON.stringify(next)}); true;`);
  }

  function moveClient(index: number, delta: number) {
    const target = index + delta;
    if (delta === 0 || target < 0 || target >= order.length) return;
    const next = order.slice();
    const current = next[index]!;
    next[index] = next[target]!;
    next[target] = current;
    setOrder(next);
    webRef.current?.injectJavaScript(`window.setOrder(${JSON.stringify(next)}); true;`);
  }

  function dropSlots(slots: number[]) {
    if (slots.length === 0) {
      endedShare.current = true;
      holdRoom.current = false;
      showingShareRef.current = false;
      setShowingShare(false);
      setSettingsOpen(false);
      return;
    }
    const next = order.filter((slot) => !slots.includes(slot));
    setOrder(next);
    if (next.length === 0) {
      endedShare.current = true;
      holdRoom.current = false;
      showingShareRef.current = false;
      setShowingShare(false);
      setSettingsOpen(false);
    }
    for (const slot of slots) webRef.current?.injectJavaScript(`window.dropClient(${slot}); true;`);
  }

  function stopSharing() {
    dropSlots(order.slice());
  }

  async function sendDebugLogs() {
    const lines = getDebugLines();
    if (!lines.length) throw new Error("No debug lines yet");
    return submitDebugLogs(session.controlApiUrl, session.deviceToken, lines);
  }

  const splitLive = boarding && showingShare;
  const boardUri = activity ? whiteboardEmbedUrl(activity.whiteboardUrl, session.controlApiUrl) : "";
  const spacePhase = deepSpacePhase();
  const spaceStatus = deepSpaceStatusLabel(spacePhase);

  // Keep the share receiver mounted in room mode (and beside the board when live).
  // Hide it during whiteboard-only so a failed board load cannot show the black receiver.
  const mountShare = Boolean(share && receiverSource && (showingShare || !boarding));
  const shareWebView =
    mountShare && share && receiverSource ? (
        <WebView
          ref={webRef}
          key={share.sessionId}
          style={splitLive ? [styles.splitShare, { flex: Math.max(1, order.length || 1) }] : styles.shareView}
          originWhitelist={["*"]}
          source={receiverSource}
          javaScriptEnabled
          domStorageEnabled
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          androidLayerType="hardware"
          setSupportMultipleWindows={false}
          webviewDebuggingEnabled={__DEV__}
          onLoadStart={() => {
            if (__DEV__) console.log(`[receiver] view opening code=${share.code}`);
          }}
          onLoadEnd={() => {
            if (__DEV__) console.log(`[receiver] view loaded code=${share.code}`);
            const lan = lanIpRef.current ? lanIpInjection(lanIpRef.current) : "true;";
            webRef.current?.injectJavaScript(
              `window.applyPicture(${JSON.stringify(pictureRef.current)}); window.setMeters && window.setMeters(${JSON.stringify(metersRef.current)}); window.setDebug && window.setDebug(${isDebugEnabled() ? "true" : "false"}); window.setSoundInset && window.setSoundInset(${JSON.stringify({ right: 22, bottom: 132 })}); window.setMeterLift && window.setMeterLift(${meterLiftRef.current}); window.setOrder(${JSON.stringify(order)}); ${lan}`,
            );
          }}
          onError={(event) => {
            if (__DEV__) console.log(`[receiver] view error ${event.nativeEvent.description}`);
          }}
          onMessage={onShareMessage}
        />
    ) : null;

  const boardWebView =
    boarding && boardUri ? (
        <WebView
          style={splitLive ? styles.splitBoard : styles.whiteboardView}
          source={{ uri: boardUri }}
          originWhitelist={["*"]}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          setSupportMultipleWindows={false}
          scrollEnabled={false}
          webviewDebuggingEnabled={__DEV__}
        />
    ) : null;

  return (
    <View style={[styles.screen, { backgroundColor: theme.screen }]}>
      {splitLive ? (
        <View style={styles.splitRow}>
          {boardWebView}
          {shareWebView}
        </View>
      ) : (
        <>
          {shareWebView}
          {boardWebView}
        </>
      )}
      {showingShare && !boarding ? (
        <LiveShareHud
          onBack={leaveLiveShare}
          onStop={stopSharing}
          onHeight={(height) => {
            const lift = Math.max(0, Math.round(height + 10));
            meterLiftRef.current = lift;
            webRef.current?.injectJavaScript(`window.setMeterLift && window.setMeterLift(${lift}); true;`);
          }}
        >
          {showCode || showUrl || expiring ? (
            <ShareCard
              compact
              code={share?.code}
              url={share?.shareUrl}
              note={shareNote}
              expiring={expiring}
              showCode={showCode}
              showUrl={showUrl}
              panel={theme.sharePanel}
            />
          ) : null}
        </LiveShareHud>
      ) : boarding ? (
        <DraggableFloat initial={{ x: 28, y: 28 }}>
          <View style={styles.boardHud}>
            <View style={styles.dragGrip} accessibilityLabel="Drag share controls">
              <View style={styles.dragDot} />
              <View style={styles.dragDot} />
              <View style={styles.dragDot} />
            </View>
            <ShareCard
              compact
              embedded
              code={share?.code}
              url={share?.shareUrl}
              note={shareNote}
              expiring={expiring}
              showCode={showCode}
              showUrl={false}
              panel={theme.sharePanel}
            />
            <EndSession
              activity={activity}
              note={connectNote}
              busy={busy}
              confirmEnd={confirmEnd}
              onAskEnd={() => setConfirmEnd(true)}
              onCancelEnd={() => setConfirmEnd(false)}
              onEnd={finishSession}
              accent={theme.accent}
              danger={theme.statusError}
            />
          </View>
        </DraggableFloat>
      ) : (
        <RoomBackdrop room={room} theme={theme}>
          {theme.layout === "deep-space" ? (
            <DeepSpaceLayout
              theme={theme}
              brandName={room?.brandName}
              logoUrl={room?.logoUrl}
              roomName={room?.name ?? "Loading room"}
              clock={clock}
              phase={spacePhase}
              statusLabel={spaceStatus}
              shareCode={share?.code}
              shareUrl={share?.shareUrl}
              showCode={showCode}
              showUrl={showUrl}
              shareNote={shareNote || error || connectNote}
              current={current}
              upcoming={upcoming}
              nowSlot={display.now}
              timezone={clockZone}
              busy={busy || joining}
              joinError={joinError}
              sessionControl={
                <EndSession
                  activity={activity}
                  note={connectNote}
                  busy={busy}
                  confirmEnd={confirmEnd}
                  onAskEnd={() => setConfirmEnd(true)}
                  onCancelEnd={() => setConfirmEnd(false)}
                  onEnd={finishSession}
                  accent={theme.accent}
                  danger={theme.statusError}
                />
              }
              onOpenBoard={openBoard}
              onJoin={current ? () => joinFromPanel(current) : undefined}
              onJoinNow={
                current && display.now.joinInCard && current.joinUrl ? () => joinFromPanel(current, true) : undefined
              }
              onRetryJoin={current ? () => joinFromPanel(current, true) : undefined}
              onCancelJoin={() => {
                setJoining(false);
                setJoinError("");
              }}
            />
          ) : (
            <>
              <View style={styles.column} pointerEvents="box-none">
                <Text style={[styles.clock, theme.clock]}>{clock}</Text>
                <Text style={[styles.dateLine, theme.meta]}>{dateLine}</Text>
                <Text style={[styles.name, theme.roomName]}>{room?.name ?? "Loading room"}</Text>
                {room
                  ? Object.entries(room.meta).map(([key, value]) => (
                      <Text key={key} style={[styles.meta, theme.meta]}>
                        {key} · {value}
                      </Text>
                    ))
                  : null}
                {error ? <Text style={styles.error}>{error}</Text> : null}
                {shareCard}
                <EndSession
                  activity={activity}
                  note={connectNote}
                  busy={busy}
                  confirmEnd={confirmEnd}
                  onAskEnd={() => setConfirmEnd(true)}
                  onCancelEnd={() => setConfirmEnd(false)}
                  onEnd={finishSession}
                  accent={theme.accent}
                  danger={theme.statusError}
                />
              </View>
              <View style={styles.column}>
                <Text style={[styles.section, theme.section]}>{current ? "Now" : "Room is free"}</Text>
                {current ? (
                  <MeetingCard
                    meeting={current}
                    slot={display.now}
                    theme={theme}
                    timezone={clockZone}
                    featured
                    onPress={() => joinFromPanel(current)}
                    onJoinNow={display.now.joinInCard && current.joinUrl ? () => joinFromPanel(current, true) : undefined}
                  />
                ) : null}
                <Text style={[styles.section, theme.section]}>Next</Text>
                <ScrollView>
                  {upcoming.length === 0 ? <Text style={[styles.meta, theme.meta]}>Nothing else scheduled today.</Text> : null}
                  {upcoming.map((meeting) => (
                    <MeetingCard
                      key={meeting.id}
                      meeting={meeting}
                      slot={display.next}
                      theme={theme}
                      timezone={clockZone}
                      onPress={() => joinFromPanel(meeting)}
                    />
                  ))}
                </ScrollView>
              </View>
              <View style={styles.iconColumn}>
                <Pressable style={styles.boardButton} disabled={busy} onPress={openBoard} accessibilityLabel="Whiteboard">
                  <FontAwesome6 name="chalkboard" size={22} color="#14352c" />
                </Pressable>
              </View>
            </>
          )}
        </RoomBackdrop>
      )}
      {boarding ? (
        <Pressable style={styles.backButton} onPress={() => setMode("room")} accessibilityLabel="Back to room">
          <FontAwesome6 name="arrow-left" size={18} color="white" />
        </Pressable>
      ) : null}
      {debugOn ? (
        <Pressable style={styles.consoleButton} onPress={() => setConsoleOpen(true)} accessibilityLabel="Debug console">
          <FontAwesome6 name="terminal" size={16} color="white" />
        </Pressable>
      ) : null}
      <Pressable style={styles.settingsButton} onPress={() => setSettingsOpen((open) => !open)} accessibilityLabel="Settings">
        <Text style={styles.settingsGlyph}>⚙</Text>
      </Pressable>
      <DebugConsole
        visible={consoleOpen}
        onClose={() => setConsoleOpen(false)}
        onSubmit={sendDebugLogs}
      />
      <SettingsDialog
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        picture={picture}
        onPicture={pushPicture}
        showCode={showCode}
        showUrl={showUrl}
        showFps={showFps}
        showResolution={showResolution}
        onShowCode={setShowCode}
        onShowUrl={setShowUrl}
        onShowFps={(value) => {
          setShowFps(value);
          pushMeters(value, showResolution);
        }}
        onShowResolution={(value) => {
          setShowResolution(value);
          pushMeters(showFps, value);
        }}
        order={order}
        onMove={moveClient}
        onDrop={(slot) => dropSlots([slot])}
        clockMode={clockMode}
        manualZone={manualZone || room?.timezone || "UTC"}
        roomZone={room?.timezone}
        preview={`${dateLine}  ·  ${clock}`}
        onClockMode={setClockMode}
        onManualZone={setManualZone}
        onDisconnect={async () => {
          setSettingsOpen(false);
          await clearSession();
          onDisconnected();
        }}
        debugOn={debugOn}
        onDebug={(on) => {
          setDebugEnabled(on);
          setDebugOn(on);
          if (!on) setConsoleOpen(false);
          saveDebugMode(on).catch(() => undefined);
        }}
        onSubmitLogs={sendDebugLogs}
      />
    </View>
  );
}

function LiveShareHud({
  onBack,
  onStop,
  onHeight,
  children,
}: {
  onBack: () => void;
  onStop: () => void;
  onHeight: (height: number) => void;
  children?: ReactNode;
}) {
  const progress = useRef(new Animated.Value(1)).current;
  const [open, setOpen] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generation = useRef(0);

  function scheduleCollapse(delay: number) {
    const ticket = ++generation.current;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (ticket !== generation.current) return;
      Animated.timing(progress, { toValue: 0, duration: 280, useNativeDriver: false }).start(({ finished }) => {
        if (finished && ticket === generation.current) setOpen(false);
      });
    }, delay);
  }

  useEffect(() => {
    scheduleCollapse(2500);
    return () => {
      generation.current += 1;
      if (timer.current) clearTimeout(timer.current);
      progress.stopAnimation();
    };
  }, [progress]);

  function expand() {
    if (timer.current) clearTimeout(timer.current);
    generation.current += 1;
    setOpen(true);
    progress.stopAnimation();
    Animated.timing(progress, { toValue: 1, duration: 220, useNativeDriver: false }).start();
    scheduleCollapse(4000);
  }

  const backWidth = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 86] });
  const labelWidth = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 40] });

  return (
    <View style={styles.liveOverlay} pointerEvents="box-none" onLayout={(event) => onHeight(event.nativeEvent.layout.height)}>
      <View style={styles.liveActions}>
        <Animated.View pointerEvents={open ? "auto" : "none"} style={[styles.hudBackWrap, { width: backWidth, opacity: progress }]}>
          <Pressable onPress={onBack} hitSlop={8} style={styles.hudBack} accessibilityLabel="Back to room">
            <FontAwesome6 name="arrow-left" size={12} color="#8dceba" />
            <Text style={styles.hudBackText}>Back</Text>
          </Pressable>
        </Animated.View>
        <Pressable
          onPress={open ? onStop : expand}
          hitSlop={8}
          accessibilityLabel={open ? "Stop sharing" : "Show share controls"}
          style={styles.hudStop}
        >
          <FontAwesome6 name="stop" size={13} color="#ffb4a8" />
          <Animated.View style={[styles.hudStopLabel, { width: labelWidth, opacity: progress }]}>
            <Text style={styles.hudStopText} numberOfLines={1}>
              Stop
            </Text>
          </Animated.View>
        </Pressable>
      </View>
      {children}
    </View>
  );
}

function ShareCard({
  code,
  url,
  note,
  expiring,
  showCode,
  showUrl,
  panel,
  compact = false,
  embedded = false,
}: {
  code?: string;
  url?: string;
  note?: string;
  expiring: boolean;
  showCode: boolean;
  showUrl: boolean;
  panel: PanelTheme["sharePanel"];
  compact?: boolean;
  embedded?: boolean;
}) {
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!expiring) {
      fade.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(fade, { toValue: 0.72, duration: 1600, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 1600, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [expiring, fade]);

  const cardStyle = [
    compact ? styles.shareChip : styles.shareCard,
    embedded ? styles.shareChipEmbedded : null,
    embedded
      ? null
      : {
          backgroundColor: panel.backgroundColor,
          borderColor: panel.borderColor,
          borderWidth: panel.borderColor === "transparent" ? 0 : 1,
        },
  ];
  const labelStyle = [compact ? styles.chipLabel : styles.shareLabel, { color: panel.labelColor }];
  const codeStyle = [compact ? styles.chipCode : styles.shareCode, { color: panel.codeColor }];
  const urlStyle = [compact ? styles.chipUrl : styles.shareUrl, { color: panel.urlColor }];
  const digits = code ? code.replace(/\D/g, "").slice(0, 5) : "";
  const displayUrl = url ? shareLinkWithoutDashes(url, digits) : "";
  return (
    <View style={cardStyle}>
      {!showCode ? null : <Text style={labelStyle}>{expiring ? "Rotating" : compact ? "Code" : "Share code"}</Text>}
      {showCode || expiring ? (
        <Animated.Text style={[codeStyle, expiring && { opacity: fade }]}>
          {digits || "·····"}
        </Animated.Text>
      ) : null}
      {showUrl ? (
        <Text style={urlStyle} numberOfLines={compact ? 1 : 2}>
          {displayUrl || "Preparing the share link"}
        </Text>
      ) : null}
      {note ? (
        <Text style={urlStyle} numberOfLines={2}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

function shareLinkWithoutDashes(url: string, digits?: string) {
  try {
    const parsed = new URL(url);
    const code = (digits || parsed.pathname.replace(/\D/g, "")).slice(0, 5);
    if (!code) return `${parsed.host}${parsed.pathname}`.replace(/\/$/, "");
    return `${parsed.host}/${code}`;
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/\/(\d{2})-(\d{3})\/?$/, "/$1$2");
  }
}

/** Keep the session whiteboard path (8-char). Rewriting it to the 5-digit share code
 *  makes one-domain nginx serve share-web instead of the board. */
function whiteboardEmbedUrl(whiteboardUrl: string, controlApiUrl: string) {
  const next = new URL(whiteboardUrl);
  if (next.hostname === "localhost" || next.hostname === "127.0.0.1") {
    try {
      const host = new URL(controlApiUrl).hostname;
      if (host && host !== "localhost" && host !== "127.0.0.1") next.hostname = host;
    } catch {
      // Keep the original host when the control URL cannot be parsed.
    }
  }
  next.searchParams.set("embed", "1");
  return next.toString();
}

function RoomBackdrop({
  room,
  theme,
  children,
}: {
  room: DisplayState["room"] | null | undefined;
  theme: PanelTheme;
  children: ReactNode;
}) {
  const opacity = room?.scrimOpacity ?? (theme.layout === "deep-space" ? 0.35 : 0.62);
  const scrim = themeScrim(theme.scrim, opacity);
  const shellStyle = theme.layout === "deep-space" ? styles.deepSpaceScrim : styles.scrim;
  const preferThemeBackdrop = theme.layout === "deep-space" && theme.gradientFrom && theme.gradientTo;

  if (room?.backgroundKind === "image" && room.backgroundUrl) {
    return (
      <ImageBackground source={{ uri: room.backgroundUrl }} style={styles.foreground} imageStyle={styles.image}>
        <View style={[shellStyle, { backgroundColor: scrim }]} pointerEvents="box-none">
          {children}
        </View>
      </ImageBackground>
    );
  }
  if (preferThemeBackdrop) {
    return (
      <LinearGradient
        colors={[theme.gradientFrom!, theme.gradientTo!]}
        style={styles.foreground}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      >
        <View style={[shellStyle, { backgroundColor: scrim }]} pointerEvents="box-none">
          {children}
        </View>
      </LinearGradient>
    );
  }
  if (room?.backgroundKind === "gradient") {
    return (
      <LinearGradient
        colors={[room.backgroundGradientFrom, room.backgroundGradientTo]}
        style={styles.foreground}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      >
        <View style={[shellStyle, { backgroundColor: scrim }]} pointerEvents="box-none">
          {children}
        </View>
      </LinearGradient>
    );
  }
  return (
    <View style={[styles.foreground, { backgroundColor: room?.backgroundSolid ?? theme.screen }]}>
      <View style={[shellStyle, { backgroundColor: scrim }]} pointerEvents="box-none">
        {children}
      </View>
    </View>
  );
}

function themeScrim(scrim: string, opacity: number) {
  const match = scrim.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!match) return scrim;
  return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${opacity})`;
}

function DraggableFloat({
  children,
  initial = { x: 28, y: 28 },
}: {
  children: ReactNode;
  initial?: { x: number; y: number };
}) {
  const pan = useRef(new Animated.ValueXY(initial)).current;
  const origin = useRef(initial);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 6 || Math.abs(gesture.dy) > 6,
        onPanResponderGrant: () => {
          pan.setOffset({ x: origin.current.x, y: origin.current.y });
          pan.setValue({ x: 0, y: 0 });
        },
        onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
        onPanResponderRelease: (_, gesture) => {
          pan.flattenOffset();
          const { width, height } = Dimensions.get("window");
          const next = {
            x: Math.min(Math.max(8, origin.current.x + gesture.dx), Math.max(8, width - 200)),
            y: Math.min(Math.max(8, origin.current.y + gesture.dy), Math.max(8, height - 120)),
          };
          origin.current = next;
          pan.setValue(next);
        },
      }),
    [pan],
  );

  return (
    <Animated.View style={[styles.draggableFloat, { transform: pan.getTranslateTransform() }]} {...responder.panHandlers}>
      {children}
    </Animated.View>
  );
}

function EndSession({
  activity,
  note,
  busy,
  confirmEnd,
  onAskEnd,
  onCancelEnd,
  onEnd,
  accent,
  danger,
}: {
  activity: RoomActivity | null;
  note: string;
  busy: boolean;
  confirmEnd: boolean;
  onAskEnd: () => void;
  onCancelEnd: () => void;
  onEnd: () => void;
  accent?: string;
  danger?: string;
}) {
  if (!activity && !note) return null;
  const endColor = danger ?? "#ffb4a8";
  const linkColor = accent ?? "#8dceba";
  return (
    <View style={styles.endSession}>
      {activity ? (
        confirmEnd ? (
          <View style={styles.endConfirm}>
            <Text style={styles.endConfirmHint}>End session?</Text>
            <Pressable onPress={onEnd} disabled={busy} hitSlop={6} accessibilityLabel="Confirm end session">
              <Text style={[styles.endConfirmAction, { color: endColor }]}>End</Text>
            </Pressable>
            <Pressable onPress={onCancelEnd} hitSlop={6} accessibilityLabel="Keep session">
              <Text style={[styles.endConfirmKeep, { color: linkColor }]}>Keep</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={onAskEnd} disabled={busy} hitSlop={10} accessibilityLabel="End session">
            <Text style={styles.endQuiet}>End session</Text>
          </Pressable>
        )
      ) : null}
      {note ? (
        <Text style={styles.endNote} numberOfLines={2}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

function MeetingCard({
  meeting,
  slot,
  theme,
  timezone,
  onPress,
  onJoinNow,
  featured = false,
}: {
  meeting: Meeting;
  slot: MeetingSlotSettings;
  theme: ReturnType<typeof themeFor>;
  timezone?: string;
  onPress: () => void;
  onJoinNow?: () => void;
  featured?: boolean;
}) {
  const when = slot.showTime
    ? new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        ...(timezone ? { timeZone: timezone } : {}),
      }).format(new Date(meeting.start))
    : "";
  const subtitle = meetingSubtitle(meeting, slot);
  const body = (
    <>
      {when ? <Text style={[styles.when, theme.when]}>{when}</Text> : null}
      <View style={{ flex: 1 }}>
        <Text style={[styles.cardTitle, theme.cardTitle]}>{meetingHeadline(meeting, slot)}</Text>
        {subtitle ? <Text style={[styles.cardMeta, theme.cardMeta]}>{subtitle}</Text> : null}
      </View>
      {onJoinNow && meeting.joinUrl ? (
        <Pressable style={[styles.joinButton, theme.joinButton]} onPress={onJoinNow}>
          <Text style={[styles.joinButtonText, { color: theme.joinButton.color }]}>Join</Text>
        </Pressable>
      ) : null}
    </>
  );
  const cardStyle = [styles.card, theme.card, featured && [styles.featured, theme.cardFeatured]];
  if (onJoinNow) return <View style={cardStyle}>{body}</View>;
  return (
    <Pressable style={cardStyle} onPress={onPress}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#14221c" },
  image: { resizeMode: "cover" },
  scrim: { flex: 1, backgroundColor: "rgba(10, 16, 14, 0.62)", flexDirection: "row", padding: 36, gap: 32 },
  deepSpaceScrim: { flex: 1, backgroundColor: "rgba(4, 8, 22, 0.35)" },
  column: { flex: 1 },
  clock: { color: "white", fontSize: 72, fontWeight: "600", fontVariant: ["tabular-nums"] },
  dateLine: { marginTop: 2 },
  name: { color: "white", fontSize: 40, fontWeight: "600", marginTop: 4 },
  meta: { color: "#d7e0da", fontSize: 18, marginTop: 4 },
  error: { color: "#ffb4a8", marginTop: 12, fontSize: 16 },
  shareView: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "#101410", zIndex: 0, elevation: 0 },
  foreground: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  liveOverlay: { position: "absolute", left: 18, bottom: 18, maxWidth: 420, zIndex: 4, elevation: 6 },
  liveActions: { flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 8 },
  hudBackWrap: { height: 40, overflow: "hidden" },
  hudBack: {
    width: 86,
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 999,
    backgroundColor: "rgba(20, 24, 22, 0.82)",
  },
  hudBackText: { color: "#8dceba", fontSize: 13 },
  hudStop: {
    height: 40,
    paddingHorizontal: 13,
    borderRadius: 999,
    backgroundColor: "rgba(20, 24, 22, 0.82)",
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
  },
  hudStopLabel: { marginLeft: 6, overflow: "hidden" },
  hudStopText: { color: "#ffb4a8", fontSize: 13, fontWeight: "600" },
  shareChip: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    backgroundColor: "rgba(20, 24, 22, 0.82)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  shareChipEmbedded: {
    backgroundColor: "transparent",
    borderWidth: 0,
    paddingHorizontal: 2,
    paddingVertical: 0,
    borderRadius: 0,
    alignSelf: "flex-start",
  },
  chipLabel: { color: "#8dceba", fontSize: 11, letterSpacing: 1, textTransform: "uppercase" },
  chipCode: { color: "white", fontSize: 22, fontWeight: "600", letterSpacing: 1, fontVariant: ["tabular-nums"] },
  chipUrl: { color: "#d7e0da", fontSize: 12, flexShrink: 1 },
  shareCard: {
    marginTop: 22,
    alignSelf: "flex-start",
    maxWidth: 460,
    backgroundColor: "rgba(20, 24, 22, 0.88)",
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  shareLabel: { color: "#8dceba", fontSize: 13, letterSpacing: 1.4, textTransform: "uppercase" },
  shareCode: { color: "white", fontSize: 48, fontWeight: "600", letterSpacing: 4, marginTop: 4, fontVariant: ["tabular-nums"] },
  splitRow: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, flexDirection: "row", gap: 4, zIndex: 1, elevation: 1 },
  splitBoard: { flex: 1, backgroundColor: "#ffffff" },
  splitShare: { minWidth: 0, backgroundColor: "#101410" },
  shareUrl: { color: "#d7e0da", fontSize: 15, marginTop: 6 },
  draggableFloat: { position: "absolute", left: 0, top: 0, zIndex: 5, elevation: 16 },
  boardHud: {
    maxWidth: 280,
    gap: 6,
    padding: 8,
    borderRadius: 16,
    backgroundColor: "rgba(12, 16, 20, 0.55)",
  },
  dragGrip: {
    alignSelf: "center",
    flexDirection: "row",
    gap: 3,
    paddingVertical: 2,
    opacity: 0.45,
  },
  dragDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: "#ffffff" },
  endSession: { alignSelf: "flex-start", marginTop: 4 },
  endQuiet: { color: "rgba(255,255,255,0.42)", fontSize: 12, letterSpacing: 0.2 },
  endConfirm: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  endConfirmHint: { color: "rgba(255,255,255,0.62)", fontSize: 12 },
  endConfirmAction: { fontSize: 12, fontWeight: "600" },
  endConfirmKeep: { fontSize: 12, fontWeight: "500" },
  endNote: { color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 4, maxWidth: 240 },
  iconColumn: { width: 72, alignItems: "flex-end" },
  boardButton: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  whiteboardView: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "#ffffff", zIndex: 2, elevation: 2 },
  backButton: {
    position: "absolute",
    top: 22,
    right: 22,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(20, 24, 22, 0.72)",
    zIndex: 7,
    elevation: 16,
  },
  consoleButton: {
    position: "absolute",
    right: 22,
    bottom: 76,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(20, 24, 22, 0.72)",
    zIndex: 6,
    elevation: 12,
  },
  settingsButton: {
    position: "absolute",
    right: 22,
    bottom: 22,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(20, 24, 22, 0.72)",
    zIndex: 6,
    elevation: 12,
  },
  settingsGlyph: { color: "white", fontSize: 20 },
  section: { color: "white", fontSize: 22, marginBottom: 10, marginTop: 8 },
  card: { backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 16, padding: 14, marginBottom: 10, flexDirection: "row", gap: 14 },
  featured: { backgroundColor: "rgba(12, 107, 82, 0.85)" },
  when: { color: "white", fontSize: 22, fontVariant: ["tabular-nums"], width: 92 },
  cardTitle: { color: "white", fontSize: 22 },
  cardMeta: { marginTop: 4 },
  joinButton: { alignSelf: "center", paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999 },
  joinButtonText: { fontSize: 18, fontWeight: "600" },
});
