"use client";

import { api } from "@tonyisup/bbpc-convex-api";

import { z } from "zod";

import { pacificPointDay } from "@/lib/pointDays";

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

/**
 * The Pacific day of the season's latest point stands in for the last episode,
 * as in the performance summary. Points are awarded while recording, and this
 * avoids resolving each point's episode on a query every page subscribes to.
 */
export function summarizeLatestPointChange(
  value: unknown
): LatestPointChange | null {
  const parsed = latestPointChangeSchema.safeParse(value);
  if (!parsed.success || parsed.data === null) {
    return null;
  }
  const { seasonId, lastScoredAt, points } = parsed.data;
  const day = pacificPointDay(lastScoredAt);
  const change = points
    .filter((point) => pacificPointDay(point.earnedAt) === day)
    .reduce((total, point) => total + point.pointValue, 0);
  return { key: `${seasonId}:${day}:${change}`, change };
}
