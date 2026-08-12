import type { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "./identity";

const reviewUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  image: z.string().nullable(),
  status: z.enum(["active", "disabled"]),
});

const movieSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  year: z.number(),
  poster: z.string().nullable(),
  url: z.string(),
  tmdbId: z.number().nullable(),
});

const showSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  year: z.number(),
  poster: z.string().nullable(),
  url: z.string(),
});

const ratingSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  value: z.number(),
  sound: z.string().nullable(),
  icon: z.string().nullable(),
  category: z.string().nullable(),
});

const episodeSchema = z.object({
  id: z.string().min(1),
  number: z.number(),
  title: z.string(),
  status: z.string().nullable(),
  slug: z.string().nullable(),
});

const reviewSchema = z
  .object({
    id: z.string().min(1),
    user: reviewUserSchema.nullable(),
    movie: movieSchema.nullable(),
    show: showSchema.nullable(),
    rating: ratingSchema.nullable(),
    reviewedAt: z.number().nullable(),
    assignmentReviews: z.array(
      z.object({
        id: z.string().min(1),
        assignment: z.object({
          id: z.string().min(1),
          type: z.string(),
          playable: z.boolean(),
          episode: episodeSchema,
        }),
      })
    ),
    extraReviews: z.array(
      z.object({
        id: z.string().min(1),
        episode: episodeSchema,
      })
    ),
  })
  .superRefine((review, context) => {
    if ((review.movie === null) === (review.show === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A review must contain exactly one media target.",
      });
    }
  });

const reviewsPageSchema = z.object({
  page: z.array(reviewSchema),
  isDone: z.boolean(),
  continueCursor: z.string(),
  splitCursor: z.string().nullable().optional(),
  pageStatus: z
    .enum(["SplitRecommended", "SplitRequired"])
    .nullable()
    .optional(),
});

const deleteImpactSchema = z.object({
  id: z.string().min(1),
  assignmentReviewCount: z.number(),
  extraReviewCount: z.number(),
  guessCount: z.number(),
});

const listReviewsReference = makeFunctionReference<
  "query",
  {
    paginationOpts: {
      cursor: string | null;
      numItems: number;
    };
    ratingId?: string;
    unrated?: boolean;
    userId?: string;
  },
  unknown
>("reviews/admin:listPage");

const getDeleteImpactReference = makeFunctionReference<
  "query",
  { id: string },
  unknown
>("reviews/admin:getDeleteImpact");

const setRatingReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    reviewId: string;
    ratingId: string | null;
  },
  unknown
>("reviews/admin:setRating");

const removeReviewReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    expectedImpact: {
      assignmentReviewCount: number;
      extraReviewCount: number;
      guessCount: number;
    };
  },
  unknown
>("reviews/admin:remove");

export const ADMIN_REVIEWS_PAGE_SIZE = 30;

export type ConvexAdminReview = z.infer<typeof reviewSchema>;
export type ConvexReviewDeleteImpact = z.infer<typeof deleteImpactSchema>;
export type ConvexReviewRatingFilter =
  | { kind: "all" }
  | { kind: "unrated" }
  | { kind: "rating"; id: string };

export interface ConvexAdminReviewsPage {
  reviews: ConvexAdminReview[];
  isDone: boolean;
  continueCursor: string;
}

export async function loadConvexAdminReviewsPage(
  client: ConvexReactClient,
  cursor: string | null,
  filters: {
    rating: ConvexReviewRatingFilter;
    userId: string | null;
  }
): Promise<ConvexAdminReviewsPage> {
  const result = reviewsPageSchema.parse(
    await client.query(listReviewsReference, {
      paginationOpts: {
        cursor,
        numItems: ADMIN_REVIEWS_PAGE_SIZE,
      },
      ...(filters.rating.kind === "rating"
        ? { ratingId: filters.rating.id }
        : filters.rating.kind === "unrated"
        ? { unrated: true }
        : {}),
      ...(filters.userId === null ? {} : { userId: filters.userId }),
    })
  );
  return {
    reviews: result.page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}

export async function loadConvexReviewDeleteImpact(
  client: ConvexReactClient,
  id: string
): Promise<ConvexReviewDeleteImpact> {
  return deleteImpactSchema.parse(
    await client.query(getDeleteImpactReference, { id })
  );
}

export async function setConvexAdminReviewRating(
  client: ConvexReactClient,
  reviewId: string,
  ratingId: string | null
): Promise<void> {
  reviewSchema.parse(
    await client.mutation(setRatingReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      reviewId,
      ratingId,
    })
  );
}

export async function deleteConvexAdminReview(
  client: ConvexReactClient,
  impact: ConvexReviewDeleteImpact
): Promise<ConvexReviewDeleteImpact> {
  const result = deleteImpactSchema.parse(
    await client.mutation(removeReviewReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: impact.id,
      expectedImpact: {
        assignmentReviewCount: impact.assignmentReviewCount,
        extraReviewCount: impact.extraReviewCount,
        guessCount: impact.guessCount,
      },
    })
  );
  if (
    result.assignmentReviewCount !== impact.assignmentReviewCount ||
    result.extraReviewCount !== impact.extraReviewCount ||
    result.guessCount !== impact.guessCount
  ) {
    throw new Error("Review cascade result did not match confirmed impact.");
  }
  return result;
}
