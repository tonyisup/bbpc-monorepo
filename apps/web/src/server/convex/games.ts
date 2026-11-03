import { api } from "@tonyisup/bbpc-convex-api";
import { documentId } from "@tonyisup/bbpc-convex-api/contracts";
import "server-only";

import { z } from "zod";

import { fetchPublicQuery } from "@/server/convex/client";
import type {
  GamePerformanceData,
  PredictionScoring,
  StandingsSeason,
} from "@/types/game";

const predictionScoringSchema = z.object({
  correctHost: z.number().nullable(),
  allCorrectBonus: z.number().nullable(),
  allIncorrect: z.number().nullable(),
});

const seasonPerformanceSchema = z.object({
  season: z.object({
    id: z.string().min(1),
    title: z.string(),
    endedOn: z.string().nullable(),
    // Older backends omit these; a malformed value reads as none rather
    // than taking down the game page.
    episodeCount: z.number().int().positive().nullable().catch(null),
  }),
  recordedEpisodeCount: z.number().int().nonnegative().nullable().catch(null),
  userSummary: z.array(
    z.object({
      total: z.number(),
      user: z.object({
        id: z.string().min(1),
        name: z.string().nullable(),
      }),
    })
  ),
  points: z.array(
    z.object({
      userId: z.string().min(1),
      earnedAt: z.number(),
      pointValue: z.number(),
    })
  ),
});

const standingsSeasonSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  startedOn: z.string().nullable(),
  endedOn: z.string().nullable(),
  isCurrent: z.boolean(),
});

const predictionScoringQuery = api.games.public.predictionScoring;
const currentPerformanceQuery = api.games.public.currentPerformance;
const standingsSeasonsQuery = api.games.public.standingsSeasons;
const seasonStandingsQuery = api.games.public.seasonStandings;

export async function getConvexPredictionScoring(): Promise<PredictionScoring> {
  return predictionScoringSchema.parse(
    await fetchPublicQuery(predictionScoringQuery, {})
  );
}

function toPerformanceData(
  result: z.infer<typeof seasonPerformanceSchema>
): GamePerformanceData {
  return {
    season: result.season,
    recordedEpisodeCount: result.recordedEpisodeCount,
    userSummary: result.userSummary.map(({ total, user }) => ({
      id: user.id,
      name: user.name,
      total,
    })),
    points: result.points,
  };
}

export async function getConvexCurrentPerformance(
  today: string
): Promise<GamePerformanceData | null> {
  const result = seasonPerformanceSchema
    .nullable()
    .parse(await fetchPublicQuery(currentPerformanceQuery, { today }));
  return result === null ? null : toPerformanceData(result);
}

/** Seasons the public standings can show, newest first. */
export async function getConvexStandingsSeasons(
  today: string
): Promise<StandingsSeason[]> {
  return z
    .array(standingsSeasonSchema)
    .parse(await fetchPublicQuery(standingsSeasonsQuery, { today }));
}

/** One season's standings; null when the season is gone. */
export async function getConvexSeasonStandings(
  seasonId: string,
  today: string
): Promise<GamePerformanceData | null> {
  const result = seasonPerformanceSchema.nullable().parse(
    await fetchPublicQuery(seasonStandingsQuery, {
      seasonId: documentId("seasons", seasonId),
      today,
    })
  );
  return result === null ? null : toPerformanceData(result);
}
