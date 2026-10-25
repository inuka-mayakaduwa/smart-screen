export type MeetingProvider = "meet" | "teams" | "other";

export type MeetingPrivacyMode = "details" | "booked-by" | "busy";

export type MeetingSlotSettings = {
  mode: MeetingPrivacyMode;
  showTitle: boolean;
  showOrganizer: boolean;
  showMethod: boolean;
  showTime: boolean;
};

export type NowSlotSettings = MeetingSlotSettings & { joinInCard: boolean };

export type PanelDisplaySettings = {
  themeId: string;
  refreshSeconds: number;
  now: NowSlotSettings;
  next: MeetingSlotSettings;
};

export type Meeting = {
  id: string;
  title: string;
  organizer: string | null;
  start: string;
  end: string;
  provider: MeetingProvider;
  joinUrl: string | null;
  source: "google" | "microsoft";
};

export type RoomShare = {
  roomCode: boolean;
  oem: boolean;
  oemPackage: string | null;
  googleCast: boolean;
  miracast: boolean;
  airplay: boolean;
  codeRotateMinutes: number;
};

export type RoomBackgroundKind = "image" | "solid" | "gradient";

export type DisplayRoom = {
  id: string;
  name: string;
  timezone: string;
  meta: Record<string, string>;
  brandName: string | null;
  /** IT contact shown on the offline screen. */
  supportContact?: string | null;
  logoUrl: string | null;
  backgroundUrl: string | null;
  backgroundKind: RoomBackgroundKind;
  backgroundSolid: string;
  backgroundGradientFrom: string;
  backgroundGradientTo: string;
  scrimOpacity: number;
  images: { id: string; url: string; label: string }[];
};

export type DisplayState = {
  room: DisplayRoom;
  meetings: Meeting[];
  sources: { provider: string; accountLabel: string; status: string; error?: string }[];
  share: RoomShare;
  /** Share site host, for example meet.govtech.lk, for the idle screen before a code exists. */
  shareHost?: string;
  display: PanelDisplaySettings;
};

export type ShareSession = {
  sessionId: string;
  code: string;
  shareUrl: string;
  qrDataUrl: string;
  expiresAt: string;
  panelLanIp?: string | null;
  iceServers: { urls: string; username?: string; credential?: string }[];
};

export type PanelSession = {
  controlApiUrl: string;
  deviceToken: string;
};
