// The seven-state model for the waiting screen, derived from today's meetings and the clock.
// Pure functions only, so this file is unit tested in Node without React Native.
import type { Meeting } from "../../types";
import { color } from "./palette";

export type ScreenState = "idle" | "upcoming" | "starting" | "live" | "joining" | "error" | "offline";

export const states: Record<ScreenState, { status: string; dot: string; ripple: boolean }> = {
  idle: { status: "This room is free", dot: color.status.free, ripple: false },
  upcoming: { status: "Next meeting, starts in {mins} min", dot: color.status.neutral, ripple: false },
  starting: { status: "Starting now", dot: color.status.starting, ripple: true },
  live: { status: "In progress, started {mins} min ago", dot: color.status.live, ripple: true },
  joining: { status: "Connecting this room", dot: color.status.neutral, ripple: false },
  error: { status: "Couldn’t join the meeting", dot: color.status.error, ripple: false },
  offline: { status: "No network connection", dot: color.status.offline, ripple: false },
};

export const timing = {
  upcomingLeadMin: 15,
  startingToLiveMin: 1,
  joinTimeoutSec: 20,
  errorIdleReturnSec: 60,
  offlineAfterSec: 10,
} as const;

export type ScreenInput = {
  meetings: Meeting[];
  nowMs: number;
  offline?: boolean;
  /** The meeting a Join press is connecting to. */
  joining?: Meeting | null;
  /** The meeting whose join attempt failed. */
  error?: Meeting | null;
  upcomingLeadMin?: number;
  startingToLiveMin?: number;
};

export type ScreenModel = {
  state: ScreenState;
  /** The meeting the title and detail blocks describe, when there is one. */
  meeting: Meeting | null;
  /** True when `meeting` is happening now (use the Now privacy slot), false when it is the next one. */
  meetingIsCurrent: boolean;
  /** The booking shown in the idle footer. */
  nextBooking: Meeting | null;
  minutes: number;
  statusLabel: string;
  dot: string;
  ripple: boolean;
};

export function currentMeeting(meetings: Meeting[], nowMs: number): Meeting | null {
  return meetings.find((meeting) => Date.parse(meeting.start) <= nowMs && Date.parse(meeting.end) > nowMs) ?? null;
}

export function nextMeeting(meetings: Meeting[], nowMs: number): Meeting | null {
  const later = meetings.filter((meeting) => Date.parse(meeting.start) > nowMs);
  later.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return later[0] ?? null;
}

export function minutesUntil(iso: string, nowMs: number): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - nowMs) / 60_000));
}

export function minutesSince(iso: string, nowMs: number): number {
  return Math.max(1, Math.floor((nowMs - Date.parse(iso)) / 60_000));
}

export function statusLabelFor(state: ScreenState, minutes: number): string {
  return states[state].status.replace("{mins}", String(minutes));
}

export function deriveScreen(input: ScreenInput): ScreenModel {
  const { meetings, nowMs } = input;
  const lead = (input.upcomingLeadMin ?? timing.upcomingLeadMin) * 60_000;
  const startingWindow = (input.startingToLiveMin ?? timing.startingToLiveMin) * 60_000;
  const current = currentMeeting(meetings, nowMs);
  const next = nextMeeting(meetings, nowMs);

  if (input.offline) return build("offline", null, false, next, 0);
  if (input.joining) return build("joining", input.joining, input.joining.id === current?.id, next, 0);
  if (input.error) return build("error", input.error, input.error.id === current?.id, next, 0);
  if (current) {
    const since = nowMs - Date.parse(current.start);
    if (since < startingWindow) return build("starting", current, true, next, 0);
    return build("live", current, true, next, minutesSince(current.start, nowMs));
  }
  if (next && Date.parse(next.start) - nowMs <= lead) {
    return build("upcoming", next, false, next, minutesUntil(next.start, nowMs));
  }
  return build("idle", null, false, next, 0);
}

function build(state: ScreenState, meeting: Meeting | null, meetingIsCurrent: boolean, nextBooking: Meeting | null, minutes: number): ScreenModel {
  return {
    state,
    meeting,
    meetingIsCurrent,
    nextBooking,
    minutes,
    statusLabel: statusLabelFor(state, minutes),
    dot: states[state].dot,
    ripple: states[state].ripple,
  };
}
