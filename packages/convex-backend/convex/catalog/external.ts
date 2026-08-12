import { v } from "convex/values";

import { authenticatedReadAction } from "../functions.js";
import {
  getTmdbTitle,
  searchTmdb,
} from "./tmdbClient.js";
import {
  tmdbSearchResponseValidator,
  tmdbTitleValidator,
} from "./validators.js";

export const searchMovies = authenticatedReadAction({
  args: { query: v.string(), page: v.optional(v.number()) },
  returns: tmdbSearchResponseValidator,
  handler: async (_ctx, args) => {
    return await searchTmdb(
      "movie",
      args.query,
      args.page ?? 1,
    );
  },
});

export const getMovie = authenticatedReadAction({
  args: { id: v.number() },
  returns: tmdbTitleValidator,
  handler: async (_ctx, args) => {
    return await getTmdbTitle("movie", args.id);
  },
});

export const searchShows = authenticatedReadAction({
  args: { query: v.string(), page: v.optional(v.number()) },
  returns: tmdbSearchResponseValidator,
  handler: async (_ctx, args) => {
    return await searchTmdb("tv", args.query, args.page ?? 1);
  },
});

export const getShow = authenticatedReadAction({
  args: { id: v.number() },
  returns: tmdbTitleValidator,
  handler: async (_ctx, args) => {
    return await getTmdbTitle("tv", args.id);
  },
});
