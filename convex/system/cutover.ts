import { v } from "convex/values";

import {
  adminQuery,
  internalControlMutation,
} from "../functions.js";
import { writeControlAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  applicationWriteModeValidator,
  cutoverStageValidator,
} from "../lib/validators.js";
import { getSystemState } from "../lib/writeGate.js";

type CutoverStage = "S0" | "S1" | "S2" | "S3" | "S4";

/*
 * S0 ──▶ S1 ──▶ S2 ──▶ S3 ──▶ S4
 *  ▲      │       │       │
 *  └──────┴───────┘       └──▶ S2 only before firstApplicationWriteAt exists
 *
 * S0–S2 keep application writes disabled. S3 requires a named, checksummed
 * backup. The first accepted application write is the irreversible boundary:
 * after it, SQL cannot safely reopen and S3 cannot roll back to S2.
 */
function canTransition(
  from: CutoverStage,
  to: CutoverStage,
  hasApplicationWrite: boolean,
): boolean {
  if (from === "S0") {
    return to === "S1";
  }
  if (from === "S1") {
    return to === "S0" || to === "S2";
  }
  if (from === "S2") {
    return to === "S0" || to === "S3";
  }
  if (from === "S3") {
    return (!hasApplicationWrite && to === "S2") || to === "S4";
  }
  return false;
}

export const getStatus = adminQuery({
  args: {},
  returns: v.union(
    v.object({
      initialized: v.literal(false),
      applicationWriteMode: v.literal("disabled"),
    }),
    v.object({
      initialized: v.literal(true),
      cutoverStage: cutoverStageValidator,
      applicationWriteMode: applicationWriteModeValidator,
      cutoverRunId: v.string(),
      apiVersion: v.string(),
      firstApplicationWriteAt: v.union(v.number(), v.null()),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const state = await getSystemState(ctx);
    if (!state) {
      return {
        initialized: false as const,
        applicationWriteMode: "disabled" as const,
      };
    }
    return {
      initialized: true as const,
      cutoverStage: state.cutoverStage,
      applicationWriteMode: state.applicationWriteMode,
      cutoverRunId: state.cutoverRunId,
      apiVersion: state.apiVersion,
      firstApplicationWriteAt: state.firstApplicationWriteAt ?? null,
      updatedAt: state.updatedAt,
    };
  },
});

export const initialize = internalControlMutation({
  args: {
    cutoverRunId: v.string(),
    apiVersion: v.string(),
    actor: v.string(),
  },
  returns: v.id("systemState"),
  handler: async (ctx, args) => {
    const existing = await getSystemState(ctx);
    if (existing) {
      domainError(
        "CONFLICT",
        "The BBPC backend is already initialized.",
      );
    }
    const now = Date.now();
    const stateId = await ctx.db.insert("systemState", {
      singletonKey: "global",
      cutoverStage: "S0",
      applicationWriteMode: "disabled",
      cutoverRunId: args.cutoverRunId,
      apiVersion: args.apiVersion,
      initializedAt: now,
      updatedAt: now,
      updatedBy: args.actor,
    });
    await writeControlAuditEvent(ctx, {
      actor: args.actor,
      action: "system.initialize",
      targetType: "systemState",
      targetId: stateId,
      cutoverRunId: args.cutoverRunId,
      metadata: {
        cutoverStage: "S0",
        apiVersion: args.apiVersion,
      },
    });
    return stateId;
  },
});

export const transition = internalControlMutation({
  args: {
    cutoverRunId: v.string(),
    expectedStage: cutoverStageValidator,
    nextStage: cutoverStageValidator,
    actor: v.string(),
    approvedBackupId: v.optional(v.string()),
    approvedBackupChecksum: v.optional(v.string()),
  },
  returns: v.object({
    cutoverStage: cutoverStageValidator,
    applicationWriteMode: applicationWriteModeValidator,
  }),
  handler: async (ctx, args) => {
    const state = await getSystemState(ctx);
    if (!state) {
      domainError(
        "WRITE_DISABLED",
        "The BBPC backend is not initialized.",
      );
    }
    if (state.cutoverRunId !== args.cutoverRunId) {
      domainError("CONFLICT", "The cutover run does not match.");
    }
    if (state.cutoverStage !== args.expectedStage) {
      domainError("CONFLICT", "The cutover stage changed.");
    }
    if (
      !canTransition(
        state.cutoverStage,
        args.nextStage,
        state.firstApplicationWriteAt !== undefined,
      )
    ) {
      domainError(
        "VALIDATION_FAILED",
        "The requested cutover transition is not allowed.",
      );
    }
    if (
      args.nextStage === "S3" &&
      (!args.approvedBackupId || !args.approvedBackupChecksum)
    ) {
      domainError(
        "VALIDATION_FAILED",
        "S3 requires the approved S2 backup and checksum.",
      );
    }

    const now = Date.now();
    const applicationWriteMode: "disabled" | "enabled" =
      args.nextStage === "S3" || args.nextStage === "S4"
        ? "enabled"
        : "disabled";
    await ctx.db.patch("systemState", state._id, {
      cutoverStage: args.nextStage,
      applicationWriteMode,
      updatedAt: now,
      updatedBy: args.actor,
      ...(args.nextStage === "S3"
        ? {
            approvedBackupId: args.approvedBackupId,
            approvedBackupChecksum: args.approvedBackupChecksum,
            goNoGoApprovedAt: now,
          }
        : {}),
    });
    await writeControlAuditEvent(ctx, {
      actor: args.actor,
      action: "system.transition",
      targetType: "systemState",
      targetId: state._id,
      cutoverRunId: state.cutoverRunId,
      metadata: {
        fromStage: state.cutoverStage,
        toStage: args.nextStage,
        applicationWriteMode,
      },
    });
    return {
      cutoverStage: args.nextStage,
      applicationWriteMode,
    };
  },
});
