import { useState, type ReactNode } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { UPDATE_METHODS, useAppUpdate } from "./appUpdate";

export type LatencyMode = "skip" | "queue";
export type PictureSettings = { width: number; fps: number; quality: number; latency: LatencyMode };
export type ClockMode = "system" | "auto" | "manual";

type Tab = "picture" | "share" | "clock" | "device" | "debug";

const TABS: { id: Tab; label: string }[] = [
  { id: "picture", label: "Picture" },
  { id: "share", label: "Connect" },
  { id: "clock", label: "Date & time" },
  { id: "device", label: "Panel" },
  { id: "debug", label: "Debug" },
];

const WIDTH_CHOICES = [
  { label: "Auto", width: -1 },
  { label: "720p", width: 1280 },
  { label: "1080p", width: 1920 },
  { label: "1440p", width: 2560 },
  { label: "Source", width: 0 },
];
const FRAME_RATES = [0, 15, 24, 30, 60];
const LATENCY_CHOICES: { label: string; latency: LatencyMode }[] = [
  { label: "Skip", latency: "skip" },
  { label: "Queue", latency: "queue" },
];
const QUALITY_CHOICES = [
  { label: "Sharp", quality: 0.75 },
  { label: "High", quality: 0.9 },
  { label: "Highest", quality: 0.95 },
];
const CLOCK_MODES: { id: ClockMode; label: string; hint: string }[] = [
  { id: "system", label: "System default", hint: "This device’s date, time, and time zone." },
  { id: "auto", label: "Auto", hint: "The room time zone from the control pane." },
  { id: "manual", label: "Manual", hint: "Show the device clock in a time zone you choose." },
];
const ZONES: { id: string; label: string }[] = [
  { id: "UTC", label: "UTC" },
  { id: "Asia/Colombo", label: "Colombo" },
  { id: "Asia/Kolkata", label: "India" },
  { id: "Asia/Dhaka", label: "Dhaka" },
  { id: "Asia/Dubai", label: "Dubai" },
  { id: "Asia/Singapore", label: "Singapore" },
  { id: "Asia/Tokyo", label: "Tokyo" },
  { id: "Europe/London", label: "London" },
  { id: "Europe/Berlin", label: "Berlin" },
  { id: "America/New_York", label: "New York" },
  { id: "America/Los_Angeles", label: "Los Angeles" },
  { id: "Australia/Sydney", label: "Sydney" },
];

export function SettingsDialog({
  visible,
  onClose,
  picture,
  onPicture,
  showCode,
  showUrl,
  showFps,
  showResolution,
  onShowCode,
  onShowUrl,
  onShowFps,
  onShowResolution,
  order,
  onMove,
  onDrop,
  clockMode,
  manualZone,
  roomZone,
  preview,
  onClockMode,
  onManualZone,
  onDisconnect,
  debugOn,
  onDebug,
  onSubmitLogs,
}: {
  visible: boolean;
  onClose: () => void;
  picture: PictureSettings;
  onPicture: (next: PictureSettings) => void;
  showCode: boolean;
  showUrl: boolean;
  showFps: boolean;
  showResolution: boolean;
  onShowCode: (value: boolean) => void;
  onShowUrl: (value: boolean) => void;
  onShowFps: (value: boolean) => void;
  onShowResolution: (value: boolean) => void;
  order: number[];
  onMove: (index: number, delta: number) => void;
  onDrop: (slot: number) => void;
  clockMode: ClockMode;
  manualZone: string;
  roomZone?: string;
  preview: string;
  onClockMode: (mode: ClockMode) => void;
  onManualZone: (zone: string) => void;
  onDisconnect: () => void;
  debugOn: boolean;
  onDebug: (value: boolean) => void;
  onSubmitLogs: () => Promise<{ lineCount: number }>;
}) {
  const [tab, setTab] = useState<Tab>("picture");
  const [debugNote, setDebugNote] = useState("");
  const [debugBusy, setDebugBusy] = useState(false);
  const update = useAppUpdate();
  const zones = roomZone && !ZONES.some((zone) => zone.id === roomZone) ? [{ id: roomZone, label: roomZone }, ...ZONES] : ZONES;

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={["landscape", "landscape-left", "landscape-right"]}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
          <Pressable style={styles.close} onPress={onClose}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>
        <View style={styles.body}>
          <View style={styles.tabs}>
            {TABS.map((item) => (
              <Pressable key={item.id} style={[styles.tab, tab === item.id && styles.tabOn]} onPress={() => setTab(item.id)}>
                <Text style={[styles.tabText, tab === item.id && styles.tabTextOn]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
          <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
            {tab === "picture" ? (
              <>
                <Section title="Resolution" detail="Auto follows the laptop and steps down if frames fall behind.">
                  <Choices
                    options={WIDTH_CHOICES.map((choice) => ({ id: String(choice.width), label: choice.label, on: picture.width === choice.width }))}
                    onPress={(id) => onPicture({ ...picture, width: Number(id) })}
                  />
                </Section>
                <Section title="Max frames per second" detail="Auto uses a rate the shared picture can keep up with.">
                  <Choices
                    options={FRAME_RATES.map((fps) => ({ id: String(fps), label: fps === 0 ? "Auto" : String(fps), on: picture.fps === fps }))}
                    onPress={(id) => onPicture({ ...picture, fps: Number(id) })}
                  />
                </Section>
                <Section title="Latency" detail="Skip stays close to live. Queue is smoother and adds delay.">
                  <Choices
                    options={LATENCY_CHOICES.map((choice) => ({ id: choice.latency, label: choice.label, on: picture.latency === choice.latency }))}
                    onPress={(id) => onPicture({ ...picture, latency: id as LatencyMode })}
                  />
                </Section>
                <Section title="Sharpness" detail="Higher sharpness sends a larger picture.">
                  <Choices
                    options={QUALITY_CHOICES.map((choice) => ({ id: String(choice.quality), label: choice.label, on: picture.quality === choice.quality }))}
                    onPress={(id) => onPicture({ ...picture, quality: Number(id) })}
                  />
                </Section>
                <Section title="On the picture" detail="Draws live values on the shared screen. The label says Native or JPEG, which is the path actually on screen.">
                  <Toggle label="Show FPS" value={showFps} onChange={onShowFps} />
                  <Toggle label="Show resolution" value={showResolution} onChange={onShowResolution} />
                </Section>
              </>
            ) : null}
            {tab === "share" ? (
              <>
                <Section title="On the panel" detail="The code still appears during the last 10 seconds before it changes.">
                  <Toggle label="Show share code" value={showCode} onChange={onShowCode} />
                  <Toggle label="Show share URL" value={showUrl} onChange={onShowUrl} />
                </Section>
                <Section title="Screens" detail={order.length ? "Left and right change the order. Disconnect stops that laptop. The room returns when the last one stops." : "No laptops are sharing."}>
                  {order.map((slot, index) => (
                    <View key={slot} style={styles.screenRow}>
                      <Text style={styles.screenName}>Screen {index + 1}</Text>
                      <View style={styles.screenActions}>
                        <TextButton label="Left" disabled={index === 0} onPress={() => onMove(index, -1)} />
                        <TextButton label="Right" disabled={index === order.length - 1} onPress={() => onMove(index, 1)} />
                        {order.length >= 3 ? <TextButton label="Up" disabled={verticalDelta(order.length, index, -1) === 0} onPress={() => onMove(index, verticalDelta(order.length, index, -1))} /> : null}
                        {order.length >= 3 ? <TextButton label="Down" disabled={verticalDelta(order.length, index, 1) === 0} onPress={() => onMove(index, verticalDelta(order.length, index, 1))} /> : null}
                        <TextButton label="Disconnect" danger onPress={() => onDrop(slot)} />
                      </View>
                    </View>
                  ))}
                </Section>
              </>
            ) : null}
            {tab === "clock" ? (
              <>
                <Section title="Date & time" detail="This changes the clock on the panel. It does not change the Android system clock.">
                  {CLOCK_MODES.map((mode) => (
                    <Pressable key={mode.id} style={[styles.mode, clockMode === mode.id && styles.modeOn]} onPress={() => onClockMode(mode.id)}>
                      <View style={[styles.radio, clockMode === mode.id && styles.radioOn]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.modeLabel}>{mode.label}</Text>
                        <Text style={styles.modeHint}>{mode.id === "auto" && roomZone ? `${mode.hint} ${roomZone}` : mode.hint}</Text>
                      </View>
                    </Pressable>
                  ))}
                  <Text style={styles.preview}>{preview}</Text>
                </Section>
                {clockMode === "manual" ? (
                  <Section title="Time zone" detail="The panel shows the current time in this zone.">
                    <Choices
                      options={zones.map((zone) => ({ id: zone.id, label: zone.label, on: (manualZone || roomZone) === zone.id }))}
                      onPress={onManualZone}
                    />
                  </Section>
                ) : null}
              </>
            ) : null}
            {tab === "device" ? (
              <>
                <Section title="App version" detail="The build installed on this panel.">
                  <Text style={styles.version}>
                    {update.versionName} ({update.versionCode || "dev"})
                  </Text>
                </Section>
                <Section title="Update method" detail="Published APKs install from this panel. The control pane hosts the file.">
                  {UPDATE_METHODS.map((item) => (
                    <Pressable key={item.id} style={[styles.mode, update.method === item.id && styles.modeOn]} onPress={() => update.setMethod(item.id)}>
                      <View style={[styles.radio, update.method === item.id && styles.radioOn]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.modeLabel}>{item.label}</Text>
                        <Text style={styles.modeHint}>{item.hint}</Text>
                      </View>
                    </Pressable>
                  ))}
                </Section>
                <Section title="Check for update" detail={update.pending ? `${update.pending.versionName} is published.${update.pending.notes ? ` ${update.pending.notes}` : ""}` : "Look for a newer APK on the control server."}>
                  {update.status ? <Text style={styles.modeHint}>{update.status}</Text> : null}
                  <View style={styles.screenActions}>
                    <Pressable style={styles.update} disabled={update.busy} onPress={() => void update.check()}>
                      <Text style={styles.updateText}>Check for update</Text>
                    </Pressable>
                    {update.pending ? (
                      <Pressable style={styles.update} disabled={update.busy} onPress={() => void update.install()}>
                        {update.busy ? <ActivityIndicator color="white" /> : <Text style={styles.updateText}>Install {update.pending.versionName}</Text>}
                      </Pressable>
                    ) : null}
                  </View>
                </Section>
                <Section title="This panel" detail="Disconnect removes the Connect token stored on this device. The room keeps its calendars and settings.">
                  <Pressable style={styles.disconnect} onPress={onDisconnect}>
                    <Text style={styles.disconnectText}>Disconnect panel</Text>
                  </Pressable>
                </Section>
              </>
            ) : null}
            {tab === "debug" ? (
              <>
                <Section title="Debug mode" detail="Records the last 400 lines: requests, responses, share connections, and errors. When debug turns on, one hardware line lists Wi‑Fi Direct and installed apps that look like Cast, Miracast, AirPlay, or mirroring (not a license check). Share lines say native video or jpeg picture. Connect tokens and passwords are left out.">
                  <Toggle label="Debug mode" value={debugOn} onChange={onDebug} />
                </Section>
                <Section title="Send to the control pane" detail="Submit the lines on this panel. They show up under Debug logs in admin, where they can be read and exported.">
                  {debugNote ? <Text style={styles.modeHint}>{debugNote}</Text> : null}
                  <Pressable
                    style={styles.update}
                    disabled={debugBusy}
                    onPress={() => {
                      setDebugBusy(true);
                      setDebugNote("");
                      onSubmitLogs()
                        .then((result) => setDebugNote(`Sent ${result.lineCount} lines.`))
                        .catch((err) => setDebugNote(err instanceof Error ? err.message : "Could not send logs"))
                        .finally(() => setDebugBusy(false));
                    }}
                  >
                    <Text style={styles.updateText}>{debugBusy ? "Sending…" : "Submit debug logs"}</Text>
                  </Pressable>
                </Section>
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function verticalDelta(count: number, index: number, direction: -1 | 1) {
  if (count >= 4) return direction * 2;
  if (count === 3 && direction > 0 && index < 2) return 2 - index;
  if (count === 3 && direction < 0 && index === 2) return -2;
  return 0;
}

function Section({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionDetail}>{detail}</Text>
      {children}
    </View>
  );
}

function Choices({ options, onPress }: { options: { id: string; label: string; on: boolean }[]; onPress: (id: string) => void }) {
  return (
    <View style={styles.choices}>
      {options.map((option) => (
        <Pressable key={option.id} style={[styles.choice, option.on && styles.choiceOn]} onPress={() => onPress(option.id)}>
          <Text style={[styles.choiceText, option.on && styles.choiceTextOn]}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={styles.toggle}>
      <Text style={styles.toggleText}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: "#3d4742", true: "#0c6b52" }} thumbColor="#ffffff" />
    </View>
  );
}

function TextButton({ label, disabled, danger, onPress }: { label: string; disabled?: boolean; danger?: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.textButton, disabled && styles.textButtonOff]} disabled={disabled} onPress={onPress}>
      <Text style={[styles.textButtonLabel, danger && styles.textButtonDanger]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#101816", paddingHorizontal: 28, paddingTop: 22, paddingBottom: 18 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  title: { color: "white", fontSize: 32, fontWeight: "600" },
  close: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.08)" },
  closeText: { color: "white", fontSize: 16 },
  body: { flex: 1, flexDirection: "row", gap: 18 },
  tabs: { width: 210, gap: 6 },
  tab: { borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14 },
  tabOn: { backgroundColor: "#0c6b52" },
  tabText: { color: "#c9d4ce", fontSize: 18 },
  tabTextOn: { color: "white", fontWeight: "600" },
  content: { flex: 1 },
  contentInner: { paddingBottom: 12, gap: 14 },
  section: { backgroundColor: "#1b2420", borderRadius: 16, padding: 16, gap: 10 },
  sectionTitle: { color: "white", fontSize: 18, fontWeight: "600" },
  sectionDetail: { color: "#9eaba4", fontSize: 14, marginTop: -4 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: "rgba(255,255,255,0.06)" },
  choiceOn: { backgroundColor: "#0c6b52" },
  choiceText: { color: "#d7e0da", fontSize: 15 },
  choiceTextOn: { color: "white", fontWeight: "600" },
  toggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  toggleText: { color: "white", fontSize: 16 },
  screenRow: { gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)" },
  screenName: { color: "white", fontSize: 16, fontWeight: "600" },
  screenActions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  textButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.06)" },
  textButtonOff: { opacity: 0.35 },
  textButtonLabel: { color: "white", fontSize: 14 },
  textButtonDanger: { color: "#ffb4a8" },
  mode: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.04)" },
  modeOn: { backgroundColor: "rgba(12,107,82,0.35)" },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "#8d9b94" },
  radioOn: { borderColor: "#8dceba", borderWidth: 5 },
  modeLabel: { color: "white", fontSize: 16, fontWeight: "600" },
  modeHint: { color: "#9eaba4", fontSize: 13, marginTop: 2 },
  preview: { color: "white", fontSize: 22, fontWeight: "600", marginTop: 4 },
  version: { color: "white", fontSize: 28, fontWeight: "600" },
  update: { alignSelf: "flex-start", paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999, backgroundColor: "#0c6b52" },
  updateText: { color: "white", fontSize: 16, fontWeight: "600" },
  disconnect: { alignSelf: "flex-start", paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999, backgroundColor: "rgba(255,180,168,0.12)" },
  disconnectText: { color: "#ffb4a8", fontSize: 16, fontWeight: "600" },
});
