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
