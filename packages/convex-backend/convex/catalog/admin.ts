import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { adminMutation, adminQuery } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import { hydrateReviewDetail } from "../reviews/readModel.js";
import { reviewDetailValidator } from "../reviews/validators.js";
import {
  toCatalogMovie,
  toCatalogShow,
} from "./readModel.js";
import {
  catalogMovieValidator,
  catalogShowValidator,
} from "./validators.js";
import {
  assertMovieUnreferenced,
  assertShowUnreferenced,
  requireMovie,
  requireShow,
  validateCatalogPoster,
  validateCatalogTitle,
  validateCatalogUrl,
  validateCatalogYear,
} from "./writeModel.js";

const MAX_MEDIA_DETAIL_REVIEWS = 100;
const catalogMovieDetailValidator = v.object({
  media: catalogMovieValidator,
  reviews: v.array(reviewDetailValidator),
});
const catalogShowDetailValidator = v.object({
  media: catalogShowValidator,
  reviews: v.array(reviewDetailValidator),
});

async function hydrateMediaReviews(
  ctx: QueryCtx,
  reviews: Array<Doc<"reviews">>,
) {
  if (reviews.length > MAX_MEDIA_DETAIL_REVIEWS) {
    domainError(
      "CONFLICT",
      "Media reviews exceed the supported detail limit.",
      { details: { limit: MAX_MEDIA_DETAIL_REVIEWS } },
    );
  }
  return await Promise.all(
    reviews.map(async (review) => hydrateReviewDetail(ctx, review)),
  );
}

export const getMovieDetail = adminQuery({
  args: { id: v.id("movies") },
  returns: v.union(catalogMovieDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const movie = await ctx.db.get("movies", args.id);
    if (movie === null) {
      return null;
    }
    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_movieId", (index) => index.eq("movieId", movie._id))
      .take(MAX_MEDIA_DETAIL_REVIEWS + 1);
    return {
      media: toCatalogMovie(movie),
      reviews: await hydrateMediaReviews(ctx, reviews),
    };
  },
});

export const getShowDetail = adminQuery({
  args: { id: v.id("shows") },
  returns: v.union(catalogShowDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const show = await ctx.db.get("shows", args.id);
    if (show === null) {
      return null;
    }
    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_showId", (index) => index.eq("showId", show._id))
      .take(MAX_MEDIA_DETAIL_REVIEWS + 1);
    return {
      media: toCatalogShow(show),
      reviews: await hydrateMediaReviews(ctx, reviews),
    };
  },
});

export const updateShow = adminMutation({
  args: {
    id: v.id("shows"),
    title: v.string(),
    year: v.number(),
    poster: v.optional(v.string()),
    url: v.string(),
  },
  returns: catalogShowValidator,
  handler: async (ctx, args) => {
    const show = await requireShow(ctx, args.id);
    const title = validateCatalogTitle(args.title);
    const year = validateCatalogYear(args.year);
    const url = validateCatalogUrl(args.url);
    const poster =
      args.poster === undefined
        ? undefined
        : validateCatalogPoster(args.poster);
    await ctx.db.patch("shows", show._id, {
      ...title,
      year,
      url,
      ...(poster === undefined ? {} : { poster }),
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "catalog.show.updated",
      targetType: "show",
      targetId: show._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    const updated = await requireShow(ctx, show._id);
    return toCatalogShow(updated);
  },
});

export const deleteMovie = adminMutation({
  args: { id: v.id("movies") },
  returns: v.object({ id: v.id("movies") }),
  handler: async (ctx, args) => {
    const movie = await requireMovie(ctx, args.id);
    await assertMovieUnreferenced(ctx, movie._id);
    await ctx.db.delete("movies", movie._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "catalog.movie.deleted",
      targetType: "movie",
      targetId: movie._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return { id: movie._id };
  },
});

export const deleteShow = adminMutation({
  args: { id: v.id("shows") },
  returns: v.object({ id: v.id("shows") }),
  handler: async (ctx, args) => {
    const show = await requireShow(ctx, args.id);
    await assertShowUnreferenced(ctx, show._id);
    await ctx.db.delete("shows", show._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "catalog.show.deleted",
      targetType: "show",
      targetId: show._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return { id: show._id };
  },
});
