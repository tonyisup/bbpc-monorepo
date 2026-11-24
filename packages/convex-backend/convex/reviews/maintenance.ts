import { v } from "convex/values";

import { internal } from "../_generated/api.js";
import { internalAppMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";

const BACKFILL_BATCH_SIZE = 100;

/**
 * Date rated reviews that were stored without a reviewedAt.
 *
 * A guess placed before the host rated an assignment created the host's
 * review with no date, and rating it later did not add one, so dated reads
 * such as the public year archive skipped it. Each such review is dated by
 * its creation time, which falls within days of the episode it belongs to.
 * Migrated legacy rows keep the dates the legacy system gave them, and
 * unrated reviews are left for setRating to date. Safe to rerun: a dated
 * review leaves the scanned range.
 */
export const backfillMissingReviewedAt = internalAppMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    dated: v.number(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("reviews")
      .withIndex("by_reviewedAt", (index) =>
        index.eq("reviewedAt", undefined),
      )
      .paginate({ cursor: args.cursor, numItems: BACKFILL_BATCH_SIZE });
    let dated = 0;
    for (const review of result.page) {
      if (review.ratingId === undefined || review.legacyId !== undefined) {
        continue;
      }
      await ctx.db.patch("reviews", review._id, {
        reviewedAt: review._creationTime,
      });
      dated += 1;
    }
    if (dated > 0) {
      await writeAuditEvent(ctx, {
        actor: ctx.actor,
        action: "reviews.maintenance.reviewedAtBackfilled",
        targetType: "review",
        cutoverRunId: ctx.systemState.cutoverRunId,
        metadata: { dated },
      });
    }
    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.reviews.maintenance.backfillMissingReviewedAt,
        {
          cursor: result.continueCursor,
          cutoverRunId: ctx.systemState.cutoverRunId,
          clientApiVersion: ctx.systemState.apiVersion,
        },
      );
    }
    return { dated, isDone: result.isDone };
  },
});
