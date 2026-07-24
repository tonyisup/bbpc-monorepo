import { v } from "convex/values";

import { catalogMovieValidator } from "../catalog/validators.js";

const nullableStringValidator = v.union(v.string(), v.null());

export const syllabusPositionValidator = v.union(
  v.literal("TOP"),
  v.literal("AFTER_NEXT"),
  v.literal("END"),
);

export const syllabusAssignmentValidator = v.object({
  id: v.id("assignments"),
  type: v.string(),
  playable: v.boolean(),
  slug: nullableStringValidator,
  episode: v.object({
    id: v.id("episodes"),
    number: v.number(),
    title: v.string(),
    status: nullableStringValidator,
    slug: nullableStringValidator,
  }),
});

export const syllabusEntryValidator = v.object({
  id: v.id("syllabusEntries"),
  order: v.number(),
  createdAt: v.number(),
  notes: nullableStringValidator,
  movie: catalogMovieValidator,
  assignment: v.union(syllabusAssignmentValidator, v.null()),
});

export const syllabusAdminEntryValidator =
  syllabusEntryValidator.extend({
    user: v.object({
      id: v.id("users"),
      name: nullableStringValidator,
      email: nullableStringValidator,
      status: v.union(v.literal("active"), v.literal("disabled")),
    }),
  });
