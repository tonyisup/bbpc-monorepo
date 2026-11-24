"use client";
import { documentId } from "@tonyisup/bbpc-convex-api/contracts";

import { api } from "@tonyisup/bbpc-convex-api";

import type { ConvexReactClient } from "convex/react";

import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "@/convex/identity";
import { rankingListDetailSchema, rankingListTypeSchema } from "@/convex/year";
import type { ScorecardCriterion } from "@/lib/scorecard";

const scoreSchema = z.number().int().min(1).max(10).optional();

const scorecardEntrySchema = z.object({
  id: z.string().min(1),
  year: z.number().int(),
  movie: z.object({
    id: z.string().min(1),
    title: z.string(),
    year: z.number(),
    poster: z.string().nullable(),
    url: z.string(),
    tmdbId: z.number().nullable(),
  }),
  scores: z.object({
    story: scoreSchema,
    performance: scoreSchema,
    emotion: scoreSchema,
    visual: scoreSchema,
    audio: scoreSchema,
    importance: scoreSchema,
    engagement: scoreSchema,
    fun: scoreSchema,
    replay: scoreSchema,
  }),
  unseen: z.boolean(),
  complete: z.boolean(),
  average: z.number().nullable(),
  position: z.number().int().positive().nullable(),
  tied: z.boolean(),
  myRating: z
    .object({
      name: z.string(),
      value: z.number(),
      icon: z.string().nullable(),
    })
    .nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type ConvexScorecardEntry = z.infer<typeof scorecardEntrySchema>;
export type ConvexRankingListType = z.infer<typeof rankingListTypeSchema>;

const listForYearReference = api.scorecard.mine.listForYear;
const setScoreReference = api.scorecard.mine.setScore;
const addReference = api.scorecard.mine.add;
const setUnseenReference = api.scorecard.mine.setUnseen;
const clearReference = api.scorecard.mine.clear;
const orderTieReference = api.scorecard.mine.orderTie;
const applyToRankedListReference = api.scorecard.mine.applyToRankedList;
const listRankingTypesReference = api.rankings.types.list;

export async function listConvexScorecard(
  client: ConvexReactClient,
  year: number
) {
  return z
    .array(scorecardEntrySchema)
    .parse(await client.query(listForYearReference, { year }));
}

export async function setConvexScorecardScore(
  client: ConvexReactClient,
  input: {
    year: number;
    movieId: string;
    criterion: ScorecardCriterion;
    value: number;
  }
) {
  return scorecardEntrySchema.parse(
    await client.mutation(setScoreReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      year: input.year,
      movieId: documentId("movies", input.movieId),
      criterion: input.criterion,
      value: input.value,
    })
  );
}

export async function addConvexScorecardMovie(
  client: ConvexReactClient,
  year: number,
  movieId: string
) {
  return scorecardEntrySchema.parse(
    await client.mutation(addReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      year,
      movieId: documentId("movies", movieId),
    })
  );
}

export async function setConvexScorecardUnseen(
  client: ConvexReactClient,
  input: { year: number; movieId: string; unseen: boolean }
) {
  return scorecardEntrySchema.parse(
    await client.mutation(setUnseenReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      year: input.year,
      movieId: documentId("movies", input.movieId),
      unseen: input.unseen,
    })
  );
}

export async function clearConvexScorecardMovie(
  client: ConvexReactClient,
  year: number,
  movieId: string
) {
  return z.object({ movieId: z.string().min(1) }).parse(
    await client.mutation(clearReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      year,
      movieId: documentId("movies", movieId),
    })
  );
}

export async function orderConvexScorecardTie(
  client: ConvexReactClient,
  year: number,
  movieIds: string[]
) {
  return z.array(scorecardEntrySchema).parse(
    await client.mutation(orderTieReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      year,
      movieIds: movieIds.map((id) => documentId("movies", id)),
    })
  );
}

export type ScorecardApplyTarget =
  | { kind: "existing"; rankedListId: string }
  | { kind: "create"; rankedListTypeId: string; title: string };

export async function applyConvexScorecardToRankedList(
  client: ConvexReactClient,
  input: {
    year: number;
    target: ScorecardApplyTarget;
    expectedMovieIds: string[];
  }
) {
  return rankingListDetailSchema.parse(
    await client.mutation(applyToRankedListReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      year: input.year,
      target:
        input.target.kind === "existing"
          ? {
              kind: "existing",
              rankedListId: documentId(
                "rankedLists",
                input.target.rankedListId
              ),
            }
          : {
              kind: "create",
              rankedListTypeId: documentId(
                "rankedListTypes",
                input.target.rankedListTypeId
              ),
              title: input.target.title,
            },
      expectedMovieIds: input.expectedMovieIds.map((id) =>
        documentId("movies", id)
      ),
    })
  );
}

export async function listConvexMovieRankingTypes(client: ConvexReactClient) {
  return z
    .array(rankingListTypeSchema)
    .parse(await client.query(listRankingTypesReference, {}))
    .filter((type) => type.targetType === "MOVIE");
}
