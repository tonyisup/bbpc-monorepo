import "server-only";

import { z } from "zod";

import { fetchPublicQuery, publicQueryReference } from "@/server/convex/client";
import type { GamePerformanceData, PredictionScoring } from "@/types/game";

const predictionScoringSchema = z.object({
  correctHost: z.number().nullable(),
  allCorrectBonus: z.number().nullable(),
  allIncorrect: z.number().nullable(),
});

const currentPerformanceSchema = z
  .object({
    season: z.object({
      id: z.string().min(1),
      title: z.string(),
      endedOn: z.string().nullable(),
    }),
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
  })
  .nullable();

const predictionScoringQuery = publicQueryReference<Record<string, never>>(
  "games/public:predictionScoring"
);
const currentPerformanceQuery = publicQueryReference<{
  today: string;
}>("games/public:currentPerformance");

export async function getConvexPredictionScoring(): Promise<PredictionScoring> {
  return predictionScoringSchema.parse(
    await fetchPublicQuery(predictionScoringQuery, {})
  );
}

export async function getConvexCurrentPerformance(
  today: string
): Promise<GamePerformanceData | null> {
  const result = currentPerformanceSchema.parse(
    await fetchPublicQuery(currentPerformanceQuery, { today })
  );
  if (result === null) {
    return null;
  }
  return {
    season: result.season,
    userSummary: result.userSummary.map(({ total, user }) => ({
      id: user.id,
      name: user.name,
      total,
    })),
    points: result.points,
  };
}
