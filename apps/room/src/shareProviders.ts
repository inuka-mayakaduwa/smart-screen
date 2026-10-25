import type { RoomShare } from "./types";

export type ShareProviderId = "room-code" | "oem" | "google-cast" | "miracast" | "airplay";

export type ShareAvailability = { ok: boolean; reason?: string };

export type ShareProvider = {
  id: ShareProviderId;
  label: string;
  available: () => Promise<ShareAvailability>;
};

const LATER = "The APK keeps this slot so a licensed receiver can be linked later.";

export function shareProviders(share: RoomShare): ShareProvider[] {
  const providers: ShareProvider[] = [];
  if (share.roomCode) {
    providers.push({
      id: "room-code",
      label: "Room code",
      available: async () => ({ ok: true }),
    });
  }
  if (share.oem) {
    providers.push({
      id: "oem",
      label: "Panel share app",
      available: async () =>
        share.oemPackage
          ? { ok: true }
          : { ok: false, reason: "Set the OEM package name in the control pane." },
    });
  }
  if (share.googleCast) {
    providers.push({
      id: "google-cast",
      label: "Google Cast",
      available: async () => ({
        ok: false,
        reason: `Google Cast needs a certified receiver. ${LATER}`,
      }),
    });
  }
  if (share.miracast) {
    providers.push({
      id: "miracast",
      label: "Miracast",
      available: async () => ({
        ok: false,
        reason: `Miracast needs system-signed Wi-Fi Display access, which a normal APK does not have. ${LATER}`,
      }),
    });
  }
  if (share.airplay) {
    providers.push({
      id: "airplay",
      label: "AirPlay",
      available: async () => ({
        ok: false,
        reason: `AirPlay needs a licensed receiver. ${LATER}`,
      }),
    });
  }
  return providers;
}
