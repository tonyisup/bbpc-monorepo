import { v } from "convex/values";

import {
  authenticatedAction,
  authenticatedMutation,
  authenticatedQuery,
} from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import { cutoverStageValidator } from "../lib/validators.js";

export const me = authenticatedQuery({
  args: {},
  returns: v.object({
    id: v.id("users"),
    name: v.union(v.string(), v.null()),
    email: v.union(v.string(), v.null()),
    image: v.union(v.string(), v.null()),
    isAdmin: v.boolean(),
  }),
  handler: async (ctx) => ({
    id: ctx.actor.user._id,
    name: ctx.actor.user.name ?? null,
    email: ctx.actor.user.email ?? null,
    image: ctx.actor.user.image ?? null,
    isAdmin: ctx.actor.isAdmin,
  }),
});

export const updateMyName = authenticatedMutation({
  args: { name: v.string() },
  returns: v.object({
    name: v.string(),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (name.length < 1 || name.length > 100) {
      domainError(
        "VALIDATION_FAILED",
        "Name must contain between 1 and 100 characters.",
      );
    }
    const now = Date.now();
    await ctx.db.patch("users", ctx.actor.user._id, {
      name,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "identity.profile.nameUpdated",
      targetType: "user",
      targetId: ctx.actor.user._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return { name, updatedAt: now };
  },
});

export const actionGateProbe = authenticatedAction({
  args: {},
  returns: v.object({
    allowed: v.literal(true),
    cutoverStage: cutoverStageValidator,
    isAdmin: v.boolean(),
  }),
  handler: async (ctx) => ({
    allowed: true as const,
    cutoverStage: ctx.systemState.cutoverStage,
    isAdmin: ctx.actor.isAdmin,
  }),
});
