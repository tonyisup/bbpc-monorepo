import { v } from "convex/values";

import { adminMutation, adminQuery } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import {
  countFeedbackWithStatus,
  FEEDBACK_COUNT_CAP,
  MAX_ADMIN_FEEDBACK_PAGE,
  requireFeedback,
  toAdminFeedback,
} from "./model.js";
import {
  adminFeedbackCountsValidator,
  adminFeedbackPageValidator,
  adminFeedbackValidator,
  feedbackStatusValidator,
} from "./validators.js";

// Newest first. The inbox shows one status at a time and the newest hundred.
export const list = adminQuery({
  args: { status: feedbackStatusValidator },
  returns: adminFeedbackPageValidator,
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("feedback")
      .withIndex("by_status_and_createdAt", (index) =>
        index.eq("status", args.status),
      )
      .order("desc")
      .take(MAX_ADMIN_FEEDBACK_PAGE + 1);
    const page = rows.slice(0, MAX_ADMIN_FEEDBACK_PAGE);
    return {
      items: await Promise.all(page.map((row) => toAdminFeedback(ctx, row))),
      hasMore: rows.length > MAX_ADMIN_FEEDBACK_PAGE,
    };
  },
});

export const counts = adminQuery({
  args: {},
  returns: adminFeedbackCountsValidator,
  handler: async (ctx) => ({
    new: await countFeedbackWithStatus(ctx, "new"),
    reviewed: await countFeedbackWithStatus(ctx, "reviewed"),
    archived: await countFeedbackWithStatus(ctx, "archived"),
    cap: FEEDBACK_COUNT_CAP,
  }),
});

export const setStatus = adminMutation({
  args: { id: v.id("feedback"), status: feedbackStatusValidator },
  returns: adminFeedbackValidator,
  handler: async (ctx, args) => {
    const feedback = await requireFeedback(ctx, args.id);
    if (feedback.status !== args.status) {
      await ctx.db.patch("feedback", feedback._id, {
        status: args.status,
        updatedAt: Date.now(),
      });
      await writeAuditEvent(ctx, {
        actor: ctx.actor,
        action: "feedback.admin.statusChanged",
        targetType: "feedback",
        targetId: feedback._id,
        cutoverRunId: ctx.systemState.cutoverRunId,
        metadata: { from: feedback.status, to: args.status },
      });
    }
    return await toAdminFeedback(ctx, await requireFeedback(ctx, feedback._id));
  },
});

export const remove = adminMutation({
  args: { id: v.id("feedback") },
  returns: v.object({ id: v.id("feedback") }),
  handler: async (ctx, args) => {
    const feedback = await requireFeedback(ctx, args.id);
    await ctx.db.delete("feedback", feedback._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "feedback.admin.deleted",
      targetType: "feedback",
      targetId: feedback._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { category: feedback.category },
    });
    return { id: feedback._id };
  },
});
