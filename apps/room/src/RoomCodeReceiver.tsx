import { useEffect, useMemo, useRef, useState } from "react";
import * as Network from "expo-network";
import { Animated, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { createShareSession } from "./api";
import { debug, isDebugEnabled } from "./debugLog";
import { lanAddress, lanIpInjection, receiverDocument } from "./receiverDocument";
import type { PanelSession, ShareSession } from "./types";

export function RoomCodeReceiver({
  session,
  onClose,
}: {
  session: PanelSession;
  onClose: () => void;
}) {
  const [share, setShare] = useState<ShareSession | null>(null);
  const [status, setStatus] = useState("Opening a room code…");
  const [showing, setShowing] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const webRef = useRef<WebView>(null);
  const lanIpRef = useRef("");
  const receiverSource = useMemo(
    () => (share ? { html: receiverDocument(share, session, lanIpRef.current), baseUrl: session.controlApiUrl } : null),
    [share, session],
  );

  useEffect(() => {
    let cancelled = false;
    Network.getIpAddressAsync()
      .then((ip) => {
        const address = lanAddress(ip);
        if (cancelled || !address) return;
        lanIpRef.current = address;
        webRef.current?.injectJavaScript(lanIpInjection(address));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(clock);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let refresh: ReturnType<typeof setTimeout> | undefined;

    async function openShare() {
      try {
        const created = await createShareSession(session.controlApiUrl, session.deviceToken);
        if (cancelled) return;
        setShare(created);
        setShowing(false);
        setStatus("Waiting for a laptop to open this code");
        const wait = Math.max(1000, new Date(created.expiresAt).getTime() - Date.now());
        refresh = setTimeout(openShare, wait);
      } catch (error) {
        if (cancelled) return;
        setStatus(error instanceof Error ? error.message : "Share code is unavailable");
        refresh = setTimeout(openShare, 15_000);
      }
    }

    openShare();
    return () => {
      cancelled = true;
      clearTimeout(refresh);
    };
  }, [session.controlApiUrl, session.deviceToken]);

  function onMessage(event: WebViewMessageEvent) {
    try {
      const message = JSON.parse(event.nativeEvent.data) as { type?: string; text?: string };
      if (message.type === "status" && message.text) setStatus(message.text);
      if (message.type === "video") setShowing(true);
      if (message.type === "idle") setShowing(false);
      if (message.type === "log" && message.text) {
        debug("share", "network", message.text);
        if (__DEV__) console.log(message.text);
      }
      if (message.type === "meter" && message.text) debug("share", "info", message.text);
    } catch {
      setStatus("The receiver sent a message the panel could not read");
    }
  }

  return (
    <View style={styles.screen}>
      {share && receiverSource ? (
        <WebView
          ref={webRef}
          key={share.code}
          style={styles.web}
          originWhitelist={["*"]}
          source={receiverSource}
          javaScriptEnabled
          domStorageEnabled
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          androidLayerType="hardware"
          setSupportMultipleWindows={false}
          webviewDebuggingEnabled={__DEV__}
          onLoadEnd={() => {
            const debugOn = isDebugEnabled();
            const lan = lanIpRef.current ? lanIpInjection(lanIpRef.current) : "true;";
            webRef.current?.injectJavaScript(
              `window.setDebug && window.setDebug(${debugOn ? "true" : "false"}); window.setSoundInset && window.setSoundInset(${JSON.stringify({ right: 22, bottom: 168 })}); ${lan}`,
            );
          }}
          onMessage={onMessage}
          onError={() => setStatus("The receiver view failed to open")}
        />
      ) : null}
      <View style={styles.top} pointerEvents="box-none">
        <Pressable onPress={onClose} style={styles.back}>
          <Text style={styles.backText}>Close</Text>
        </Pressable>
        {showing ? null : <Text style={styles.status}>{status}</Text>}
      </View>
      {share ? (
        <CodeCard
          share={share}
          showing={showing}
          expiring={new Date(share.expiresAt).getTime() - now.getTime() <= 10_000}
        />
      ) : null}
    </View>
  );
}

function CodeCard({ share, showing, expiring }: { share: ShareSession; showing: boolean; expiring: boolean }) {
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

  return (
    <View style={showing ? styles.codeCard : styles.codeBlock} pointerEvents="none">
      {expiring && !showing ? <Text style={styles.url}>Rotating</Text> : null}
      <Animated.Text style={[showing ? styles.codeSmall : styles.code, expiring && { opacity: fade }]}>
        {share.code.replace(/\D/g, "").slice(0, 5)}
      </Animated.Text>
      <Text style={showing ? styles.urlSmall : styles.url}>
        {share.shareUrl.replace(/\/(\d{2})-(\d{3})(?=\/?$)/, "/$1$2").replace(/^https?:\/\//, "")}
      </Text>
      {showing ? null : <Image source={{ uri: share.qrDataUrl }} style={styles.qr} />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#101410" },
  web: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "#101410" },
  top: {
    position: "absolute",
    top: 24,
    left: 24,
    right: 24,
    zIndex: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  back: { backgroundColor: "rgba(255,255,255,0.14)", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
  backText: { color: "white", fontSize: 16 },
  status: { color: "white", fontSize: 18, flex: 1 },
  codeBlock: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 48 },
  codeCard: {
    position: "absolute",
    right: 24,
    bottom: 24,
    maxWidth: 320,
    backgroundColor: "rgba(20, 24, 22, 0.82)",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  code: { color: "white", fontSize: 64, letterSpacing: 8, fontWeight: "600" },
  codeSmall: { color: "white", fontSize: 18, letterSpacing: 2, fontWeight: "600" },
  url: { color: "#d7e0da", fontSize: 16, marginTop: 6 },
  urlSmall: { color: "#d7e0da", fontSize: 12, marginTop: 2 },
  qr: { width: 180, height: 180, backgroundColor: "white", borderRadius: 16, marginTop: 8 },
});
