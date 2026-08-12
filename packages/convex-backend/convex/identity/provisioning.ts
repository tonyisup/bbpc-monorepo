import { v } from "convex/values";

import { internalMigrationMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  preprovisionServicePrincipal,
  preprovisionUserIdentity,
} from "./provisioningWriteModel.js";

const servicePrincipalStatusValidator = v.union(
  v.literal("active"),
  v.literal("disabled"),
);

export const preprovisionSmokeUser =
  internalMigrationMutation({
    args: {
      userLegacyId: v.string(),
      tokenIdentifier: v.string(),
      issuer: v.string(),
      subject: v.string(),
      verifiedEmail: v.string(),
    },
    returns: v.object({
      authIdentityId: v.id("authIdentities"),
      userId: v.id("users"),
      created: v.boolean(),
    }),
    handler: async (ctx, args) => {
      const result = await preprovisionUserIdentity(ctx, args);
      if (result.created) {
        await writeAuditEvent(ctx, {
          actor: ctx.actor,
          action: "identity.smokeUser.preprovisioned",
          targetType: "user",
          targetId: result.userId,
          cutoverRunId: ctx.systemState.cutoverRunId,
        });
      }
      return result;
    },
  });

export const preprovisionPipelineService =
  internalMigrationMutation({
    args: {
      tokenIdentifier: v.string(),
      issuer: v.string(),
      subject: v.string(),
      name: v.string(),
      permissions: v.array(v.string()),
    },
    returns: v.object({
      servicePrincipalId: v.id("servicePrincipals"),
      created: v.boolean(),
    }),
    handler: async (ctx, args) => {
      const result = await preprovisionServicePrincipal(ctx, {
        ...args,
        cutoverRunId: ctx.systemState.cutoverRunId,
      });
      if (result.created) {
        await writeAuditEvent(ctx, {
          actor: ctx.actor,
          action: "identity.pipelineService.preprovisioned",
          targetType: "servicePrincipal",
          targetId: result.servicePrincipalId,
          cutoverRunId: ctx.systemState.cutoverRunId,
        });
      }
      return result;
    },
  });

export const setPipelineServiceStatus =
  internalMigrationMutation({
    args: {
      servicePrincipalId: v.id("servicePrincipals"),
      expectedStatus: servicePrincipalStatusValidator,
      status: servicePrincipalStatusValidator,
    },
    returns: v.object({
      status: servicePrincipalStatusValidator,
      changed: v.boolean(),
    }),
    handler: async (ctx, args) => {
      if (args.expectedStatus === args.status) {
        domainError(
          "VALIDATION_FAILED",
          "Pipeline service status transitions require distinct states.",
        );
      }
      const principal = await ctx.db.get(
        "servicePrincipals",
        args.servicePrincipalId,
      );
      if (
        principal?.cutoverRunId !== ctx.systemState.cutoverRunId
      ) {
        domainError(
          "NOT_FOUND",
          "The pipeline service principal is unavailable.",
        );
      }
      if (principal.status === args.status) {
        return {
          status: args.status,
          changed: false,
        };
      }
      if (principal.status !== args.expectedStatus) {
        domainError(
          "CONFLICT",
          "The pipeline service principal status changed.",
        );
      }
      await ctx.db.patch(
        "servicePrincipals",
        principal._id,
        {
          status: args.status,
          updatedAt: Date.now(),
        },
      );
      await writeAuditEvent(ctx, {
        actor: ctx.actor,
        action: "identity.pipelineService.statusChanged",
        targetType: "servicePrincipal",
        targetId: principal._id,
        cutoverRunId: ctx.systemState.cutoverRunId,
        metadata: {
          from: args.expectedStatus,
          to: args.status,
        },
      });
      return {
        status: args.status,
        changed: true,
      };
    },
  });
