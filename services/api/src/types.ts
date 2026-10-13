import type { PanelDisplaySettings } from "./display.js";

export type ShareProviderId = "room-code" | "oem" | "google-cast" | "miracast" | "airplay";

export type MeetingProvider = "meet" | "teams" | "other";

export type RoomStatus = "active" | "retired";

export type RoomShare = {
  roomCode: boolean;
  oem: boolean;
  oemPackage: string | null;
  googleCast: boolean;
  miracast: boolean;
  airplay: boolean;
  codeRotateMinutes: number;
};

export type Room = {
  id: string;
  name: string;
  timezone: string;
  meta: Record<string, string>;
  backgroundImageId: string | null;
  status: RoomStatus;
  share: RoomShare;
  displayOverrides: Partial<PanelDisplaySettings> | null;
  createdAt: string;
  updatedAt: string;
};

export type RoomImage = {
  id: string;
  roomId: string;
  filename: string;
  mimeType: string;
  label: string;
  createdAt: string;
};

export type CalendarProvider = "google" | "microsoft";

export type CalendarConnection = {
  id: string;
  roomId: string;
  provider: CalendarProvider;
  accountLabel: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  scope: string;
  lastError: string | null;
  createdAt: string;
};

export type ConnectToken = {
  id: string;
  roomId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
};

export type Device = {
  id: string;
  roomId: string;
  tokenHash: string;
  label: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

export type OAuthState = {
  id: string;
  roomId: string;
  provider: CalendarProvider;
  expiresAt: string;
};

export type DataFile = {
  rooms: Room[];
  images: RoomImage[];
  connections: CalendarConnection[];
  connectTokens: ConnectToken[];
  devices: Device[];
  oauthStates: OAuthState[];
  displayDefaults: PanelDisplaySettings;
};

export type Meeting = {
  id: string;
  title: string;
  organizer: string | null;
  start: string;
  end: string;
  provider: MeetingProvider;
  joinUrl: string | null;
  source: CalendarProvider;
};

export type SourceStatus = {
  provider: CalendarProvider;
  accountLabel: string;
  status: "ok" | "error" | "empty";
  error?: string;
};
