import { useKeepAwake } from "expo-keep-awake";
import * as NavigationBar from "expo-navigation-bar";
import * as ScreenOrientation from "expo-screen-orientation";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { AppUpdateProvider } from "./src/appUpdate";
import { ConnectScreen } from "./src/ConnectScreen";
import { HomeScreen } from "./src/HomeScreen";
import { JoinScreen } from "./src/JoinScreen";
import { RoomCodeReceiver } from "./src/RoomCodeReceiver";
import { setDebugEnabled } from "./src/debugLog";
import { loadDebugMode, loadSession } from "./src/session";
import { ShareScreen } from "./src/ShareScreen";
import type { DisplayState, Meeting, PanelSession } from "./src/types";

type Route =
  | { name: "boot" }
  | { name: "connect" }
  | { name: "home" }
  | {
      name: "join";
      meeting: Meeting;
      timezone?: string;
      themeId?: string;
      brandName?: string | null;
      logoUrl?: string | null;
    }
  | { name: "share"; state: DisplayState }
  | { name: "receive" };

export default function App() {
  useKeepAwake();
  const [session, setSession] = useState<PanelSession | null>(null);
  const [notice, setNotice] = useState("");
  const [route, setRoute] = useState<Route>({ name: "boot" });

  useEffect(() => {
    NavigationBar.setVisibilityAsync("hidden").catch(() => undefined);
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => undefined);
    Promise.all([loadSession(), loadDebugMode()])
      .then(([stored, debug]) => {
        setDebugEnabled(debug);
        setSession(stored);
        setRoute(stored ? { name: "home" } : { name: "connect" });
      })
      .catch(() => setRoute({ name: "connect" }));
  }, []);

  const disconnect = useCallback((reason?: string) => {
    setNotice(reason || "This panel disconnected.");
    setSession(null);
    setRoute({ name: "connect" });
  }, []);

  const panel = (
    <>
      {route.name === "home" && session ? (
        <HomeScreen
          session={session}
          onDisconnected={disconnect}
          onJoin={(meeting, timezone, themeId, branding) =>
            setRoute({
              name: "join",
              meeting,
              timezone,
              themeId,
              brandName: branding?.brandName,
              logoUrl: branding?.logoUrl,
            })
          }
        />
      ) : null}
      {route.name === "join" ? (
        <JoinScreen
          meeting={route.meeting}
          timezone={route.timezone}
          themeId={route.themeId}
          brandName={route.brandName}
          logoUrl={route.logoUrl}
          onBack={() => setRoute({ name: "home" })}
        />
      ) : null}
      {route.name === "share" ? (
        <ShareScreen state={route.state} onBack={() => setRoute({ name: "home" })} onRoomCode={() => setRoute({ name: "receive" })} />
      ) : null}
      {route.name === "receive" && session ? <RoomCodeReceiver session={session} onClose={() => setRoute({ name: "home" })} /> : null}
    </>
  );

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      {route.name === "boot" ? <ActivityIndicator color="#8dceba" size="large" /> : null}
      {route.name === "connect" ? (
        <ConnectScreen
          notice={notice}
          onConnected={(next) => {
            setNotice("");
            setSession(next);
            setRoute({ name: "home" });
          }}
        />
      ) : null}
      {session ? <AppUpdateProvider session={session}>{panel}</AppUpdateProvider> : panel}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#14221c", justifyContent: "center" },
});
