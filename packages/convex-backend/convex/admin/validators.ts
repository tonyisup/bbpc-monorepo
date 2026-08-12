import { v } from "convex/values";

import { catalogMovieValidator } from "../catalog/validators.js";
import { episodeDetailValidator } from "../episodes/validators.js";

const nullableStringValidator = v.union(v.string(), v.null());

export const dashboardSyllabusEntryValidator = v.object({
  id: v.id("syllabusEntries"),
  createdAt: v.number(),
  user: v.object({
    id: v.id("users"),
    name: nullableStringValidator,
  }),
  movie: catalogMovieValidator,
});

export const dashboardGuessStatValidator = v.object({
  id: v.id("episodes"),
  slug: nullableStringValidator,
  name: v.string(),
  fullTitle: v.string(),
  guesses: v.number(),
});

export const dashboardOverviewValidator = v.object({
  counts: v.object({
    episodes: v.number(),
    users: v.number(),
    movies: v.number(),
    reviews: v.number(),
  }),
  latestEpisode: v.union(episodeDetailValidator, v.null()),
  upcomingEpisode: v.union(episodeDetailValidator, v.null()),
  latestSyllabus: v.array(dashboardSyllabusEntryValidator),
  guessStats: v.array(dashboardGuessStatValidator),
});
