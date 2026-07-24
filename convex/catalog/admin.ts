import { v } from "convex/values";

import { adminMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { toCatalogShow } from "./readModel.js";
import { catalogShowValidator } from "./validators.js";
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
