import type { Config } from "./config.js";
import { HttpError, postForm, readJson } from "./http.js";
import { dayBounds, meetingFromMicrosoft, type MicrosoftEvent } from "./meetings.js";
import type { CalendarConnection, Meeting } from "./types.js";

const AUTH = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const SCOPE = "offline_access Calendars.Read User.Read";

export function microsoftConfigured(config: Config): boolean {
  return Boolean(config.microsoftClientId && config.microsoftClientSecret && config.microsoftRedirectUri);
}

export function microsoftAuthUrl(config: Config, state: string): string {
  if (!microsoftConfigured(config)) {
    throw new HttpError(400, "Microsoft is not configured on the control API.");
  }
  const url = new URL(AUTH);
  url.searchParams.set("client_id", config.microsoftClientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.microsoftRedirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", state);
  return url.toString();
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
};

export async function exchangeMicrosoftCode(config: Config, code: string): Promise<TokenResponse> {
  return postForm(
    TOKEN,
    new URLSearchParams({
      client_id: config.microsoftClientId,
      client_secret: config.microsoftClientSecret,
      redirect_uri: config.microsoftRedirectUri,
      code,
      grant_type: "authorization_code",
      scope: SCOPE,
    }),
  ) as Promise<TokenResponse>;
}

export async function refreshMicrosoft(config: Config, refreshToken: string): Promise<TokenResponse> {
  return postForm(
    TOKEN,
    new URLSearchParams({
      client_id: config.microsoftClientId,
      client_secret: config.microsoftClientSecret,
      redirect_uri: config.microsoftRedirectUri,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: SCOPE,
    }),
  ) as Promise<TokenResponse>;
}

export async function microsoftAccountLabel(accessToken: string): Promise<string> {
  const me = await readJson<{ displayName?: string; mail?: string; userPrincipalName?: string }>(
    await fetch("https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName", {
      headers: { authorization: `Bearer ${accessToken}` },
    }),
  );
  return me.mail || me.userPrincipalName || me.displayName || "Microsoft 365";
}

export async function fetchMicrosoftMeetings(accessToken: string, timeZone: string, now = new Date()): Promise<Meeting[]> {
  const bounds = dayBounds(timeZone, now);
  const url = new URL("https://graph.microsoft.com/v1.0/me/calendarView");
  url.searchParams.set("startDateTime", bounds.start.toISOString());
  url.searchParams.set("endDateTime", bounds.end.toISOString());
  url.searchParams.set(
    "$select",
    "subject,start,end,isCancelled,onlineMeeting,onlineMeetingProvider,webLink,organizer",
  );
  const body = await readJson<{ value?: MicrosoftEvent[] }>(
    await fetch(url, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        prefer: 'outlook.timezone="UTC"',
      },
    }),
  );
  return (body.value ?? []).flatMap((event) => {
    const meeting = meetingFromMicrosoft(event);
    return meeting ? [meeting] : [];
  });
}

export function applyMicrosoftToken(connection: CalendarConnection, token: TokenResponse) {
  connection.accessToken = token.access_token;
  if (token.refresh_token) connection.refreshToken = token.refresh_token;
  connection.expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
  if (token.scope) connection.scope = token.scope;
  connection.lastError = null;
}
