import * as SecureStore from "expo-secure-store";
import type { PanelSession } from "./types";

const URL_KEY = "controlApiUrl";
const TOKEN_KEY = "deviceToken";
const UPDATE_METHOD_KEY = "updateMethod";
const DEBUG_KEY = "debugMode";

export type UpdateMethod = "manual" | "prompt" | "force";

export async function loadUpdateMethod(): Promise<UpdateMethod> {
  const value = await SecureStore.getItemAsync(UPDATE_METHOD_KEY);
  if (value === "manual" || value === "prompt" || value === "force") return value;
  return "prompt";
}

export async function saveUpdateMethod(method: UpdateMethod): Promise<void> {
  await SecureStore.setItemAsync(UPDATE_METHOD_KEY, method);
}

export async function loadDebugMode(): Promise<boolean> {
  return (await SecureStore.getItemAsync(DEBUG_KEY)) === "1";
}

export async function saveDebugMode(on: boolean): Promise<void> {
  if (on) await SecureStore.setItemAsync(DEBUG_KEY, "1");
  else await SecureStore.deleteItemAsync(DEBUG_KEY);
}

export async function loadSession(): Promise<PanelSession | null> {
  const controlApiUrl = await SecureStore.getItemAsync(URL_KEY);
  const deviceToken = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!controlApiUrl || !deviceToken) return null;
  return { controlApiUrl, deviceToken };
}

export async function saveSession(session: PanelSession): Promise<void> {
  await SecureStore.setItemAsync(URL_KEY, session.controlApiUrl);
  await SecureStore.setItemAsync(TOKEN_KEY, session.deviceToken);
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(URL_KEY);
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export function normalizeServerUrl(value: string): string {
  const trimmed = value.trim().replace(/\/$/, "");
  if (!trimmed) throw new Error("Enter the control server address");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(withScheme);
  if (!isLocalHost(url.hostname)) url.protocol = "https:";
  return url.toString().replace(/\/$/, "");
}

function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  const match = /^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (!match) return false;
  const second = Number(match[1]);
  return second >= 16 && second <= 31;
}
