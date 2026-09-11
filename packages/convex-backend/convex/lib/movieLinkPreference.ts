import { v } from "convex/values";

export const movieLinkPreferenceValidator = v.union(
  v.literal("imdb"),
  v.literal("tmdb"),
);
