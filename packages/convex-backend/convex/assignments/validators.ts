import { v } from "convex/values";

import { catalogMovieValidator } from "../catalog/validators.js";

const nullableStringValidator = v.union(v.string(), v.null());

export const assignmentTypeValidator = v.union(
  v.literal("HOMEWORK"),
  v.literal("EXTRA_CREDIT"),
  v.literal("BONUS"),
);

export const assignmentUserValidator = v.object({
  id: v.id("users"),
  name: nullableStringValidator,
  image: nullableStringValidator,
  status: v.union(v.literal("active"), v.literal("disabled")),
});

export const publicAssignmentUserValidator = v.object({
  id: v.id("users"),
  name: nullableStringValidator,
  image: nullableStringValidator,
});

export const assignmentEpisodeValidator = v.object({
  id: v.id("episodes"),
  number: v.number(),
  title: v.string(),
  status: nullableStringValidator,
  slug: nullableStringValidator,
});

export const assignmentDetailValidator = v.object({
  id: v.id("assignments"),
  type: assignmentTypeValidator,
  playable: v.boolean(),
  slug: nullableStringValidator,
  user: assignmentUserValidator,
  movie: catalogMovieValidator,
  episode: assignmentEpisodeValidator,
});

export const publicAssignmentDetailValidator = v.object({
  id: v.id("assignments"),
  type: assignmentTypeValidator,
  playable: v.boolean(),
  slug: nullableStringValidator,
  user: publicAssignmentUserValidator,
  movie: catalogMovieValidator,
  episode: assignmentEpisodeValidator,
});

export const assignmentAdminAudioMessageValidator = v.object({
  id: v.id("assignmentAudioMessages"),
  url: v.string(),
  createdAt: v.number(),
  fileKey: nullableStringValidator,
  assignmentId: v.union(v.id("assignments"), v.null()),
  user: v.object({
    id: v.id("users"),
    name: nullableStringValidator,
    email: nullableStringValidator,
    image: nullableStringValidator,
    status: v.union(v.literal("active"), v.literal("disabled")),
  }),
});

const assignmentWorkbenchUserValidator = v.object({
  id: v.id("users"),
  name: nullableStringValidator,
  status: v.union(v.literal("active"), v.literal("disabled")),
});

const assignmentWorkbenchRatingValidator = v.object({
  id: v.id("ratings"),
  name: v.string(),
  value: v.number(),
});

export const assignmentWorkbenchValidator = v.object({
  assignment: assignmentDetailValidator,
  reviews: v.array(
    v.object({
      id: v.id("assignmentReviews"),
      reviewId: v.id("reviews"),
      reviewer: v.union(
        assignmentWorkbenchUserValidator,
        v.null(),
      ),
      rating: v.union(
        assignmentWorkbenchRatingValidator,
        v.null(),
      ),
      reviewedAt: v.union(v.number(), v.null()),
      guesses: v.array(
        v.object({
          id: v.id("guesses"),
          createdAt: v.number(),
          user: assignmentWorkbenchUserValidator,
          rating: assignmentWorkbenchRatingValidator,
          season: v.object({
            id: v.id("seasons"),
            title: v.string(),
          }),
          hasPoint: v.boolean(),
        }),
      ),
    }),
  ),
  wagers: v.array(
    v.object({
      id: v.id("gamblingEntries"),
      points: v.number(),
      createdAt: v.number(),
      status: v.union(
        v.literal("pending"),
        v.literal("locked"),
        v.literal("won"),
        v.literal("lost"),
        v.literal("rejected"),
      ),
      user: assignmentWorkbenchUserValidator,
      targetUser: v.union(
        assignmentWorkbenchUserValidator,
        v.null(),
      ),
      gamblingType: v.object({
        id: v.id("gamblingTypes"),
        title: v.string(),
        multiplier: v.number(),
      }),
      awardAdjustment: v.union(v.number(), v.null()),
    }),
  ),
});
