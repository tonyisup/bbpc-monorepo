"use client";

import { api } from "@tonyisup/bbpc-convex-api";

import { z } from "zod";

const ANNOUNCEMENT_CLOCK_MS = 60 * 1000;

const liveAnnouncementSchema = z.object({
  id: z.string().min(1),
  message: z.string(),
  severity: z.enum(["info", "warning"]),
  startsAt: z.number(),
  endsAt: z.number(),
  linkUrl: z.string().nullable(),
  linkLabel: z.string().nullable(),
  dismissible: z.boolean(),
  updatedAt: z.number(),
});

export const liveAnnouncementsReference = api.announcements.public.listLive;

export type ConvexLiveAnnouncement = z.infer<typeof liveAnnouncementSchema>;

// Every visitor in the same minute asks for the same `now`, so they share one
// cached, reactive query result.
export function getAnnouncementClockNow(time: number): number {
  return Math.floor(time / ANNOUNCEMENT_CLOCK_MS) * ANNOUNCEMENT_CLOCK_MS;
}

export function getNextAnnouncementClockDelay(time: number): number {
  return getAnnouncementClockNow(time) + ANNOUNCEMENT_CLOCK_MS - time;
}

export function parseLiveAnnouncements(
  value: unknown
): ConvexLiveAnnouncement[] {
  const parsed = z.array(liveAnnouncementSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}
