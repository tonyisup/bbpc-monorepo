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

export const tmdbTitleValidator = v.object({
  id: v.number(),
  title: v.string(),
  backdrop_path: nullableStringValidator,
  poster_path: nullableStringValidator,
  overview: v.string(),
  release_date: v.string(),
  first_air_date: nullableStringValidator,
  vote_average: v.number(),
  vote_count: v.number(),
  popularity: v.number(),
  media_type: v.string(),
  imdb_id: nullableStringValidator,
  imdb_path: nullableStringValidator,
});

export const tmdbSearchResponseValidator = v.object({
  page: v.number(),
  results: v.array(tmdbTitleValidator),
});
