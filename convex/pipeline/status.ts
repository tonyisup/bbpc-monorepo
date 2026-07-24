import { v } from "convex/values";

import {
  pipelineAction,
  pipelineMutation,
  pipelineQuery,
} from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import { requireServicePermission } from "../lib/actors.js";
import { cutoverStageValidator } from "../lib/validators.js";

export const capabilities = pipelineQuery({
  args: {},
  returns: v.object({
    servicePrincipalId: v.id("servicePrincipals"),
    name: v.string(),
    permissions: v.array(v.string()),
  }),
  handler: async (ctx) => ({
    servicePrincipalId: ctx.actor.servicePrincipal._id,
    name: ctx.actor.servicePrincipal.name,
    permissions: ctx.actor.servicePrincipal.permissions,
  }),
});

export const heartbeat = pipelineMutation({
  args: {
    requiredPermission: v.string(),
  },
  returns: v.object({
    lastSeenAt: v.number(),
  }),
  handler: async (ctx, args) => {
    requireServicePermission(ctx.actor, args.requiredPermission);
    const lastSeenAt = Date.now();
    await ctx.db.patch(
      "servicePrincipals",
      ctx.actor.servicePrincipal._id,
      { lastSeenAt },
    );
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "pipeline.heartbeat",
      targetType: "servicePrincipal",
      targetId: ctx.actor.servicePrincipal._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { permission: args.requiredPermission },
    });
    return { lastSeenAt };
  },
});

export const actionGateProbe = pipelineAction({
  args: {
    requiredPermission: v.string(),
  },
  returns: v.object({
    allowed: v.literal(true),
    cutoverStage: cutoverStageValidator,
  }),
  handler: async (ctx, args) => {
    if (!ctx.actor.permissions.includes(args.requiredPermission)) {
      domainError(
        "FORBIDDEN",
        "The pipeline service lacks the required permission.",
      );
    }
    return {
      allowed: true as const,
      cutoverStage: ctx.systemState.cutoverStage,
    };
  },
});
