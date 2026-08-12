import { v } from "convex/values";

import {
  catalogMovieValidator,
  catalogShowValidator,
} from "../catalog/validators.js";
import { ratingValidator } from "../ratings/validators.js";

const nullableStringValidator = v.union(v.string(), v.null());

export const reviewUserValidator = v.object({
  id: v.id("users"),
  name: nullableStringValidator,
  image: nullableStringValidator,
  status: v.union(v.literal("active"), v.literal("disabled")),
});

export const reviewEpisodeValidator = v.object({
  id: v.id("episodes"),
  number: v.number(),
  title: v.string(),
  status: nullableStringValidator,
  slug: nullableStringValidator,
});

export const reviewCoreValidator = v.object({
  id: v.id("reviews"),
  user: v.union(reviewUserValidator, v.null()),
  movie: v.union(catalogMovieValidator, v.null()),
  show: v.union(catalogShowValidator, v.null()),
  rating: v.union(ratingValidator, v.null()),
  reviewedAt: v.union(v.number(), v.null()),
});

export const assignmentReviewDetailValidator = v.object({
  id: v.id("assignmentReviews"),
  assignment: v.object({
    id: v.id("assignments"),
    type: v.string(),
    playable: v.boolean(),
    episode: reviewEpisodeValidator,
  }),
  review: reviewCoreValidator,
});

export const extraReviewDetailValidator = v.object({
  id: v.id("extraReviews"),
  episode: reviewEpisodeValidator,
  review: reviewCoreValidator,
});

export const reviewDetailValidator = reviewCoreValidator.extend({
  assignmentReviews: v.array(
    v.object({
      id: v.id("assignmentReviews"),
      assignment: v.object({
        id: v.id("assignments"),
        type: v.string(),
        playable: v.boolean(),
        episode: reviewEpisodeValidator,
      }),
    }),
  ),
  extraReviews: v.array(
    v.object({
      id: v.id("extraReviews"),
      episode: reviewEpisodeValidator,
    }),
  ),
});

export const yearMovieReviewValidator = v.object({
  id: v.id("reviews"),
  movie: catalogMovieValidator,
  user: v.union(
    v.object({
      id: v.id("users"),
      name: nullableStringValidator,
      image: nullableStringValidator,
    }),
    v.null(),
  ),
  rating: v.union(ratingValidator, v.null()),
  episode: v.union(reviewEpisodeValidator, v.null()),
  reviewedAt: v.number(),
});
