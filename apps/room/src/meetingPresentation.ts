import type { Meeting } from "./types";
import type { MeetingSlotSettings } from "./types";

export function meetingHeadline(meeting: Meeting, slot: MeetingSlotSettings): string {
  if (slot.mode === "busy") return "Busy";
  if (slot.mode === "booked-by") {
    if (slot.showOrganizer && meeting.organizer) return `Booked by ${meeting.organizer}`;
    return "Booked";
  }
  if (slot.showTitle) return meeting.title;
  if (slot.showOrganizer && meeting.organizer) return meeting.organizer;
  return "Meeting";
}

export function meetingSubtitle(meeting: Meeting, slot: MeetingSlotSettings): string | null {
  if (slot.mode === "busy" || slot.mode === "booked-by") return null;
  const parts: string[] = [];
  if (slot.showTitle && slot.showOrganizer && meeting.organizer) parts.push(meeting.organizer);
  if (slot.showMethod) parts.push(providerLabel(meeting.provider));
  return parts.length ? parts.join(" · ") : null;
}

export function providerLabel(provider: Meeting["provider"]) {
  if (provider === "meet") return "Google Meet";
  if (provider === "teams") return "Microsoft Teams";
  return "Meeting";
}
