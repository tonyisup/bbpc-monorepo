import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel.js";
import { anonymousQuery } from "../functions.js";
import { domainError } from "../lib/errors.js";
import {
  catalogMovieValidator,
  catalogShowValidator,
} from "./validators.js";

const MAX_SEARCH_RESULTS = 20;

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

function toMovie(movie: Doc<"movies">) {
  return {
    id: movie._id,
    title: movie.title,
    year: movie.year,
    poster: nullable(movie.poster),
    url: movie.url,
    tmdbId: nullable(movie.tmdbId),
  };
}

function toShow(show: Doc<"shows">) {
  return {
    id: show._id,
    title: show.title,
    year: show.year,
    poster: nullable(show.poster),
    url: show.url,
  };
}

function requireSearchLimit(limit: number): number {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_SEARCH_RESULTS
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Search limit must be an integer from 1 through ${String(MAX_SEARCH_RESULTS)}.`,
    );
  }
  return limit;
}

function prepareSearchQuery(query: string): string | null {
  const prepared = query.trim().normalize("NFKC");
  return prepared.length === 0 ? null : prepared;
}

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
    return movie === null ? null : toMovie(movie);
  },
});

export const getShow = anonymousQuery({
  args: { id: v.id("shows") },
  returns: v.union(catalogShowValidator, v.null()),
  handler: async (ctx, args) => {
    const show = await ctx.db.get("shows", args.id);
    return show === null ? null : toShow(show);
  },
});

export const searchMovies = anonymousQuery({
  args: { query: v.string(), limit: v.number() },
  returns: v.array(catalogMovieValidator),
  handler: async (ctx, args) => {
    const limit = requireSearchLimit(args.limit);
    const query = prepareSearchQuery(args.query);
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
      .map(toMovie);
  },
});

export const searchShows = anonymousQuery({
  args: { query: v.string(), limit: v.number() },
  returns: v.array(catalogShowValidator),
  handler: async (ctx, args) => {
    const limit = requireSearchLimit(args.limit);
    const query = prepareSearchQuery(args.query);
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
    ).map(toShow);
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
    return { ...result, page: result.page.map(toMovie) };
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
    return { ...result, page: result.page.map(toShow) };
  },
});
