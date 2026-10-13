import assert from "node:assert/strict";
import test from "node:test";
import { classifyJoinUrl, dayBounds, meetingFromGoogle, meetingFromMicrosoft, mergeMeetings } from "./meetings.js";

test("classifies meet and teams links", () => {
  assert.equal(classifyJoinUrl("https://meet.google.com/abc-defg-hij"), "meet");
  assert.equal(classifyJoinUrl("https://teams.microsoft.com/l/meetup-join/19%3ameeting"), "teams");
  assert.equal(classifyJoinUrl(null, "teamsForBusiness"), "teams");
  assert.equal(classifyJoinUrl("https://example.com/call"), "other");
});

test("reads a Google Meet video entry point", () => {
  const meeting = meetingFromGoogle({
    id: "evt-1",
    summary: "Design review",
    start: { dateTime: "2026-10-13T09:00:00Z" },
    end: { dateTime: "2026-10-13T09:30:00Z" },
    conferenceData: {
      entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }],
    },
  });
  assert.equal(meeting?.provider, "meet");
  assert.equal(meeting?.joinUrl, "https://meet.google.com/abc-defg-hij");
  assert.equal(meeting?.title, "Design review");
});

test("organizer uses the display name, then the email", () => {
  const fromAttendee = meetingFromGoogle({
    id: "evt-2",
    start: { dateTime: "2026-10-13T09:00:00Z" },
    end: { dateTime: "2026-10-13T09:30:00Z" },
    organizer: { email: "priya@example.com", self: true },
    attendees: [{ email: "priya@example.com", displayName: "Priya Fernando", organizer: true }],
  });
  assert.equal(fromAttendee?.organizer, "Priya Fernando");
  const emailOnly = meetingFromGoogle({
    id: "evt-3",
    start: { dateTime: "2026-10-13T09:00:00Z" },
    end: { dateTime: "2026-10-13T09:30:00Z" },
    organizer: { email: "rooms@example.com" },
  });
  assert.equal(emailOnly?.organizer, "rooms@example.com");
  const teams = meetingFromMicrosoft({
    id: "m2",
    start: { dateTime: "2026-10-13T08:00:00", timeZone: "UTC" },
    end: { dateTime: "2026-10-13T08:15:00", timeZone: "UTC" },
    organizer: { emailAddress: { name: "Alex Silva", address: "alex@example.com" } },
  });
  assert.equal(teams?.organizer, "Alex Silva");
});

test("skips cancelled events and merges duplicates", () => {
  const google = meetingFromGoogle({
    id: "gone",
    status: "cancelled",
    start: { dateTime: "2026-10-13T09:00:00Z" },
    end: { dateTime: "2026-10-13T09:30:00Z" },
  });
  const teams = meetingFromMicrosoft({
    id: "m1",
    subject: "Standup",
    start: { dateTime: "2026-10-13T08:00:00.0000000", timeZone: "UTC" },
    end: { dateTime: "2026-10-13T08:15:00.0000000", timeZone: "UTC" },
    onlineMeetingProvider: "teamsForBusiness",
    onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/abc" },
  });
  assert.equal(google, null);
  const merged = mergeMeetings([[teams!], [teams!]]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.provider, "teams");
});

test("day bounds follow the room timezone", () => {
  const instant = new Date("2026-10-13T02:30:00Z");
  const colombo = dayBounds("Asia/Colombo", instant);
  assert.equal(colombo.start.toISOString(), "2026-10-12T18:30:00.000Z");
  assert.equal(colombo.end.toISOString(), "2026-10-13T18:30:00.000Z");
});
