import { FontAwesome6 } from "@expo/vector-icons";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { redeemPanel } from "./api";
import { DebugConsole } from "./DebugConsole";
import { debug, getDebugLines, isDebugEnabled, setDebugEnabled } from "./debugLog";
import { normalizeServerUrl, saveDebugMode, saveSession } from "./session";
import type { PanelSession } from "./types";

const defaultServer = process.env.EXPO_PUBLIC_CONTROL_API_URL ?? "";

export function ConnectScreen({ onConnected, notice }: { onConnected: (session: PanelSession) => void; notice?: string }) {
  const [server, setServer] = useState(defaultServer);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [debugOn, setDebugOn] = useState(isDebugEnabled);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [debugNote, setDebugNote] = useState("");

  async function connect() {
    setPending(true);
    setError("");
    try {
      const controlApiUrl = normalizeServerUrl(server);
      const redeemed = await redeemPanel(controlApiUrl, token);
      const session = { controlApiUrl, deviceToken: redeemed.deviceToken };
      await saveSession(session);
      debug("panel", "info", `Connected to ${controlApiUrl}`);
      onConnected(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect this panel");
    } finally {
      setPending(false);
    }
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.kicker}>Smart room</Text>
      <Text style={styles.title}>Connect this panel</Text>
      <Text style={styles.copy}>Enter the short-lived token from the control pane. This panel does not sign in to Google or Microsoft.</Text>
      <TextInput
        value={server}
        onChangeText={setServer}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Enter Connect URL"
        placeholderTextColor="#8d978f"
        style={styles.input}
      />
      <TextInput
        value={token}
        onChangeText={(value) => setToken(value.toUpperCase())}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="Connect token"
        placeholderTextColor="#8d978f"
        style={[styles.input, styles.token]}
      />
      {notice ? <Text style={styles.error}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={styles.button} disabled={pending} onPress={connect}>
        <Text style={styles.buttonText}>{pending ? "Connecting…" : "Connect"}</Text>
      </Pressable>
      {debugOn ? (
        <Pressable style={styles.consoleButton} onPress={() => setConsoleOpen(true)} accessibilityLabel="Debug console">
          <FontAwesome6 name="terminal" size={16} color="white" />
        </Pressable>
      ) : null}
      <Pressable style={styles.settingsButton} onPress={() => setSettingsOpen(true)} accessibilityLabel="Settings">
        <Text style={styles.settingsGlyph}>⚙</Text>
      </Pressable>
      <DebugConsole visible={consoleOpen} onClose={() => setConsoleOpen(false)} onSubmit={sendDebugLogs} />
      <Modal visible={settingsOpen} animationType="fade" onRequestClose={() => setSettingsOpen(false)} statusBarTranslucent supportedOrientations={["landscape", "landscape-left", "landscape-right"]}>
        <View style={styles.settings}>
          <View style={styles.settingsHeader}>
            <Text style={styles.settingsTitle}>Settings</Text>
            <Pressable style={styles.close} onPress={() => setSettingsOpen(false)}>
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Debug mode</Text>
            <Text style={styles.sectionDetail}>Records the last 400 lines while this panel connects. A terminal button appears above settings. Tokens and passwords are left out.</Text>
            <View style={styles.toggle}>
              <Text style={styles.toggleText}>Debug mode</Text>
              <Switch
                value={debugOn}
                onValueChange={(on) => {
                  setDebugEnabled(on);
                  setDebugOn(on);
                  if (!on) setConsoleOpen(false);
                  saveDebugMode(on).catch(() => undefined);
                }}
                trackColor={{ false: "#3d4742", true: "#0c6b52" }}
                thumbColor="#ffffff"
              />
            </View>
          </View>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Send to the control pane</Text>
            <Text style={styles.sectionDetail}>Submit after the panel stays connected. Until then, open the terminal button to read the lines on this device.</Text>
            {debugNote ? <Text style={styles.sectionDetail}>{debugNote}</Text> : null}
            <Pressable
              style={styles.button}
              onPress={() => {
                sendDebugLogs()
                  .then((result) => setDebugNote(`Sent ${result.lineCount} lines.`))
                  .catch((err) => setDebugNote(err instanceof Error ? err.message : "Could not send logs"));
              }}
            >
              <Text style={styles.buttonText}>Submit debug logs</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );

  async function sendDebugLogs(): Promise<{ lineCount: number }> {
    const lines = getDebugLines();
    if (!lines.length) throw new Error("No debug lines yet. Turn debug mode on, then connect.");
    throw new Error("Connect this panel and leave it on the room screen to send logs.");
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#14221c", paddingHorizontal: 72, justifyContent: "center" },
  kicker: { color: "#8dceba", letterSpacing: 2, textTransform: "uppercase", fontSize: 13 },
  title: { color: "white", fontSize: 56, fontWeight: "600", marginTop: 8 },
  copy: { color: "#d5ddd6", fontSize: 18, maxWidth: 720, marginVertical: 16 },
  input: {
    backgroundColor: "rgba(255,255,255,0.08)",
    color: "white",
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 16,
    fontSize: 20,
    marginBottom: 12,
    maxWidth: 760,
  },
  token: { letterSpacing: 4, fontSize: 28 },
  error: { color: "#ffb4a8", marginBottom: 12, fontSize: 16 },
  button: { backgroundColor: "#0c6b52", alignSelf: "flex-start", paddingHorizontal: 22, paddingVertical: 14, borderRadius: 999 },
  buttonText: { color: "white", fontSize: 18 },
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
  },
  settingsGlyph: { color: "white", fontSize: 20 },
  settings: { flex: 1, backgroundColor: "#101816", paddingHorizontal: 28, paddingTop: 22 },
  settingsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  settingsTitle: { color: "white", fontSize: 32, fontWeight: "600" },
  close: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.08)" },
  closeText: { color: "white", fontSize: 16 },
  section: { backgroundColor: "#1b2420", borderRadius: 16, padding: 16, gap: 10, marginBottom: 14, maxWidth: 720 },
  sectionTitle: { color: "white", fontSize: 18, fontWeight: "600" },
  sectionDetail: { color: "#9eaba4", fontSize: 14 },
  toggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  toggleText: { color: "white", fontSize: 16 },
});
