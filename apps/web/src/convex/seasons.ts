"use client";

import { api } from "@tonyisup/bbpc-convex-api";
import { documentId } from "@tonyisup/bbpc-convex-api/contracts";

import type { ConvexReactClient } from "convex/react";

import { z } from "zod";

const seasonSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  startedOn: z.string().nullable(),
  endedOn: z.string().nullable(),
  // A malformed count reads as none rather than taking down the page.
  episodeCount: z.number().int().positive().nullable().catch(null),
});

const standingSchema = z
  .object({
    rank: z.number().int().positive(),
    playerCount: z.number().int().nonnegative(),
  })
  .nullable();

const seasonSummarySchema = z.object({
  season: seasonSchema,
  isCurrent: z.boolean(),
  total: z.number().finite(),
  pointCount: z.number().int().nonnegative(),
  available: z.number().finite().nullable(),
  recordedEpisodeCount: z.number().int().nonnegative().nullable(),
  standing: standingSchema,
});

const seasonOverviewSchema = z.object({
  season: seasonSchema,
  isCurrent: z.boolean(),
  total: z.number().finite(),
  pointCount: z.number().int().nonnegative(),
  available: z.number().finite(),
  recordedEpisodeCount: z.number().int().nonnegative().nullable(),
  standing: standingSchema,
  userSummary: z.array(
    z.object({
      total: z.number().finite(),
      user: z.object({
        id: z.string().min(1),
        name: z.string().nullable(),
      }),
    })
  ),
  points: z.array(
    z.object({
      userId: z.string().min(1),
      earnedAt: z.number().finite(),
      pointValue: z.number().finite(),
    })
  ),
});

const seasonEpisodeSchema = z.object({
  id: z.string().min(1),
  number: z.number(),
  title: z.string(),
  slug: z.string().nullable(),
});

const seasonAssignmentSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["HOMEWORK", "EXTRA_CREDIT", "BONUS"]),
  slug: z.string().nullable(),
  movie: z.object({
    id: z.string().min(1),
    title: z.string(),
    year: z.number(),
    poster: z.string().nullable(),
  }),
});

const seasonPointSchema = z.object({
  id: z.string().min(1),
  reason: z.string().nullable(),
  earnedAt: z.number().finite(),
  adjustment: z.number().finite().nullable(),
  total: z.number().finite(),
  gamePointType: z
    .object({
      title: z.string(),
      description: z.string().nullable(),
      points: z.number().finite(),
    })
    .nullable(),
  episode: seasonEpisodeSchema.nullable(),
  assignment: seasonAssignmentSchema.nullable(),
});

const seasonPointsPageSchema = z.object({
  page: z.array(seasonPointSchema),
  isDone: z.boolean(),
  continueCursor: z.string(),
});

const seasonWagerSchema = z.object({
  id: z.string().min(1),
  points: z.number().finite(),
  createdAt: z.number().finite(),
  status: z.enum(["pending", "locked", "won", "lost", "rejected"]),
  gamblingType: z.object({
    title: z.string(),
    multiplier: z.number(),
  }),
  assignment: z
    .object({
      id: z.string().min(1),
      slug: z.string().nullable(),
      movie: z.object({
        title: z.string(),
        year: z.number(),
        poster: z.string().nullable(),
      }),
      episode: seasonEpisodeSchema,
    })
    .nullable(),
  awardPoint: z.object({ total: z.number().finite() }).nullable(),
});

const mySeasonsReference = api.games.member.mySeasons;
const mySeasonOverviewReference = api.games.member.mySeasonOverview;
const mySeasonPointsPageReference = api.games.member.mySeasonPointsPage;
const mySeasonWagersReference = api.games.member.mySeasonWagers;

export const SEASON_POINTS_PAGE_SIZE = 20;

export type ConvexSeasonInfo = z.infer<typeof seasonSchema>;
export type ConvexSeasonStanding = z.infer<typeof standingSchema>;
export type ConvexSeasonSummary = z.infer<typeof seasonSummarySchema>;
export type ConvexSeasonPoint = z.infer<typeof seasonPointSchema>;
export type ConvexSeasonPointsPage = z.infer<typeof seasonPointsPageSchema>;
export type ConvexSeasonWager = z.infer<typeof seasonWagerSchema>;

export interface ConvexSeasonOverview {
  season: ConvexSeasonInfo;
  isCurrent: boolean;
  total: number;
  pointCount: number;
  available: number;
  recordedEpisodeCount: number | null;
  standing: ConvexSeasonStanding;
  /** Every scoring player, highest total first. */
  userSummary: Array<{ id: string; name: string | null; total: number }>;
  /** Every season point, oldest first. */
  points: Array<{ userId: string; earnedAt: number; pointValue: number }>;
}

export async function loadConvexSeasons(
  client: ConvexReactClient,
  today: string
): Promise<ConvexSeasonSummary[]> {
  return z
    .array(seasonSummarySchema)
    .parse(await client.query(mySeasonsReference, { today }));
}

export async function loadConvexSeasonOverview(
  client: ConvexReactClient,
  seasonId: string,
  today: string
): Promise<ConvexSeasonOverview> {
  const result = seasonOverviewSchema.parse(
    await client.query(mySeasonOverviewReference, {
      seasonId: documentId("seasons", seasonId),
      today,
    })
  );
  return {
    ...result,
    userSummary: result.userSummary.map(({ total, user }) => ({
      id: user.id,
      name: user.name,
      total,
    })),
  };
}

export async function loadConvexSeasonPointsPage(
  client: ConvexReactClient,
  seasonId: string,
  cursor: string | null
): Promise<ConvexSeasonPointsPage> {
  return seasonPointsPageSchema.parse(
    await client.query(mySeasonPointsPageReference, {
      seasonId: documentId("seasons", seasonId),
      paginationOpts: { numItems: SEASON_POINTS_PAGE_SIZE, cursor },
    })
  );
}

export async function loadConvexSeasonWagers(
  client: ConvexReactClient,
  seasonId: string
): Promise<ConvexSeasonWager[]> {
  return z.array(seasonWagerSchema).parse(
    await client.query(mySeasonWagersReference, {
      seasonId: documentId("seasons", seasonId),
    })
  );
}
