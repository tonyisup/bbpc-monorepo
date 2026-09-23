"use client";

import { api } from "@tonyisup/bbpc-convex-api";

import { z } from "zod";

const latestPointChangeSchema = z
  .object({
    seasonId: z.string().min(1),
    lastScoredAt: z.number(),
    points: z.array(
      z.object({
        earnedAt: z.number(),
        pointValue: z.number(),
      })
    ),
  })
  .nullable();

export const latestPointChangeReference =
  api.games.member.myLatestPointChange;

export interface LatestPointChange {
  /** Identifies this change so a seen badge stays hidden until it changes. */
  key: string;
  change: number;
}

const pacificDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Points are not linked to episodes, so the Pacific day of the season's latest
 * point stands in for the last episode, as in the performance summary.
 */
export function summarizeLatestPointChange(
  value: unknown
): LatestPointChange | null {
  const parsed = latestPointChangeSchema.safeParse(value);
  if (!parsed.success || parsed.data === null) {
    return null;
  }
  const { seasonId, lastScoredAt, points } = parsed.data;
  const day = pacificDayFormatter.format(lastScoredAt);
  const change = points
    .filter((point) => pacificDayFormatter.format(point.earnedAt) === day)
    .reduce((total, point) => total + point.pointValue, 0);
  return { key: `${seasonId}:${day}:${change}`, change };
}
