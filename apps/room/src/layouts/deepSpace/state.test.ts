import assert from "node:assert/strict";
import test from "node:test";
import type { Meeting } from "../../types";
import { deriveScreen, minutesSince, minutesUntil } from "./state";

const NOW = Date.parse("2026-10-25T10:00:00.000Z");
const MIN = 60_000;

function meeting(startOffsetMin: number, lengthMin = 60, id = "m1"): Meeting {
  return {
    id,
    title: "Quarterly digital services review",
    organizer: "Nadeesha Fernando",
    start: new Date(NOW + startOffsetMin * MIN).toISOString(),
    end: new Date(NOW + (startOffsetMin + lengthMin) * MIN).toISOString(),
    provider: "meet",
    joinUrl: "https://meet.google.com/abc-defg-hij",
    source: "google",
  };
}

test("idle when nothing starts within 15 minutes, and the footer shows the next booking", () => {
  const next = meeting(90);
  const model = deriveScreen({ meetings: [next], nowMs: NOW });
  assert.equal(model.state, "idle");
  assert.equal(model.meeting, null);
  assert.equal(model.nextBooking, next);
  assert.equal(model.statusLabel, "This room is free");
  assert.equal(model.ripple, false);
});

test("upcoming inside the 15 minute lead, counting down whole minutes", () => {
  const model = deriveScreen({ meetings: [meeting(10)], nowMs: NOW });
  assert.equal(model.state, "upcoming");
  assert.equal(model.meetingIsCurrent, false);
  assert.equal(model.statusLabel, "Next meeting, starts in 10 min");
  assert.equal(deriveScreen({ meetings: [meeting(15)], nowMs: NOW }).state, "upcoming");
  assert.equal(deriveScreen({ meetings: [meeting(16)], nowMs: NOW }).state, "idle");
});

test("starting for the first minute, then live with minutes since start", () => {
  const starting = deriveScreen({ meetings: [meeting(-0.5)], nowMs: NOW });
  assert.equal(starting.state, "starting");
  assert.equal(starting.ripple, true);
  assert.equal(starting.statusLabel, "Starting now");
  const live = deriveScreen({ meetings: [meeting(-12)], nowMs: NOW });
  assert.equal(live.state, "live");
  assert.equal(live.meetingIsCurrent, true);
  assert.equal(live.statusLabel, "In progress, started 12 min ago");
});

test("live meeting ending with the next one within 15 minutes still shows the current meeting", () => {
  const current = meeting(-50, 60, "a");
  const next = meeting(12, 60, "b");
  const model = deriveScreen({ meetings: [current, next], nowMs: NOW });
  assert.equal(model.state, "live");
  assert.equal(model.meeting?.id, "a");
  assert.equal(model.nextBooking?.id, "b");
});

test("joining and error describe the meeting being joined and take precedence over the clock", () => {
  const live = meeting(-5);
  const joining = deriveScreen({ meetings: [live], nowMs: NOW, joining: live });
  assert.equal(joining.state, "joining");
  assert.equal(joining.meeting, live);
  assert.equal(joining.meetingIsCurrent, true);
  const upcoming = meeting(8, 60, "n");
  const error = deriveScreen({ meetings: [upcoming], nowMs: NOW, error: upcoming });
  assert.equal(error.state, "error");
  assert.equal(error.meetingIsCurrent, false);
  assert.equal(error.statusLabel, "Couldn’t join the meeting");
});

test("offline wins over everything", () => {
  const live = meeting(-5);
  const model = deriveScreen({ meetings: [live], nowMs: NOW, offline: true, joining: live });
  assert.equal(model.state, "offline");
  assert.equal(model.meeting, null);
  assert.equal(model.dot, "#FBBF24");
});

test("minute helpers round the way the status copy expects", () => {
  assert.equal(minutesUntil(new Date(NOW + 9.2 * MIN).toISOString(), NOW), 10);
  assert.equal(minutesSince(new Date(NOW - 0.2 * MIN).toISOString(), NOW), 1);
  assert.equal(minutesSince(new Date(NOW - 12.9 * MIN).toISOString(), NOW), 12);
});
