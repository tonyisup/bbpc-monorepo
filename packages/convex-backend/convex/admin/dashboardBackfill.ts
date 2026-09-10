import { v } from "convex/values";
import { internal } from "../_generated/api.js";
import { adminMutation, internalAppMutation } from "../functions.js";
import {
  backfillDashboardDocument,
  dashboardSources,
} from "../lib/dashboardProjection.js";

const sourceValidator = v.union(
  v.literal("users"),
  v.literal("movies"),
  v.literal("reviews"),
  v.literal("episodes"),
  v.literal("guesses"),
);

// Safe to retry after a cutover pause: persisted cursors and membership prevent double counting.
export const initialize = adminMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    for (const source of dashboardSources) {
      const state = await ctx.db
        .query("dashboardBackfills")
        .withIndex("by_source", (q) => q.eq("source", source))
        .unique();
      if (state?.complete) continue;
      if (state === null)
        await ctx.db.insert("dashboardBackfills", {
          source,
          cursor: null,
          complete: false,
        });
      await ctx.scheduler.runAfter(0, internal.admin.dashboardBackfill.batch, {
        source,
        cutoverRunId: ctx.systemState.cutoverRunId,
        clientApiVersion: ctx.systemState.apiVersion,
      });
    }
    return null;
  },
});

export const batch = internalAppMutation({
  args: { source: sourceValidator },
  returns: v.null(),
  handler: async (ctx, { source }) => {
    const state = await ctx.db
      .query("dashboardBackfills")
      .withIndex("by_source", (q) => q.eq("source", source))
      .unique();
    if (state === null || state.complete) return null;
    const result = await ctx.db
      .query(source)
      .paginate({
        cursor: state.cursor,
        numItems: 100,
        maximumBytesRead: 1_000_000,
      });
    for (const doc of result.page)
      await backfillDashboardDocument(ctx, source, doc);
    await ctx.db.patch("dashboardBackfills", state._id, {
      cursor: result.continueCursor,
      complete: result.isDone,
    });
    if (!result.isDone)
      await ctx.scheduler.runAfter(0, internal.admin.dashboardBackfill.batch, {
        source,
        cutoverRunId: ctx.systemState.cutoverRunId,
        clientApiVersion: ctx.systemState.apiVersion,
      });
    return null;
  },
});
