"use client";

import type { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "@/convex/identity";

const movieSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  year: z.number(),
  poster: z.string().nullable(),
  url: z.string(),
  tmdbId: z.number().nullable(),
});

const ratingSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  value: z.number(),
  category: z.string().nullable(),
  icon: z.string().nullable(),
  sound: z.string().nullable(),
});

const userSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  image: z.string().nullable(),
});

const episodeSchema = z.object({
  id: z.string().min(1),
  number: z.number(),
  slug: z.string().nullable(),
  status: z.string().nullable(),
  title: z.string(),
});

const yearReviewSchema = z.object({
  id: z.string().min(1),
  movie: movieSchema,
  user: userSchema.nullable(),
  rating: ratingSchema.nullable(),
  episode: episodeSchema.nullable(),
  reviewedAt: z.number(),
});

const rankingListTypeSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().nullable(),
  maxItems: z.number().int().positive(),
  targetType: z.enum(["MOVIE", "SHOW", "EPISODE"]),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const rankingItemSchema = z.object({
  id: z.string().min(1),
  rankedListId: z.string().min(1),
  targetType: z.enum(["movie", "show", "episode"]),
  movieId: z.string().nullable(),
  showId: z.string().nullable(),
  episodeId: z.string().nullable(),
  movie: movieSchema.nullable(),
  rank: z.number().int().positive(),
  comment: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const rankingListSummarySchema = z.object({
  id: z.string().min(1),
  rankedListTypeId: z.string().min(1),
  status: z.enum(["DRAFT", "PUBLISHED"]),
  title: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  user: userSchema,
  type: rankingListTypeSchema,
  itemCount: z.number().int().nonnegative(),
});

const rankingListDetailSchema = rankingListSummarySchema.extend({
  items: z.array(rankingItemSchema),
});

const listYearReviewsReference = makeFunctionReference<
  "query",
  { year: number },
  unknown
>("reviews/public:listMovieReviewsForYear");

const listMyRankingListsReference = makeFunctionReference<
  "query",
  { targetType: "MOVIE" },
  unknown
>("rankings/lists:listMine");

const getRankingListReference = makeFunctionReference<
  "query",
  { id: string },
  unknown
>("rankings/lists:get");

const upsertRankingItemReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    rankedListId: string;
    target: { kind: "movie"; id: string };
    rank: number;
  },
  unknown
>("rankings/items:upsert");

const removeRankingItemReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
  },
  unknown
>("rankings/items:remove");

const reorderRankingItemsReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    rankedListId: string;
    itemIds: string[];
  },
  unknown
>("rankings/items:reorder");

export type ConvexYearReview = z.infer<typeof yearReviewSchema>;
export type ConvexMovieRankingListSummary = z.infer<
  typeof rankingListSummarySchema
>;
export type ConvexMovieRankingList = z.infer<typeof rankingListDetailSchema>;
export type ConvexMovieRankingItem = z.infer<typeof rankingItemSchema>;

export async function listConvexYearReviews(
  client: ConvexReactClient,
  year: number
) {
  return z
    .array(yearReviewSchema)
    .parse(await client.query(listYearReviewsReference, { year }));
}

export async function listMyConvexMovieRankingLists(client: ConvexReactClient) {
  return z
    .array(rankingListSummarySchema)
    .parse(
      await client.query(listMyRankingListsReference, { targetType: "MOVIE" })
    );
}

export async function getMyConvexMovieRankingList(
  client: ConvexReactClient,
  id: string
) {
  return rankingListDetailSchema.parse(
    await client.query(getRankingListReference, { id })
  );
}

export async function upsertConvexMovieRankingItem(
  client: ConvexReactClient,
  input: { rankedListId: string; movieId: string; rank: number }
) {
  return rankingItemSchema.parse(
    await client.mutation(upsertRankingItemReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      rankedListId: input.rankedListId,
      target: { kind: "movie", id: input.movieId },
      rank: input.rank,
    })
  );
}

export async function removeConvexMovieRankingItem(
  client: ConvexReactClient,
  id: string
) {
  return z
    .object({ id: z.string().min(1), rank: z.number().int().positive() })
    .parse(
      await client.mutation(removeRankingItemReference, {
        clientApiVersion: BBPC_CLIENT_API_VERSION,
        id,
      })
    );
}

export async function reorderConvexMovieRankingItems(
  client: ConvexReactClient,
  rankedListId: string,
  itemIds: string[]
) {
  return rankingListDetailSchema.parse(
    await client.mutation(reorderRankingItemsReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      rankedListId,
      itemIds,
    })
  );
}
