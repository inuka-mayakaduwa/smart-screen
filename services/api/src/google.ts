import type { Config } from "./config.js";
import { HttpError, postForm, readJson } from "./http.js";
import { dayBounds, meetingFromGoogle, type GoogleEvent } from "./meetings.js";
import type { CalendarConnection, Meeting } from "./types.js";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

export function googleConfigured(config: Config): boolean {
  return Boolean(config.googleClientId && config.googleClientSecret && config.googleRedirectUri);
}

export function googleAuthUrl(config: Config, state: string): string {
  if (!googleConfigured(config)) {
    throw new HttpError(400, "Google is not configured on the control API.");
  }
  const url = new URL(GOOGLE_AUTH);
  url.searchParams.set("client_id", config.googleClientId);
  url.searchParams.set("redirect_uri", config.googleRedirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("scope", CALENDAR_SCOPE);
  url.searchParams.set("state", state);
  return url.toString();
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
};

export async function exchangeGoogleCode(config: Config, code: string): Promise<TokenResponse> {
  return postForm(
    GOOGLE_TOKEN,
    new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: config.googleRedirectUri,
      grant_type: "authorization_code",
    }),
  ) as Promise<TokenResponse>;
}

export async function refreshGoogle(config: Config, refreshToken: string): Promise<TokenResponse> {
  return postForm(
    GOOGLE_TOKEN,
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      grant_type: "refresh_token",
    }),
  ) as Promise<TokenResponse>;
}

export async function googleAccountLabel(accessToken: string): Promise<string> {
  const calendar = await readJson<{ id?: string; summary?: string }>(
    await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList/primary", {
      headers: { authorization: `Bearer ${accessToken}` },
    }),
  );
  return calendar.summary || calendar.id || "Google Calendar";
}

export async function fetchGoogleMeetings(accessToken: string, timeZone: string, now = new Date()): Promise<Meeting[]> {
  const bounds = dayBounds(timeZone, now);
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", bounds.start.toISOString());
  url.searchParams.set("timeMax", bounds.end.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("conferenceDataVersion", "1");
  const body = await readJson<{ items?: GoogleEvent[] }>(
    await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } }),
  );
  return (body.items ?? []).flatMap((event) => {
    const meeting = meetingFromGoogle(event);
    return meeting ? [meeting] : [];
  });
}

export function applyToken(connection: CalendarConnection, token: TokenResponse) {
  connection.accessToken = token.access_token;
  if (token.refresh_token) connection.refreshToken = token.refresh_token;
  connection.expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
  if (token.scope) connection.scope = token.scope;
  connection.lastError = null;
}
