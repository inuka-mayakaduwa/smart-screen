import type { CalendarProvider, Meeting, MeetingProvider } from "./types.js";

export type GoogleEvent = {
  id?: string;
  status?: string;
  summary?: string;
  organizer?: { email?: string; displayName?: string; self?: boolean };
  creator?: { email?: string; displayName?: string };
  attendees?: { email?: string; displayName?: string; organizer?: boolean }[];
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  conferenceData?: {
    entryPoints?: { entryPointType?: string; uri?: string }[];
  };
};

export type MicrosoftEvent = {
  id?: string;
  subject?: string;
  organizer?: { emailAddress?: { name?: string; address?: string } };
  isCancelled?: boolean;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  onlineMeetingProvider?: string;
  onlineMeeting?: { joinUrl?: string } | null;
  webLink?: string;
};

export function dayBounds(timeZone: string, now = new Date()): { start: Date; end: Date } {
  const parts = zonedParts(now, timeZone);
  const start = zonedTimeToUtc(parts.year, parts.month, parts.day, 0, 0, 0, timeZone);
  const next = addDays(parts.year, parts.month, parts.day, 1);
  const end = zonedTimeToUtc(next.year, next.month, next.day, 0, 0, 0, timeZone);
  return { start, end };
}

export function classifyJoinUrl(url: string | null, hint?: string): MeetingProvider {
  if (hint === "teamsForBusiness") return "teams";
  if (!url) return "other";
  const value = url.toLowerCase();
  if (value.includes("meet.google.com")) return "meet";
  if (value.includes("teams.microsoft.com") || value.includes("teams.live.com")) return "teams";
  return "other";
}

export function meetingFromGoogle(event: GoogleEvent): Meeting | null {
  if (!event.id || event.status === "cancelled") return null;
  const start = event.start?.dateTime ?? event.start?.date;
  const end = event.end?.dateTime ?? event.end?.date;
  if (!start || !end) return null;
  const video = event.conferenceData?.entryPoints?.find((point) => point.entryPointType === "video");
  const joinUrl = video?.uri || event.hangoutLink || null;
  return {
    id: `google:${event.id}`,
    title: event.summary?.trim() || "Untitled meeting",
    organizer: googleOrganizer(event),
    start: toIso(start),
    end: toIso(end),
    provider: classifyJoinUrl(joinUrl),
    joinUrl,
    source: "google",
  };
}

export function meetingFromMicrosoft(event: MicrosoftEvent): Meeting | null {
  if (!event.id || event.isCancelled) return null;
  if (!event.start?.dateTime || !event.end?.dateTime) return null;
  const joinUrl = event.onlineMeeting?.joinUrl || null;
  return {
    id: `microsoft:${event.id}`,
    title: event.subject?.trim() || "Untitled meeting",
    organizer: organizerLabel(event.organizer?.emailAddress?.name, event.organizer?.emailAddress?.address),
    start: graphDateToIso(event.start.dateTime, event.start.timeZone),
    end: graphDateToIso(event.end.dateTime, event.end.timeZone),
    provider: classifyJoinUrl(joinUrl, event.onlineMeetingProvider),
    joinUrl,
    source: "microsoft",
  };
}

export function mergeMeetings(groups: Meeting[][]): Meeting[] {
  const seen = new Set<string>();
  const merged: Meeting[] = [];
  for (const meeting of groups.flat()) {
    const key = `${meeting.joinUrl ?? meeting.id}|${meeting.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(meeting);
  }
  merged.sort((a, b) => a.start.localeCompare(b.start));
  return merged;
}

export function providerLabel(provider: CalendarProvider): string {
  return provider === "google" ? "Google" : "Microsoft";
}

function googleOrganizer(event: GoogleEvent): string | null {
  const email = event.organizer?.email?.toLowerCase();
  const sameEmail = (other?: string) => Boolean(email && other && other.toLowerCase() === email);
  const attendee = event.attendees?.find((item) => item.organizer || sameEmail(item.email));
  const creatorName = sameEmail(event.creator?.email) ? event.creator?.displayName : undefined;
  const name = event.organizer?.displayName || attendee?.displayName || creatorName;
  return organizerLabel(name, event.organizer?.email);
}

function organizerLabel(name?: string, email?: string): string | null {
  const label = name?.trim() || email?.trim() || "";
  return label || null;
}

function toIso(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00.000Z`;
  return new Date(value).toISOString();
}

function graphDateToIso(dateTime: string, timeZone?: string): string {
  if (dateTime.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(dateTime)) {
    return new Date(dateTime).toISOString();
  }
  if (!timeZone || timeZone === "UTC") return new Date(`${dateTime}Z`).toISOString();
  return zonedTimeToUtcFromParts(dateTime, timeZone).toISOString();
}

function zonedTimeToUtcFromParts(dateTime: string, timeZone: string): Date {
  const [datePart, timePart] = dateTime.split("T");
  const [year, month, day] = datePart!.split("-").map(Number);
  const [hour, minute, second] = (timePart ?? "00:00:00").split(":").map((part) => Number(part));
  return zonedTimeToUtc(year!, month!, day!, hour!, minute!, Math.floor(second ?? 0), timeZone);
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  let utc = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 3; i += 1) {
    utc = Date.UTC(year, month - 1, day, hour, minute, second) - timeZoneOffsetMs(new Date(utc), timeZone);
  }
  return new Date(utc);
}

function addDays(year: number, month: number, day: number, days: number) {
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}
