import { v } from "convex/values";

import {
  internalAppMutation,
  internalControlMutation,
  internalMigrationMutation,
} from "../functions.js";
import type { Doc } from "../_generated/dataModel.js";
import { requireApplicationWritesEnabled } from "../lib/writeGate.js";
import {
  cutoverStageValidator,
  systemStateDocumentValidator,
} from "../lib/validators.js";

export const assertUserActionWriteEnabled = internalControlMutation({
  args: {
    userId: v.id("users"),
    clientApiVersion: v.string(),
  },
  returns: systemStateDocumentValidator,
  handler: async (ctx, args): Promise<Doc<"systemState">> => {
    const user = await ctx.db.get("users", args.userId);
    if (user?.status !== "active") {
      throw new Error("Action user is unavailable");
    }
    return await requireApplicationWritesEnabled(ctx, {
      actor: {
        kind: "internal",
        label: `user-action:${user._id}`,
      },
      clientApiVersion: args.clientApiVersion,
    });
  },
});

export const assertServiceActionWriteEnabled = internalControlMutation({
  args: {
    servicePrincipalId: v.id("servicePrincipals"),
    clientApiVersion: v.string(),
  },
  returns: systemStateDocumentValidator,
  handler: async (ctx, args): Promise<Doc<"systemState">> => {
    const servicePrincipal = await ctx.db.get(
      "servicePrincipals",
      args.servicePrincipalId,
    );
    if (servicePrincipal?.status !== "active") {
      throw new Error("Action service principal is unavailable");
    }
    return await requireApplicationWritesEnabled(ctx, {
      actor: {
        kind: "internal",
        label: `service-action:${servicePrincipal._id}`,
      },
      clientApiVersion: args.clientApiVersion,
    });
  },
});

export const assertScheduledWriteEnabled = internalAppMutation({
  args: {},
  returns: v.object({
    cutoverStage: cutoverStageValidator,
    allowed: v.literal(true),
  }),
  handler: async (ctx) => ({
    cutoverStage: ctx.systemState.cutoverStage,
    allowed: true as const,
  }),
});

export const assertMigrationWriteEnabled = internalMigrationMutation({
  args: {},
  returns: v.object({
    allowed: v.literal(true),
    cutoverStage: cutoverStageValidator,
    operationId: v.string(),
  }),
  handler: async (ctx) => ({
    allowed: true as const,
    cutoverStage: ctx.systemState.cutoverStage,
    operationId: ctx.migrationOperationId,
  }),
});
