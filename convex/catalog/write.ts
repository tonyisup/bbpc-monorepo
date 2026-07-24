import { v } from "convex/values";

import { authenticatedMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { toCatalogMovie, toCatalogShow } from "./readModel.js";
import {
  validateCatalogPoster,
  validateCatalogTitle,
  validateCatalogUrl,
  validateCatalogYear,
  validateTmdbId,
} from "./writeModel.js";
import {
  catalogMovieValidator,
  catalogShowValidator,
} from "./validators.js";

export const upsertMovieByUrl = authenticatedMutation({
  args: {
    title: v.string(),
    year: v.number(),
    poster: v.string(),
    url: v.string(),
    tmdbId: v.optional(v.number()),
  },
  returns: catalogMovieValidator,
  handler: async (ctx, args) => {
    const title = validateCatalogTitle(args.title);
    const year = validateCatalogYear(args.year);
    const poster = validateCatalogPoster(args.poster);
    const url = validateCatalogUrl(args.url);
    const tmdbId = validateTmdbId(args.tmdbId);
    const existing = await ctx.db
      .query("movies")
      .withIndex("by_url", (index) => index.eq("url", url))
      .first();
    if (existing !== null) {
      const patch = {
        ...title,
        year,
        poster,
        url,
        ...(tmdbId === undefined ? {} : { tmdbId }),
      };
      await ctx.db.patch("movies", existing._id, patch);
      await writeAuditEvent(ctx, {
        actor: ctx.actor,
        action: "catalog.movie.updatedByUrl",
        targetType: "movie",
        targetId: existing._id,
        cutoverRunId: ctx.systemState.cutoverRunId,
      });
      return toCatalogMovie({ ...existing, ...patch });
    }

    const movieId = await ctx.db.insert("movies", {
      ...title,
      year,
      poster,
      url,
      ...(tmdbId === undefined ? {} : { tmdbId }),
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "catalog.movie.createdByUrl",
      targetType: "movie",
      targetId: movieId,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return {
      id: movieId,
      title: title.title,
      year,
      poster,
      url,
      tmdbId: tmdbId ?? null,
    };
  },
});

export const upsertShowByUrl = authenticatedMutation({
  args: {
    title: v.string(),
    year: v.number(),
    poster: v.string(),
    url: v.string(),
  },
  returns: catalogShowValidator,
  handler: async (ctx, args) => {
    const title = validateCatalogTitle(args.title);
    const year = validateCatalogYear(args.year);
    const poster = validateCatalogPoster(args.poster);
    const url = validateCatalogUrl(args.url);
    const existing = await ctx.db
      .query("shows")
      .withIndex("by_url", (index) => index.eq("url", url))
      .first();
    if (existing !== null) {
      const patch = {
        ...title,
        year,
        poster,
        url,
      };
      await ctx.db.patch("shows", existing._id, patch);
      await writeAuditEvent(ctx, {
        actor: ctx.actor,
        action: "catalog.show.updatedByUrl",
        targetType: "show",
        targetId: existing._id,
        cutoverRunId: ctx.systemState.cutoverRunId,
      });
      return toCatalogShow({ ...existing, ...patch });
    }

    const showId = await ctx.db.insert("shows", {
      ...title,
      year,
      poster,
      url,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "catalog.show.createdByUrl",
      targetType: "show",
      targetId: showId,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return {
      id: showId,
      title: title.title,
      year,
      poster,
      url,
    };
  },
});
