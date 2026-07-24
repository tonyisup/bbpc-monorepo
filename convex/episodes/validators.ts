import { v } from "convex/values";

const nullableStringValidator = v.union(v.string(), v.null());
const nullableNumberValidator = v.union(v.number(), v.null());

export const episodeUserValidator = v.object({
  id: v.id("users"),
  name: nullableStringValidator,
  image: nullableStringValidator,
});

export const episodeMovieValidator = v.object({
  id: v.id("movies"),
  title: v.string(),
  year: v.number(),
  poster: nullableStringValidator,
  url: v.string(),
  tmdbId: nullableNumberValidator,
});

export const episodeShowValidator = v.object({
  id: v.id("shows"),
  title: v.string(),
  year: v.number(),
  poster: nullableStringValidator,
  url: v.string(),
});

export const episodeAssignmentValidator = v.object({
  id: v.id("assignments"),
  type: v.string(),
  playable: v.boolean(),
  slug: nullableStringValidator,
  user: episodeUserValidator,
  movie: episodeMovieValidator,
});

export const episodeExtraValidator = v.object({
  id: v.id("extraReviews"),
  review: v.object({
    id: v.id("reviews"),
    movie: v.union(episodeMovieValidator, v.null()),
    show: v.union(episodeShowValidator, v.null()),
  }),
});

export const episodeLinkValidator = v.object({
  id: v.id("episodeLinks"),
  url: v.string(),
  text: v.string(),
});

export const episodeDetailValidator = v.object({
  id: v.id("episodes"),
  number: v.number(),
  title: v.string(),
  recording: nullableStringValidator,
  date: nullableStringValidator,
  description: nullableStringValidator,
  status: nullableStringValidator,
  slug: nullableStringValidator,
  assignments: v.array(episodeAssignmentValidator),
  extras: v.array(episodeExtraValidator),
  links: v.array(episodeLinkValidator),
});
