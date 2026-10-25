import { Platform } from "react-native";
import { probeShareHardware, type PanelHardwareProbe } from "../modules/panel-hardware";

export type DebugLevel = "info" | "warn" | "error" | "network";

export type DebugLine = {
  at: string;
  level: DebugLevel;
  scope: string;
  message: string;
  detail?: string;
};

const MAX_LINES = 400;
const MAX_DETAIL = 1500;
const SECRET = /token|password|secret|authorization|cookie|credential|qrdataurl|dataurl/i;

let enabled = false;
const lines: DebugLine[] = [];
const listeners = new Set<() => void>();

export function setDebugEnabled(value: boolean) {
  const next = Boolean(value);
  if (next === enabled) return;
  enabled = next;
  push("debug", "info", next ? "Debug mode on" : "Debug mode off");
  if (next) {
    // Native context is often ready on the next tick after the app boots with debug already on.
    setTimeout(() => {
      if (enabled) logShareHardwareProbe();
    }, 0);
  }
}

export function isDebugEnabled() {
  return enabled;
}

export function getDebugLines(): DebugLine[] {
  return lines.slice();
}

export function clearDebugLines() {
  lines.length = 0;
  notify();
}

export function subscribeDebug(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function debug(scope: string, level: DebugLevel, message: string, detail?: unknown) {
  if (!enabled) return;
  push(scope, level, message, detail);
}

function logShareHardwareProbe() {
  if (Platform.OS !== "android") {
    push("hardware", "info", "Share hardware probe runs on Android panels only");
    return;
  }
  const probe = probeShareHardware();
  if (!probe) {
    push(
      "hardware",
      "warn",
      "Share hardware probe unavailable — rebuild the APK so the panel-hardware module is linked",
    );
    return;
  }
  if (!probe.features || Object.keys(probe.features).length === 0) {
    push("hardware", "info", "Share hardware probe waiting for Android context; retrying…");
    setTimeout(() => {
      if (!enabled) return;
      const again = probeShareHardware();
      if (again && again.features && Object.keys(again.features).length > 0) {
        push("hardware", "info", summarizeProbe(again), again);
      } else if (again) {
        push("hardware", "info", summarizeProbe(again), again);
      }
    }, 750);
    return;
  }
  push("hardware", "info", summarizeProbe(probe), probe);
}

function summarizeProbe(probe: PanelHardwareProbe): string {
  const features = probe.features || ({} as PanelHardwareProbe["features"]);
  const stacks = probe.stacks || ({} as PanelHardwareProbe["stacks"]);
  const cast = stacks.googleCast?.length ?? 0;
  const mira = stacks.miracast?.length ?? 0;
  const air = stacks.airplay?.length ?? 0;
  const mirror = stacks.mirroring?.length ?? 0;
  const wifiDirect = features.wifiDirect ? "wifi-direct=yes" : "wifi-direct=no";
  const gms = probe.playServices ? "play-services=yes" : "play-services=no";
  return (
    `${probe.manufacturer || "?"} ${probe.model || "?"} Android ${probe.release || "?"} · ` +
    `${wifiDirect} · ${gms} · cast=${cast} miracast=${mira} airplay=${air} mirroring=${mirror}`
  );
}

function push(scope: string, level: DebugLevel, message: string, detail?: unknown) {
  const line: DebugLine = {
    at: new Date().toISOString(),
    level,
    scope: scope.slice(0, 40),
    message: message.slice(0, 300),
  };
  if (detail !== undefined) line.detail = formatDetail(detail);
  lines.push(line);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  notify();
}

function notify() {
  for (const listener of listeners) listener();
}

function formatDetail(value: unknown): string {
  try {
    const text = JSON.stringify(redact(value));
    return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL)}…` : text;
  } catch {
    return String(value).slice(0, MAX_DETAIL);
  }
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET.test(key) ? "[redacted]" : redact(entry, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 400) return `${value.slice(0, 400)}…`;
  return value;
}
