import Constants from "expo-constants";
import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { fetchAppRelease, type AppReleaseInfo } from "./api";
import { loadUpdateMethod, saveUpdateMethod, type UpdateMethod } from "./session";
import type { PanelSession } from "./types";

const PACKAGE = "com.smartscreen.room";

export const UPDATE_METHODS: { id: UpdateMethod; label: string; hint: string }[] = [
  { id: "manual", label: "Manual Check", hint: "Install only when you tap Check for update." },
  { id: "prompt", label: "Prompt on launch", hint: "Ask each time the panel opens when a newer APK is published." },
  { id: "force", label: "Force", hint: "Keep the panel on the update screen until the installer starts." },
];

type UpdateContextValue = {
  method: UpdateMethod;
  setMethod: (method: UpdateMethod) => void;
  versionName: string;
  versionCode: number;
  pending: AppReleaseInfo | null;
  status: string;
  busy: boolean;
  check: () => Promise<void>;
  install: () => Promise<void>;
};

const UpdateContext = createContext<UpdateContextValue | null>(null);

function parseVersionCode(raw: string | number | null | undefined): number {
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

/** Installed binary version; prefers native constants, then app config. */
export function installedBuild(): { versionName: string; versionCode: number } {
  const versionName = Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? "1.0.0";
  const fromNative = parseVersionCode(Constants.nativeBuildVersion);
  const fromConfig = Platform.OS === "android" ? parseVersionCode(Constants.expoConfig?.android?.versionCode) : 0;
  const versionCode = fromNative || fromConfig;
  return { versionName, versionCode };
}

function panelIsUpToDate(release: AppReleaseInfo, installed: { versionName: string; versionCode: number }): boolean {
  if (installed.versionCode > 0 && release.versionCode <= installed.versionCode) return true;
  if (installed.versionCode === 0 && release.versionName === installed.versionName) return true;
  return false;
}

export function useAppUpdate(): UpdateContextValue {
  const value = useContext(UpdateContext);
  if (!value) throw new Error("App updates are only available on a connected panel");
  return value;
}

export function AppUpdateProvider({ session, children }: { session: PanelSession; children: ReactNode }) {
  const installed = installedBuild();
  const [method, setMethodState] = useState<UpdateMethod>("prompt");
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<AppReleaseInfo | null>(null);
  const [ask, setAsk] = useState(false);
  const [block, setBlock] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    loadUpdateMethod()
      .then(setMethodState)
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  const check = useCallback(
    async (fromLaunch = false) => {
      setFailed(false);
      try {
        const release = await fetchAppRelease(session.controlApiUrl, session.deviceToken);
        if (!release || panelIsUpToDate(release, installed)) {
          setPending(null);
          setAsk(false);
          setBlock(false);
          if (!fromLaunch) setStatus("This panel is up to date.");
          return;
        }
        setPending(release);
        setStatus(`${release.versionName} is ready to install.`);
        if (method === "force") setBlock(true);
        if (fromLaunch && method === "prompt") setAsk(true);
      } catch (error) {
        if (!fromLaunch) setStatus(error instanceof Error ? error.message : "Could not check for an update");
      }
    },
    [installed.versionCode, method, session.controlApiUrl, session.deviceToken],
  );

  useEffect(() => {
    if (!ready || method === "manual") return;
    void check(true);
  }, [ready, method, check]);

  const setMethod = useCallback((next: UpdateMethod) => {
    setMethodState(next);
    saveUpdateMethod(next).catch(() => undefined);
    if (next !== "force") setBlock(false);
    if (next !== "prompt") setAsk(false);
  }, []);

  const install = useCallback(async () => {
    if (!pending || busy) return;
    setBusy(true);
    setFailed(false);
    setStatus("Downloading the update…");
    try {
      const safeName = pending.versionName.replace(/[^a-z0-9._-]+/gi, "-");
      const destination = new File(Paths.cache, `smart-room-${safeName}.apk`);
      const file = await File.downloadFileAsync(`${session.controlApiUrl}/api/display/update/apk`, destination, {
        headers: { Authorization: `Bearer ${session.deviceToken}` },
        idempotent: true,
        onProgress: ({ bytesWritten, totalBytes }) => {
          if (totalBytes > 0) setStatus(`Downloading ${Math.min(100, Math.round((bytesWritten / totalBytes) * 100))}%`);
        },
      });
      setStatus("Opening the installer…");
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: file.contentUri,
        flags: 1,
        type: "application/vnd.android.package-archive",
      });
      setStatus("Finish the installer to update this panel.");
    } catch (error) {
      setFailed(true);
      setStatus(error instanceof Error ? error.message : "The installer did not open");
    } finally {
      setBusy(false);
    }
  }, [busy, pending, session.controlApiUrl, session.deviceToken]);

  const allowInstalls = useCallback(() => {
    IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES, {
      data: `package:${PACKAGE}`,
    }).catch(() => setStatus("Open Android settings and allow this app to install unknown apps."));
  }, []);

  const value = useMemo<UpdateContextValue>(
    () => ({
      method,
      setMethod,
      versionName: installed.versionName,
      versionCode: installed.versionCode,
      pending,
      status,
      busy,
      check: () => check(false),
      install,
    }),
    [busy, check, install, installed.versionCode, installed.versionName, method, pending, setMethod, status],
  );

  const note = pending?.notes ? pending.notes : "A newer panel app is published.";

  return (
    <UpdateContext.Provider value={value}>
      {children}
      <Modal visible={ask && !block} animationType="fade" transparent statusBarTranslucent supportedOrientations={["landscape", "landscape-left", "landscape-right"]} onRequestClose={() => setAsk(false)}>
        <View style={styles.scrim}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Update {pending?.versionName}</Text>
            <Text style={styles.cardBody}>{note}</Text>
            {status ? <Text style={styles.cardStatus}>{status}</Text> : null}
            <View style={styles.cardActions}>
              <Pressable style={styles.later} onPress={() => setAsk(false)} disabled={busy}>
                <Text style={styles.laterText}>Later</Text>
              </Pressable>
              <Pressable style={styles.install} onPress={() => void install()} disabled={busy}>
                {busy ? <ActivityIndicator color="white" /> : <Text style={styles.installText}>Install</Text>}
              </Pressable>
            </View>
            {failed ? (
              <Pressable onPress={allowInstalls}>
                <Text style={styles.allow}>Allow installs from this app</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>
      <Modal visible={block} animationType="fade" statusBarTranslucent supportedOrientations={["landscape", "landscape-left", "landscape-right"]} onRequestClose={() => undefined}>
        <View style={styles.force}>
          <Text style={styles.forceTitle}>Update required</Text>
          <Text style={styles.forceVersion}>{pending?.versionName}</Text>
          <Text style={styles.forceBody}>{note}</Text>
          {status ? <Text style={styles.forceStatus}>{status}</Text> : null}
          <Pressable style={styles.install} onPress={() => void install()} disabled={busy}>
            {busy ? <ActivityIndicator color="white" /> : <Text style={styles.installText}>Install</Text>}
          </Pressable>
          {failed ? (
            <Pressable onPress={allowInstalls}>
              <Text style={styles.allow}>Allow installs from this app</Text>
            </Pressable>
          ) : null}
        </View>
      </Modal>
    </UpdateContext.Provider>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(8,14,12,0.72)", alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: 460, backgroundColor: "#1b2420", borderRadius: 20, padding: 22, gap: 12 },
  cardTitle: { color: "white", fontSize: 24, fontWeight: "600" },
  cardBody: { color: "#d7e0da", fontSize: 16 },
  cardStatus: { color: "#9eaba4", fontSize: 14 },
  cardActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 4 },
  later: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.08)" },
  laterText: { color: "white", fontSize: 16 },
  install: { minWidth: 120, alignItems: "center", paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999, backgroundColor: "#0c6b52" },
  installText: { color: "white", fontSize: 16, fontWeight: "600" },
  allow: { color: "#8dceba", fontSize: 15, textAlign: "center" },
  force: { flex: 1, backgroundColor: "#101816", alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  forceTitle: { color: "#9eaba4", fontSize: 16, letterSpacing: 0.4 },
  forceVersion: { color: "white", fontSize: 36, fontWeight: "600" },
  forceBody: { color: "#d7e0da", fontSize: 18, textAlign: "center", maxWidth: 520 },
  forceStatus: { color: "#9eaba4", fontSize: 15 },
});
