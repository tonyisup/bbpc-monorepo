import { v } from "convex/values";

import { internal } from "../_generated/api.js";
import type { Doc } from "../_generated/dataModel.js";
import {
  adminMutation,
  adminQuery,
  internalControlMutation,
} from "../functions.js";
import {
  findActiveImpersonationSession,
} from "../lib/actors.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";

const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 500;
const MIN_DURATION_MINUTES = 1;
const MAX_DURATION_MINUTES = 60;

const impersonationSessionValidator = v.object({
  id: v.id("impersonationSessions"),
  targetUserId: v.id("users"),
  targetName: v.union(v.string(), v.null()),
  reason: v.string(),
  startedAt: v.number(),
  endsAt: v.number(),
});

function validateReason(reason: string): string {
  const normalized = reason.trim().normalize("NFKC");
  if (
    normalized.length < MIN_REASON_LENGTH ||
    normalized.length > MAX_REASON_LENGTH
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Impersonation requires a reason between 10 and 500 characters.",
    );
  }
  return normalized;
}

function validateDuration(durationMinutes: number): void {
  if (
    !Number.isSafeInteger(durationMinutes) ||
    durationMinutes < MIN_DURATION_MINUTES ||
    durationMinutes > MAX_DURATION_MINUTES
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Impersonation duration must be a whole number from 1 through 60 minutes.",
    );
  }
}

function toSessionResult(
  session: Doc<"impersonationSessions">,
  target: Doc<"users">,
) {
  return {
    id: session._id,
    targetUserId: target._id,
    targetName: target.name ?? null,
    reason: session.reason,
    startedAt: session.startedAt,
    endsAt: session.endsAt,
  };
}

export const current = adminQuery({
  args: {},
  returns: v.union(impersonationSessionValidator, v.null()),
  handler: async (ctx) => {
    const systemState = await ctx.db
      .query("systemState")
      .withIndex("by_singletonKey", (query) =>
        query.eq("singletonKey", "global"),
      )
      .unique();
    if (
      systemState === null ||
      (systemState.cutoverStage !== "S3" &&
        systemState.cutoverStage !== "S4")
    ) {
      return null;
    }
    const session = await findActiveImpersonationSession(
      ctx,
      ctx.actor.authenticatedUser._id,
      Date.now(),
    );
    if (session === null) {
      return null;
    }
    const target = await ctx.db.get(
      "users",
      session.targetUserId,
    );
    if (target === null) {
      domainError(
        "IDENTITY_CONFLICT",
        "The impersonated BBPC account is unavailable.",
      );
    }
    if (target.status !== "active") {
      domainError(
        "ACCOUNT_DISABLED",
        "The impersonated BBPC account is disabled.",
      );
    }
    return toSessionResult(session, target);
  },
});

export const start = adminMutation({
  args: {
    targetUserId: v.id("users"),
    reason: v.string(),
    durationMinutes: v.number(),
  },
  returns: impersonationSessionValidator,
  handler: async (ctx, args) => {
    const reason = validateReason(args.reason);
    validateDuration(args.durationMinutes);
    if (
      args.targetUserId ===
      ctx.actor.authenticatedUser._id
    ) {
      domainError(
        "VALIDATION_FAILED",
        "Administrators cannot impersonate themselves.",
      );
    }
    const target = await ctx.db.get(
      "users",
      args.targetUserId,
    );
    if (target === null) {
      domainError(
        "NOT_FOUND",
        "The requested BBPC account is unavailable.",
      );
    }
    if (target.status !== "active") {
      domainError(
        "ACCOUNT_DISABLED",
        "The requested BBPC account is disabled.",
      );
    }
    const now = Date.now();
    const existing = await findActiveImpersonationSession(
      ctx,
      ctx.actor.authenticatedUser._id,
      now,
    );
    if (existing !== null) {
      domainError(
        "CONFLICT",
        "End the current impersonation session before starting another.",
      );
    }
    const endsAt =
      now + args.durationMinutes * 60 * 1000;
    const sessionId = await ctx.db.insert(
      "impersonationSessions",
      {
        actorUserId: ctx.actor.authenticatedUser._id,
        targetUserId: target._id,
        reason,
        startedAt: now,
        endsAt,
      },
    );
    await ctx.scheduler.runAt(
      endsAt,
      internal.identity.impersonation.expire,
      { sessionId },
    );
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "identity.impersonation.started",
      targetType: "impersonationSession",
      targetId: sessionId,
      cutoverRunId: ctx.systemState.cutoverRunId,
      impersonationSessionId: sessionId,
      metadata: {
        durationMinutes: args.durationMinutes,
      },
    });
    const session = await ctx.db.get(
      "impersonationSessions",
      sessionId,
    );
    if (session === null) {
      throw new Error(
        "The impersonation session was not persisted.",
      );
    }
    return toSessionResult(session, target);
  },
});

export const revoke = adminMutation({
  args: {
    sessionId: v.id("impersonationSessions"),
  },
  returns: v.object({
    revoked: v.boolean(),
    revokedAt: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(
      "impersonationSessions",
      args.sessionId,
    );
    if (
      session?.actorUserId !==
      ctx.actor.authenticatedUser._id
    ) {
      domainError(
        "NOT_FOUND",
        "The impersonation session is unavailable.",
      );
    }
    if (session.revokedAt !== undefined) {
      return {
        revoked: false,
        revokedAt: session.revokedAt,
      };
    }
    const revokedAt = Date.now();
    await ctx.db.patch(
      "impersonationSessions",
      session._id,
      { revokedAt, revokedBy: ctx.actor.authenticatedUser._id },
    );
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "identity.impersonation.revoked",
      targetType: "impersonationSession",
      targetId: session._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      impersonationSessionId: session._id,
    });
    return { revoked: true, revokedAt };
  },
});

export const expire = internalControlMutation({
  args: {
    sessionId: v.id("impersonationSessions"),
  },
  returns: v.object({
    expired: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(
      "impersonationSessions",
      args.sessionId,
    );
    if (
      session === null ||
      session.revokedAt !== undefined ||
      session.endsAt > Date.now()
    ) {
      return { expired: false };
    }
    const systemState = await ctx.db
      .query("systemState")
      .withIndex("by_singletonKey", (query) =>
        query.eq("singletonKey", "global"),
      )
      .unique();
    await ctx.db.patch(
      "impersonationSessions",
      session._id,
      { revokedAt: session.endsAt },
    );
    await writeAuditEvent(ctx, {
      actor: {
        kind: "internal",
        label: "impersonation-expiry",
      },
      action: "identity.impersonation.expired",
      targetType: "impersonationSession",
      targetId: session._id,
      impersonationSessionId: session._id,
      ...(systemState === null
        ? {}
        : { cutoverRunId: systemState.cutoverRunId }),
    });
    return { expired: true };
  },
});
