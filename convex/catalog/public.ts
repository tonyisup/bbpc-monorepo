import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel.js";
import { anonymousQuery } from "../functions.js";
import {
  preparePublicSearchQuery,
  requirePublicSearchLimit,
} from "../lib/publicSearch.js";
import {
  catalogMovieValidator,
  catalogShowValidator,
} from "./validators.js";
import {
  toCatalogMovie,
  toCatalogShow,
} from "./readModel.js";

function compareMovies(
  left: Doc<"movies">,
  right: Doc<"movies">,
): number {
  return (
    left.normalizedTitle.localeCompare(right.normalizedTitle) ||
    left.year - right.year ||
    left._creationTime - right._creationTime
  );
}

export const getMovie = anonymousQuery({
  args: { id: v.id("movies") },
  returns: v.union(catalogMovieValidator, v.null()),
  handler: async (ctx, args) => {
    const movie = await ctx.db.get("movies", args.id);
    return movie === null ? null : toCatalogMovie(movie);
  },
});

export const getShow = anonymousQuery({
  args: { id: v.id("shows") },
  returns: v.union(catalogShowValidator, v.null()),
  handler: async (ctx, args) => {
    const show = await ctx.db.get("shows", args.id);
    return show === null ? null : toCatalogShow(show);
  },
});

export const searchMovies = anonymousQuery({
  args: { query: v.string(), limit: v.number() },
  returns: v.array(catalogMovieValidator),
  handler: async (ctx, args) => {
    const limit = requirePublicSearchLimit(args.limit);
    const query = preparePublicSearchQuery(args.query);
    if (query === null) {
      return [];
    }
    const titleMatches = await ctx.db
      .query("movies")
      .withSearchIndex("search_title", (search) =>
        search.search("title", query),
      )
      .take(limit);
    const year =
      /^\d{4}$/u.test(query) ? Number(query) : undefined;
    const yearMatches =
      year === undefined
        ? []
        : await ctx.db
            .query("movies")
            .withIndex("by_year", (index) =>
              index.eq("year", year),
            )
            .take(limit);
    const byId = new Map(
      [...titleMatches, ...yearMatches].map((movie) => [
        movie._id,
        movie,
      ]),
    );
    return [...byId.values()]
      .sort(compareMovies)
      .slice(0, limit)
      .map(toCatalogMovie);
  },
});

export const searchShows = anonymousQuery({
  args: { query: v.string(), limit: v.number() },
  returns: v.array(catalogShowValidator),
  handler: async (ctx, args) => {
    const limit = requirePublicSearchLimit(args.limit);
    const query = preparePublicSearchQuery(args.query);
    if (query === null) {
      return [];
    }
    return (
      await ctx.db
        .query("shows")
        .withSearchIndex("search_title", (search) =>
          search.search("title", query),
        )
        .take(limit)
    ).map(toCatalogShow);
  },
});

export const listMoviesPage = anonymousQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(catalogMovieValidator),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("movies")
      .withIndex("by_normalizedTitle_and_year")
      .paginate(args.paginationOpts);
    return { ...result, page: result.page.map(toCatalogMovie) };
  },
});

export const listShowsPage = anonymousQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(catalogShowValidator),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("shows")
      .withIndex("by_normalizedTitle_and_year")
      .paginate(args.paginationOpts);
    return { ...result, page: result.page.map(toCatalogShow) };
  },
});
