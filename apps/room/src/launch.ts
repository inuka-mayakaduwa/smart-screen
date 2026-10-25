import * as IntentLauncher from "expo-intent-launcher";
import { Linking, Platform } from "react-native";
import type { MeetingProvider } from "./types";

const FLAG_ACTIVITY_NEW_TASK = 0x10000000;

const PACKAGES: Record<Exclude<MeetingProvider, "other">, string> = {
  meet: "com.google.android.apps.meetings",
  teams: "com.microsoft.teams",
};

export async function openMeeting(joinUrl: string | null, provider: MeetingProvider): Promise<void> {
  if (!joinUrl) throw new Error("This meeting has no join link");
  if (Platform.OS !== "android" || provider === "other") {
    await Linking.openURL(joinUrl);
    return;
  }
  try {
    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
      data: joinUrl,
      packageName: PACKAGES[provider],
      flags: FLAG_ACTIVITY_NEW_TASK,
    });
  } catch {
    throw new Error(provider === "meet" ? "Install Google Meet on this panel" : "Install Microsoft Teams on this panel");
  }
}

export async function openOemPackage(packageName: string): Promise<void> {
  if (Platform.OS !== "android") throw new Error("The panel share app opens on Android");
  try {
    await IntentLauncher.startActivityAsync("android.intent.action.MAIN", {
      category: "android.intent.category.LAUNCHER",
      packageName,
      flags: FLAG_ACTIVITY_NEW_TASK,
    });
  } catch {
    throw new Error(`Could not open ${packageName}. Install that share app on the panel.`);
  }
}
