import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { clearDebugLines, getDebugLines, subscribeDebug, type DebugLine } from "./debugLog";

const LEVEL_COLOR: Record<DebugLine["level"], string> = {
  info: "#d7e0da",
  warn: "#f3d38a",
  error: "#ffb4a8",
  network: "#8dceba",
};

export function DebugConsole({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: () => Promise<{ lineCount: number }>;
}) {
  const [lines, setLines] = useState<DebugLine[]>(() => getDebugLines());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<ScrollView>(null);

  useEffect(() => subscribeDebug(() => setLines(getDebugLines())), []);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => scroller.current?.scrollToEnd({ animated: false }), 40);
    return () => clearTimeout(timer);
  }, [visible, lines.length]);

  async function send() {
    setBusy(true);
    setNote("");
    try {
      const result = await onSubmit();
      setNote(`Sent ${result.lineCount} lines to the control pane.`);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not send logs");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={["landscape", "landscape-left", "landscape-right"]}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Debug console</Text>
            <Text style={styles.detail}>Last {lines.length} lines. Tokens and passwords are left out.</Text>
          </View>
          <View style={styles.actions}>
            <Pressable style={styles.ghost} onPress={clearDebugLines}>
              <Text style={styles.ghostText}>Clear</Text>
            </Pressable>
            <Pressable style={styles.send} disabled={busy || lines.length === 0} onPress={() => void send()}>
              <Text style={styles.sendText}>{busy ? "Sending…" : "Submit debug logs"}</Text>
            </Pressable>
            <Pressable style={styles.ghost} onPress={onClose}>
              <Text style={styles.ghostText}>Close</Text>
            </Pressable>
          </View>
        </View>
        {note ? <Text style={styles.note}>{note}</Text> : null}
        <ScrollView ref={scroller} style={styles.log} contentContainerStyle={styles.logInner}>
          {lines.length === 0 ? <Text style={styles.empty}>No lines yet. Network calls and share events appear here while debug mode is on.</Text> : null}
          {lines.map((line, index) => (
            <Text key={`${line.at}-${index}`} style={[styles.line, { color: LEVEL_COLOR[line.level] }]}>
              {formatLine(line)}
            </Text>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

function formatLine(line: DebugLine) {
  const clock = line.at.slice(11, 23);
  const head = `${clock}  ${line.level.padEnd(7)}  ${line.scope}  ${line.message}`;
  return line.detail ? `${head}\n  ${line.detail}` : head;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#101816", paddingHorizontal: 22, paddingTop: 18, paddingBottom: 14 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  title: { color: "white", fontSize: 28, fontWeight: "600" },
  detail: { color: "#9eaba4", fontSize: 14, marginTop: 2 },
  actions: { flexDirection: "row", gap: 8, alignItems: "center" },
  ghost: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.08)" },
  ghostText: { color: "white", fontSize: 15 },
  send: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: "#0c6b52" },
  sendText: { color: "white", fontSize: 15, fontWeight: "600" },
  note: { color: "#d7e0da", marginTop: 10, fontSize: 14 },
  log: { flex: 1, marginTop: 12, backgroundColor: "#0b100e", borderRadius: 14 },
  logInner: { padding: 14, gap: 8 },
  empty: { color: "#9eaba4", fontSize: 15 },
  line: { fontFamily: "monospace", fontSize: 13, lineHeight: 18 },
});
