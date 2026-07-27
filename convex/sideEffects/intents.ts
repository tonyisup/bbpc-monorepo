import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import { internal } from "../_generated/api.js";
import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import {
  adminMutation,
  adminQuery,
  internalAppMutation,
} from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  retryDelayForAttempt,
  SIDE_EFFECT_LEASE_MS,
  SIDE_EFFECT_MAX_ATTEMPTS,
  SIDE_EFFECT_MAX_PROVIDER_KEY_LENGTH,
  SIDE_EFFECT_OPERATION,
  sideEffectErrorCodeValidator,
  type SideEffectResourceType,
  sideEffectResourceTypeValidator,
  sideEffectStatusValidator,
} from "./constants.js";

type IntentMutationCtx = Pick<MutationCtx, "db" | "scheduler">;

const sideEffectIntentSummaryValidator = v.object({
  id: v.id("sideEffectIntents"),
  operation: v.literal(SIDE_EFFECT_OPERATION),
  resourceType: sideEffectResourceTypeValidator,
  resourceId: v.string(),
  status: sideEffectStatusValidator,
  attemptCount: v.number(),
  nextAttemptAt: v.union(v.number(), v.null()),
  lastAttemptAt: v.union(v.number(), v.null()),
  lastErrorCode: v.union(v.string(), v.null()),
  completedAt: v.union(v.number(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

function toIntentSummary(intent: Doc<"sideEffectIntents">) {
  return {
    id: intent._id,
    operation: intent.operation,
    resourceType: intent.resourceType,
    resourceId: intent.resourceId,
    status: intent.status,
    attemptCount: intent.attemptCount,
    nextAttemptAt: intent.nextAttemptAt ?? null,
    lastAttemptAt: intent.lastAttemptAt ?? null,
    lastErrorCode: intent.lastErrorCode ?? null,
    completedAt: intent.completedAt ?? null,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
  };
}

function idempotencyKey(
  resourceType: SideEffectResourceType,
  resourceId: string,
): string {
  return `${SIDE_EFFECT_OPERATION}:${resourceType}:${resourceId}`;
}

function validateProviderKey(providerKey: string): void {
  if (
    providerKey.trim().length === 0 ||
    providerKey.length > SIDE_EFFECT_MAX_PROVIDER_KEY_LENGTH
  ) {
    domainError(
      "VALIDATION_FAILED",
      `External file keys must contain 1 through ${String(SIDE_EFFECT_MAX_PROVIDER_KEY_LENGTH)} characters.`,
    );
  }
}

async function scheduleDispatch(
  ctx: Pick<MutationCtx, "scheduler">,
  input: {
    intentId: Id<"sideEffectIntents">;
    cutoverRunId: string;
    clientApiVersion: string;
    delayMs: number;
  },
): Promise<void> {
  await ctx.scheduler.runAfter(
    input.delayMs,
    internal.sideEffects.dispatcher.dispatchUploadThingDelete,
    {
      intentId: input.intentId,
      cutoverRunId: input.cutoverRunId,
      clientApiVersion: input.clientApiVersion,
    },
  );
}

export async function findUploadThingDeleteIntent(
  ctx: Pick<MutationCtx, "db">,
  input: {
    resourceType: SideEffectResourceType;
    resourceId: string;
  },
): Promise<Doc<"sideEffectIntents"> | null> {
  return await ctx.db
    .query("sideEffectIntents")
    .withIndex("by_idempotencyKey", (query) =>
      query.eq(
        "idempotencyKey",
        idempotencyKey(input.resourceType, input.resourceId),
      ),
    )
    .unique();
}

export async function enqueueUploadThingDelete(
  ctx: IntentMutationCtx,
  input: {
    resourceType: SideEffectResourceType;
    resourceId: string;
    providerKey: string;
    requestedByUserId: Id<"users">;
    effectiveUserId?: Id<"users">;
    cutoverRunId: string;
    clientApiVersion: string;
  },
): Promise<{
  intent: Doc<"sideEffectIntents">;
  created: boolean;
}> {
  validateProviderKey(input.providerKey);
  const existing = await findUploadThingDeleteIntent(ctx, input);
  if (existing !== null) {
    if (
      existing.providerKey !== input.providerKey ||
      existing.cutoverRunId !== input.cutoverRunId ||
      existing.requestedByUserId !== input.requestedByUserId ||
      existing.effectiveUserId !== input.effectiveUserId
    ) {
      domainError(
        "CONFLICT",
        "The external cleanup request conflicts with an existing intent.",
      );
    }
    return { intent: existing, created: false };
  }

  const now = Date.now();
  const intentId = await ctx.db.insert("sideEffectIntents", {
    operation: SIDE_EFFECT_OPERATION,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    idempotencyKey: idempotencyKey(
      input.resourceType,
      input.resourceId,
    ),
    providerKey: input.providerKey,
    status: "pending",
    requestedByUserId: input.requestedByUserId,
    ...(input.effectiveUserId === undefined
      ? {}
      : { effectiveUserId: input.effectiveUserId }),
    cutoverRunId: input.cutoverRunId,
    attemptCount: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await scheduleDispatch(ctx, {
    intentId,
    cutoverRunId: input.cutoverRunId,
    clientApiVersion: input.clientApiVersion,
    delayMs: 0,
  });
  const intent = await ctx.db.get("sideEffectIntents", intentId);
  if (intent === null) {
    throw new Error("Created side-effect intent is unavailable");
  }
  return { intent, created: true };
}

const claimResultValidator = v.union(
  v.object({
    dispatch: v.literal(false),
    status: sideEffectStatusValidator,
  }),
  v.object({
    dispatch: v.literal(true),
    providerKey: v.string(),
    attemptCount: v.number(),
  }),
);

export const claimUploadThingDelete = internalAppMutation({
  args: { intentId: v.id("sideEffectIntents") },
  returns: claimResultValidator,
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(
      "sideEffectIntents",
      args.intentId,
    );
    if (intent === null) {
      domainError(
        "NOT_FOUND",
        "The side-effect intent is unavailable.",
      );
    }
    if (intent.cutoverRunId !== ctx.systemState.cutoverRunId) {
      domainError(
        "CONFLICT",
        "The side-effect intent belongs to another cutover run.",
      );
    }
    const now = Date.now();
    if (
      intent.status === "succeeded" ||
      intent.status === "terminal" ||
      (intent.status === "processing" &&
        (intent.leaseExpiresAt ?? 0) > now) ||
      ((intent.status === "pending" ||
        intent.status === "retryScheduled") &&
        (intent.nextAttemptAt ?? 0) > now)
    ) {
      return { dispatch: false as const, status: intent.status };
    }
    const attemptCount = intent.attemptCount + 1;
    await ctx.db.patch("sideEffectIntents", intent._id, {
      status: "processing",
      attemptCount,
      lastAttemptAt: now,
      leaseExpiresAt: now + SIDE_EFFECT_LEASE_MS,
      nextAttemptAt: undefined,
      updatedAt: now,
    });
    return {
      dispatch: true as const,
      providerKey: intent.providerKey,
      attemptCount,
    };
  },
});

export const recordUploadThingDeleteSuccess =
  internalAppMutation({
    args: {
      intentId: v.id("sideEffectIntents"),
      attemptCount: v.number(),
    },
    returns: sideEffectStatusValidator,
    handler: async (ctx, args) => {
      const intent = await ctx.db.get(
        "sideEffectIntents",
        args.intentId,
      );
      if (intent === null) {
        domainError(
          "NOT_FOUND",
          "The side-effect intent is unavailable.",
        );
      }
      if (intent.cutoverRunId !== ctx.systemState.cutoverRunId) {
        domainError(
          "CONFLICT",
          "The side-effect intent belongs to another cutover run.",
        );
      }
      if (intent.status === "succeeded") {
        return "succeeded" as const;
      }
      if (
        intent.status !== "processing" ||
        intent.attemptCount !== args.attemptCount
      ) {
        domainError(
          "CONFLICT",
          "The side-effect attempt changed before completion.",
        );
      }
      const now = Date.now();
      await ctx.db.patch("sideEffectIntents", intent._id, {
        status: "succeeded",
        completedAt: now,
        leaseExpiresAt: undefined,
        nextAttemptAt: undefined,
        lastErrorCode: undefined,
        updatedAt: now,
      });
      await writeAuditEvent(ctx, {
        actor: ctx.actor,
        action: "sideEffects.uploadThingDelete.succeeded",
        targetType: "sideEffectIntent",
        targetId: intent._id,
        cutoverRunId: intent.cutoverRunId,
        metadata: { attemptCount: args.attemptCount },
      });
      return "succeeded" as const;
    },
  });

export const recordUploadThingDeleteFailure =
  internalAppMutation({
    args: {
      intentId: v.id("sideEffectIntents"),
      attemptCount: v.number(),
      errorCode: sideEffectErrorCodeValidator,
      retryable: v.boolean(),
    },
    returns: v.object({
      status: sideEffectStatusValidator,
      nextAttemptAt: v.union(v.number(), v.null()),
    }),
    handler: async (ctx, args) => {
      const intent = await ctx.db.get(
        "sideEffectIntents",
        args.intentId,
      );
      if (intent === null) {
        domainError(
          "NOT_FOUND",
          "The side-effect intent is unavailable.",
        );
      }
      if (intent.cutoverRunId !== ctx.systemState.cutoverRunId) {
        domainError(
          "CONFLICT",
          "The side-effect intent belongs to another cutover run.",
        );
      }
      if (
        intent.status !== "processing" ||
        intent.attemptCount !== args.attemptCount
      ) {
        domainError(
          "CONFLICT",
          "The side-effect attempt changed before failure handling.",
        );
      }
      const now = Date.now();
      const shouldRetry =
        args.retryable &&
        args.attemptCount < SIDE_EFFECT_MAX_ATTEMPTS;
      if (shouldRetry) {
        const delayMs = retryDelayForAttempt(args.attemptCount);
        const nextAttemptAt = now + delayMs;
        await ctx.db.patch("sideEffectIntents", intent._id, {
          status: "retryScheduled",
          nextAttemptAt,
          leaseExpiresAt: undefined,
          lastErrorCode: args.errorCode,
          updatedAt: now,
        });
        await scheduleDispatch(ctx, {
          intentId: intent._id,
          cutoverRunId: intent.cutoverRunId,
          clientApiVersion: ctx.systemState.apiVersion,
          delayMs,
        });
        await writeAuditEvent(ctx, {
          actor: ctx.actor,
          action: "sideEffects.uploadThingDelete.retryScheduled",
          targetType: "sideEffectIntent",
          targetId: intent._id,
          cutoverRunId: intent.cutoverRunId,
          metadata: {
            attemptCount: args.attemptCount,
            errorCode: args.errorCode,
          },
        });
        return {
          status: "retryScheduled" as const,
          nextAttemptAt,
        };
      }

      await ctx.db.patch("sideEffectIntents", intent._id, {
        status: "terminal",
        nextAttemptAt: undefined,
        leaseExpiresAt: undefined,
        lastErrorCode: args.errorCode,
        updatedAt: now,
      });
      await writeAuditEvent(ctx, {
        actor: ctx.actor,
        action: "sideEffects.uploadThingDelete.terminal",
        targetType: "sideEffectIntent",
        targetId: intent._id,
        cutoverRunId: intent.cutoverRunId,
        metadata: {
          attemptCount: args.attemptCount,
          errorCode: args.errorCode,
        },
      });
      return {
        status: "terminal" as const,
        nextAttemptAt: null,
      };
    },
  });

export const list = adminQuery({
  args: {
    status: v.optional(sideEffectStatusValidator),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(
    sideEffectIntentSummaryValidator,
  ),
  handler: async (ctx, args) => {
    const status = args.status;
    const result =
      status === undefined
        ? await ctx.db
            .query("sideEffectIntents")
            .withIndex("by_updatedAt")
            .order("desc")
            .paginate(args.paginationOpts)
        : await ctx.db
            .query("sideEffectIntents")
            .withIndex("by_status_and_nextAttemptAt", (query) =>
              query.eq("status", status),
            )
            .order("desc")
            .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map(toIntentSummary),
    };
  },
});

export const redrive = adminMutation({
  args: {
    id: v.id("sideEffectIntents"),
    expectedStatus: sideEffectStatusValidator,
    expectedUpdatedAt: v.number(),
  },
  returns: sideEffectIntentSummaryValidator,
  handler: async (ctx, args) => {
    const intent = await ctx.db.get("sideEffectIntents", args.id);
    if (intent === null) {
      domainError(
        "NOT_FOUND",
        "The side-effect intent is unavailable.",
      );
    }
    if (
      intent.status !== args.expectedStatus ||
      intent.updatedAt !== args.expectedUpdatedAt
    ) {
      domainError(
        "CONFLICT",
        "The side-effect intent changed after it was loaded.",
      );
    }
    const now = Date.now();
    if (
      intent.status === "processing" &&
      (intent.leaseExpiresAt ?? 0) > now
    ) {
      domainError(
        "CONFLICT",
        "The side-effect intent is still being processed.",
      );
    }
    await ctx.db.patch("sideEffectIntents", intent._id, {
      status: "pending",
      nextAttemptAt: now,
      leaseExpiresAt: undefined,
      lastErrorCode: undefined,
      completedAt: undefined,
      updatedAt: now,
    });
    await scheduleDispatch(ctx, {
      intentId: intent._id,
      cutoverRunId: intent.cutoverRunId,
      clientApiVersion: ctx.systemState.apiVersion,
      delayMs: 0,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "sideEffects.uploadThingDelete.redriven",
      targetType: "sideEffectIntent",
      targetId: intent._id,
      cutoverRunId: intent.cutoverRunId,
      metadata: {
        fromStatus: args.expectedStatus,
        priorAttemptCount: intent.attemptCount,
      },
    });
    const updated = await ctx.db.get(
      "sideEffectIntents",
      intent._id,
    );
    if (updated === null) {
      throw new Error("Redriven side-effect intent is unavailable");
    }
    return toIntentSummary(updated);
  },
});

export function isIntentOwnedBy(
  intent: Doc<"sideEffectIntents">,
  userId: Id<"users">,
): boolean {
  return (
    intent.effectiveUserId === userId ||
    intent.requestedByUserId === userId
  );
}
