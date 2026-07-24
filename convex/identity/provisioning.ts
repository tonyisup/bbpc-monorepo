import { v } from "convex/values";

import { internalMigrationMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import {
  preprovisionServicePrincipal,
  preprovisionUserIdentity,
} from "./provisioningWriteModel.js";

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
