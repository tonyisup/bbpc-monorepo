import { v } from "convex/values";

const nullableStringValidator = v.union(v.string(), v.null());
const nullableNumberValidator = v.union(v.number(), v.null());

export const catalogMovieValidator = v.object({
  id: v.id("movies"),
  title: v.string(),
  year: v.number(),
  poster: nullableStringValidator,
  url: v.string(),
  tmdbId: nullableNumberValidator,
});

export const catalogShowValidator = v.object({
  id: v.id("shows"),
  title: v.string(),
  year: v.number(),
  poster: nullableStringValidator,
  url: v.string(),
});
