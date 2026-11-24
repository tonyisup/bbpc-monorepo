import { v } from "convex/values";

import { catalogMovieValidator } from "../catalog/validators.js";

export const scorecardCriterionValidator = v.union(
  v.literal("story"),
  v.literal("performance"),
  v.literal("emotion"),
  v.literal("visual"),
  v.literal("audio"),
  v.literal("importance"),
  v.literal("engagement"),
  v.literal("fun"),
  v.literal("replay"),
);

export const scorecardScoresValidator = v.object({
  story: v.optional(v.number()),
  performance: v.optional(v.number()),
  emotion: v.optional(v.number()),
  visual: v.optional(v.number()),
  audio: v.optional(v.number()),
  importance: v.optional(v.number()),
  engagement: v.optional(v.number()),
  fun: v.optional(v.number()),
  replay: v.optional(v.number()),
});

export const scorecardMyRatingValidator = v.object({
  name: v.string(),
  value: v.number(),
  icon: v.union(v.string(), v.null()),
});

export const scorecardEntryValidator = v.object({
  id: v.id("scorecardEntries"),
  year: v.number(),
  movie: catalogMovieValidator,
  scores: scorecardScoresValidator,
  unseen: v.boolean(),
  complete: v.boolean(),
  average: v.union(v.number(), v.null()),
  position: v.union(v.number(), v.null()),
  tied: v.boolean(),
  myRating: v.union(scorecardMyRatingValidator, v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const scorecardApplyTargetValidator = v.union(
  v.object({
    kind: v.literal("existing"),
    rankedListId: v.id("rankedLists"),
  }),
  v.object({
    kind: v.literal("create"),
    rankedListTypeId: v.id("rankedListTypes"),
    title: v.string(),
  }),
);
