import type { Config } from "./config.js";
import { applyToken, fetchGoogleMeetings, refreshGoogle } from "./google.js";
import { applyMicrosoftToken, fetchMicrosoftMeetings, refreshMicrosoft } from "./microsoft.js";
import { mergeMeetings } from "./meetings.js";
import type { Store } from "./store.js";
import type { CalendarConnection, Meeting, SourceStatus } from "./types.js";

export async function loadRoomMeetings(
  store: Store,
  config: Config,
  roomId: string,
  timeZone: string,
): Promise<{ meetings: Meeting[]; sources: SourceStatus[] }> {
  const connections = store.read().connections.filter((connection) => connection.roomId === roomId);
  const groups: Meeting[][] = [];
  const sources: SourceStatus[] = [];

  for (const connection of connections) {
    try {
      const accessToken = await ensureAccessToken(store, config, connection);
      const meetings =
        connection.provider === "google"
          ? await fetchGoogleMeetings(accessToken, timeZone)
          : await fetchMicrosoftMeetings(accessToken, timeZone);
      groups.push(meetings);
      sources.push({
        provider: connection.provider,
        accountLabel: connection.accountLabel,
        status: meetings.length ? "ok" : "empty",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Calendar request failed";
      store.update((data) => {
        const current = data.connections.find((item) => item.id === connection.id);
        if (current) current.lastError = message.slice(0, 500);
      });
      sources.push({
        provider: connection.provider,
        accountLabel: connection.accountLabel,
        status: "error",
        error: message.slice(0, 240),
      });
    }
  }

  return { meetings: mergeMeetings(groups), sources };
}

async function ensureAccessToken(store: Store, config: Config, connection: CalendarConnection): Promise<string> {
  if (new Date(connection.expiresAt).getTime() > Date.now() + 60_000) {
    return connection.accessToken;
  }
  if (!connection.refreshToken) {
    throw new Error(`${connection.accountLabel} needs to be connected again.`);
  }
  const token =
    connection.provider === "google"
      ? await refreshGoogle(config, connection.refreshToken)
      : await refreshMicrosoft(config, connection.refreshToken);
  store.update((data) => {
    const current = data.connections.find((item) => item.id === connection.id);
    if (!current) return;
    if (current.provider === "google") applyToken(current, token);
    else applyMicrosoftToken(current, token);
  });
  return token.access_token;
}
