"use client";

import type { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "@/convex/identity";
import { getPacificTodayPlainDate } from "@/lib/dates";

const hostSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  image: z.string().nullable(),
});

const ratingSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  value: z.number(),
  category: z.string().nullable(),
  icon: z.string().nullable(),
  sound: z.string().nullable(),
});

const predictionScoringSchema = z.object({
  correctHost: z.number().nullable(),
  allCorrectBonus: z.number().nullable(),
  allIncorrect: z.number().nullable(),
});

const guessSchema = z.object({
  id: z.string().min(1),
  rating: ratingSchema,
  assignmentReview: z.object({
    review: z.object({
      user: hostSchema,
    }),
  }),
});

const assignmentGuessGroupSchema = z.object({
  assignmentId: z.string().min(1),
  guesses: z.array(guessSchema),
});

const listHostsReference = makeFunctionReference<
  "query",
  Record<string, never>,
  unknown
>("identity/public:listHosts");

const listRatingsReference = makeFunctionReference<
  "query",
  Record<string, never>,
  unknown
>("ratings/public:list");

const hasActiveSeasonReference = makeFunctionReference<
  "query",
  { today: string },
  unknown
>("games/public:hasActiveSeason");

const predictionScoringReference = makeFunctionReference<
  "query",
  Record<string, never>,
  unknown
>("games/public:predictionScoring");

const mineForAssignmentsReference = makeFunctionReference<
  "query",
  { assignmentIds: string[] },
  unknown
>("games/guesses:mineForAssignments");

const submitGuessReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    assignmentId: string;
    hostId: string;
    ratingId: string;
    today: string;
  },
  unknown
>("games/guesses:submit");

export type ConvexPredictionHost = z.infer<typeof hostSchema>;
export type ConvexPredictionRating = z.infer<typeof ratingSchema>;
export type ConvexPredictionScoring = z.infer<typeof predictionScoringSchema>;

export interface ConvexPredictionGuess {
  id: string;
  hostId: string;
  rating: ConvexPredictionRating;
}

export interface ConvexPredictionData {
  activeSeason: boolean;
  hosts: ConvexPredictionHost[];
  ratings: ConvexPredictionRating[];
  scoring: ConvexPredictionScoring;
  guessesByAssignment: Record<string, ConvexPredictionGuess[]>;
}

function normalizeGuess(
  parsed: z.infer<typeof guessSchema>
): ConvexPredictionGuess {
  return {
    id: parsed.id,
    hostId: parsed.assignmentReview.review.user.id,
    rating: parsed.rating,
  };
}

export async function loadConvexPredictionData(
  client: ConvexReactClient,
  assignmentIds: string[]
): Promise<ConvexPredictionData> {
  const today = getPacificTodayPlainDate();
  const [rawHosts, rawRatings, rawActiveSeason, rawScoring, rawGuessGroups] =
    await Promise.all([
      client.query(listHostsReference, {}),
      client.query(listRatingsReference, {}),
      client.query(hasActiveSeasonReference, { today }),
      client.query(predictionScoringReference, {}),
      client.query(mineForAssignmentsReference, { assignmentIds }),
    ]);
  const groups = z.array(assignmentGuessGroupSchema).parse(rawGuessGroups);

  return {
    activeSeason: z.boolean().parse(rawActiveSeason),
    hosts: z.array(hostSchema).parse(rawHosts),
    ratings: z
      .array(ratingSchema)
      .parse(rawRatings)
      .sort((left, right) => right.value - left.value),
    scoring: predictionScoringSchema.parse(rawScoring),
    guessesByAssignment: Object.fromEntries(
      groups.map((group) => [
        group.assignmentId,
        group.guesses.map(normalizeGuess),
      ])
    ),
  };
}

export async function submitConvexPrediction(
  client: ConvexReactClient,
  input: {
    assignmentId: string;
    hostId: string;
    ratingId: string;
  }
) {
  return normalizeGuess(
    guessSchema.parse(
      await client.mutation(submitGuessReference, {
        clientApiVersion: BBPC_CLIENT_API_VERSION,
        ...input,
        today: getPacificTodayPlainDate(),
      })
    )
  );
}
