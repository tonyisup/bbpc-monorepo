import type { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";

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

const userSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  image: z.string().nullable(),
  status: z.enum(["active", "disabled"]),
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
    user: userSchema.nullable(),
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
        message: "A media review must contain exactly one target.",
      });
    }
  });

const movieDetailSchema = z.object({
  media: movieSchema,
  reviews: z.array(reviewSchema),
});

const showDetailSchema = z.object({
  media: showSchema,
  reviews: z.array(reviewSchema),
});

const getMovieDetailReference = makeFunctionReference<
  "query",
  { id: string },
  unknown
>("catalog/admin:getMovieDetail");

const getShowDetailReference = makeFunctionReference<
  "query",
  { id: string },
  unknown
>("catalog/admin:getShowDetail");

export type ConvexMediaDetailReview = z.infer<typeof reviewSchema>;
export type ConvexMovieDetail = z.infer<typeof movieDetailSchema>;
export type ConvexShowDetail = z.infer<typeof showDetailSchema>;

export async function loadConvexMovieDetail(
  client: ConvexReactClient,
  id: string
): Promise<ConvexMovieDetail | null> {
  const result = await client.query(getMovieDetailReference, { id });
  if (result === null) {
    return null;
  }
  const detail = movieDetailSchema.parse(result);
  if (
    detail.reviews.some(
      (review) =>
        review.movie?.id !== detail.media.id || review.show !== null
    )
  ) {
    throw new Error("Movie detail contains a cross-target review.");
  }
  return detail;
}

export async function loadConvexShowDetail(
  client: ConvexReactClient,
  id: string
): Promise<ConvexShowDetail | null> {
  const result = await client.query(getShowDetailReference, { id });
  if (result === null) {
    return null;
  }
  const detail = showDetailSchema.parse(result);
  if (
    detail.reviews.some(
      (review) =>
        review.show?.id !== detail.media.id || review.movie !== null
    )
  ) {
    throw new Error("Show detail contains a cross-target review.");
  }
  return detail;
}
