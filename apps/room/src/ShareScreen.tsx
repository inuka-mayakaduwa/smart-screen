import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { openOemPackage } from "./launch";
import { shareProviders, type ShareAvailability, type ShareProvider } from "./shareProviders";
import type { DisplayState } from "./types";

export function ShareScreen({
  state,
  onBack,
  onRoomCode,
}: {
  state: DisplayState;
  onBack: () => void;
  onRoomCode: () => void;
}) {
  const providers = shareProviders(state.share);
  const [availability, setAvailability] = useState<Record<string, ShareAvailability>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all(providers.map(async (provider) => [provider.id, await provider.available()] as const)).then((entries) => {
      if (!cancelled) setAvailability(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [state.share]);

  async function start(provider: ShareProvider) {
    setError("");
    const ready = availability[provider.id];
    if (!ready?.ok) {
      setError(ready?.reason ?? "This receiver is not available");
      return;
    }
    if (provider.id === "room-code") {
      onRoomCode();
      return;
    }
    if (provider.id === "oem" && state.share.oemPackage) {
      try {
        await openOemPackage(state.share.oemPackage);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not open the share app");
      }
    }
  }

  return (
    <View style={styles.screen}>
      <Pressable onPress={onBack}>
        <Text style={styles.back}>Back to the room</Text>
      </Pressable>
      <Text style={styles.title}>Share a screen</Text>
      {providers.length === 0 ? <Text style={styles.copy}>Sharing is turned off for this room.</Text> : null}
      {providers.map((provider) => {
        const ready = availability[provider.id];
        return (
          <Pressable key={provider.id} style={styles.row} onPress={() => start(provider)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>{provider.label}</Text>
              {ready && !ready.ok ? <Text style={styles.reason}>{ready.reason}</Text> : null}
            </View>
            <Text style={styles.action}>{ready?.ok ? "Start" : "Unavailable"}</Text>
          </Pressable>
        );
      })}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#14221c", padding: 48 },
  back: { color: "#d7e0da", fontSize: 16, marginBottom: 20 },
  title: { color: "white", fontSize: 48, fontWeight: "600", marginBottom: 20 },
  copy: { color: "#d7e0da", fontSize: 18 },
  row: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 18,
    padding: 18,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  label: { color: "white", fontSize: 24 },
  reason: { color: "#d7e0da", marginTop: 4, fontSize: 15, maxWidth: 760 },
  action: { color: "#8dceba", fontSize: 16 },
  error: { color: "#ffb4a8", marginTop: 8, fontSize: 16 },
});
