"use client";
import { documentId } from "@tonyisup/bbpc-convex-api/contracts";

import { api } from "@tonyisup/bbpc-convex-api";

import type { ConvexReactClient } from "convex/react";

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

const listHostsReference = api.identity.public.listHosts;

const listRatingsReference = api.ratings.public.list;

const hasActiveSeasonReference = api.games.public.hasActiveSeason;

const predictionScoringReference = api.games.public.predictionScoring;

const mineForAssignmentsReference = api.games.guesses.mineForAssignments;

const submitGuessReference = api.games.guesses.submit;

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
      client.query(mineForAssignmentsReference, {
        assignmentIds: assignmentIds.map((id) => documentId("assignments", id)),
      }),
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
        assignmentId: documentId("assignments", input.assignmentId),
        hostId: documentId("users", input.hostId),
        ratingId: documentId("ratings", input.ratingId),
      })
    )
  );
}
