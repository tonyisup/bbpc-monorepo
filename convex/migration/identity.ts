import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { internalMigrationMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  IDENTITY_OPERATIONS,
  SOURCE_SCHEMA_FINGERPRINT,
} from "./constants.js";
import {
  normalizeEmail,
  normalizeLookupKey,
} from "./normalize.js";

const runStatusValidator = v.union(
  v.literal("running"),
  v.literal("transformed"),
  v.literal("reconciled"),
  v.literal("failed"),
);
const checkpointStatusValidator = v.union(
  v.literal("running"),
  v.literal("completed"),
);
const checkpointResultValidator = v.object({
  operation: v.string(),
  status: checkpointStatusValidator,
  processedCount: v.number(),
  insertedCount: v.number(),
  reusedCount: v.number(),
});

type DatabaseContext = Pick<MutationCtx, "db">;
type IdentityOperation =
  (typeof IDENTITY_OPERATIONS)[keyof typeof IDENTITY_OPERATIONS];
interface CheckpointSummary {
  operation: string;
  status: "running" | "completed";
  processedCount: number;
  insertedCount: number;
  reusedCount: number;
}
interface IdentityRun {
  run: Doc<"migrationRuns">;
  domainRun: Doc<"migrationDomainRuns">;
}

function requireOperation(
  actual: string,
  expected: IdentityOperation,
): void {
  if (actual !== expected) {
    domainError(
      "VALIDATION_FAILED",
      "The migration operation identifier is invalid.",
      {
        details: {
          expectedOperation: expected,
          receivedOperation: actual,
        },
      },
    );
  }
}

function requireCount(value: number, label: string): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 10_000_000
  ) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must be a non-negative safe integer.`,
    );
  }
}

function requireBatchSize(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    domainError(
      "VALIDATION_FAILED",
      "Migration batch size must be an integer from 1 through 100.",
    );
  }
}

async function getRun(
  ctx: DatabaseContext,
  runId: string,
): Promise<IdentityRun> {
  const run = await ctx.db
    .query("migrationRuns")
    .withIndex("by_runId", (query) => query.eq("runId", runId))
    .unique();
  if (!run) {
    domainError(
      "CONFLICT",
      "The identity migration run has not been started.",
    );
  }
  if (run.sourceSchemaFingerprint !== SOURCE_SCHEMA_FINGERPRINT) {
    domainError(
      "CONFLICT",
      "The migration source schema fingerprint does not match.",
    );
  }
  if (run.status !== "running") {
    domainError(
      "CONFLICT",
      "The identity migration run is not accepting transform batches.",
      { details: { runStatus: run.status } },
    );
  }
  const domainRun = await ctx.db
    .query("migrationDomainRuns")
    .withIndex("by_runId_and_domain", (query) =>
      query.eq("runId", runId).eq("domain", "identity"),
    )
    .unique();
  if (!domainRun) {
    domainError(
      "CONFLICT",
      "The identity domain migration has not been started.",
    );
  }
  if (domainRun.status !== "running") {
    domainError(
      "CONFLICT",
      "The identity domain is not accepting transform batches.",
      { details: { domainStatus: domainRun.status } },
    );
  }
  return { run, domainRun };
}

async function getCheckpoint(
  ctx: DatabaseContext,
  runId: string,
  operation: IdentityOperation,
): Promise<Doc<"migrationCheckpoints"> | null> {
  return await ctx.db
    .query("migrationCheckpoints")
    .withIndex("by_runId_and_operation", (query) =>
      query.eq("runId", runId).eq("operation", operation),
    )
    .unique();
}

async function saveCheckpoint(
  ctx: DatabaseContext,
  input: {
    runId: string;
    operation: IdentityOperation;
    previous: Doc<"migrationCheckpoints"> | null;
    lastLegacyKey?: string;
    processedThisBatch: number;
    insertedThisBatch: number;
    reusedThisBatch: number;
    completed: boolean;
  },
): Promise<CheckpointSummary> {
  const updatedAt = Date.now();
  const values = {
    runId: input.runId,
    operation: input.operation,
    status: input.completed ? ("completed" as const) : ("running" as const),
    processedCount:
      (input.previous?.processedCount ?? 0) +
      input.processedThisBatch,
    insertedCount:
      (input.previous?.insertedCount ?? 0) +
      input.insertedThisBatch,
    reusedCount:
      (input.previous?.reusedCount ?? 0) + input.reusedThisBatch,
    updatedAt,
    ...(input.lastLegacyKey === undefined
      ? {}
      : { lastLegacyKey: input.lastLegacyKey }),
  };

  if (input.previous) {
    await ctx.db.replace(
      "migrationCheckpoints",
      input.previous._id,
      values,
    );
    return values;
  }

  await ctx.db.insert(
    "migrationCheckpoints",
    values,
  );
  return values;
}

function checkpointResult(checkpoint: CheckpointSummary) {
  return {
    operation: checkpoint.operation,
    status: checkpoint.status,
    processedCount: checkpoint.processedCount,
    insertedCount: checkpoint.insertedCount,
    reusedCount: checkpoint.reusedCount,
  };
}

async function writeBatchAudit(
  ctx: Parameters<typeof writeAuditEvent>[0],
  input: {
    runId: string;
    operation: IdentityOperation;
    processedThisBatch: number;
    insertedThisBatch: number;
    reusedThisBatch: number;
    completed: boolean;
  },
): Promise<void> {
  await writeAuditEvent(ctx, {
    actor: {
      kind: "internal",
      label: `migration:${input.operation}`,
    },
    action: "migration.identity.batch",
    targetType: "migrationRun",
    targetId: input.runId,
    cutoverRunId: input.runId,
    metadata: {
      operation: input.operation,
      processed: input.processedThisBatch,
      inserted: input.insertedThisBatch,
      reused: input.reusedThisBatch,
      completed: input.completed,
    },
  });
}

export const startIdentityRun = internalMigrationMutation({
  args: {
    sourceSchemaFingerprint: v.string(),
    expectedUsers: v.number(),
    expectedRoles: v.number(),
    expectedUserRoles: v.number(),
  },
  returns: v.object({
    runId: v.string(),
    status: runStatusValidator,
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    requireOperation(
      ctx.migrationOperationId,
      IDENTITY_OPERATIONS.start,
    );
    requireCount(args.expectedUsers, "Expected user count");
    requireCount(args.expectedRoles, "Expected role count");
    requireCount(args.expectedUserRoles, "Expected user-role count");
    if (args.sourceSchemaFingerprint !== SOURCE_SCHEMA_FINGERPRINT) {
      domainError(
        "CONFLICT",
        "The migration source schema fingerprint does not match the approved census.",
      );
    }

    const runId = ctx.systemState.cutoverRunId;
    const existingRun = await ctx.db
      .query("migrationRuns")
      .withIndex("by_runId", (query) => query.eq("runId", runId))
      .unique();
    if (
      existingRun &&
      (existingRun.sourceSchemaFingerprint !==
        args.sourceSchemaFingerprint ||
        existingRun.status !== "running")
    ) {
      domainError(
        "CONFLICT",
        "The existing migration run is not compatible with the identity source.",
      );
    }
    const existingDomainRun = await ctx.db
      .query("migrationDomainRuns")
      .withIndex("by_runId_and_domain", (query) =>
        query.eq("runId", runId).eq("domain", "identity"),
      )
      .unique();
    if (existingDomainRun) {
      const sameConfiguration =
        existingDomainRun.expectedCounts.users ===
          args.expectedUsers &&
        existingDomainRun.expectedCounts.roles ===
          args.expectedRoles &&
        existingDomainRun.expectedCounts.userRoles ===
          args.expectedUserRoles;
      if (!sameConfiguration) {
        domainError(
          "CONFLICT",
          "The existing migration run has different source expectations.",
        );
      }
      return {
        runId,
        status: existingDomainRun.status,
        created: false,
      };
    }

    const now = Date.now();
    if (!existingRun) {
      await ctx.db.insert("migrationRuns", {
        runId,
        sourceSchemaFingerprint: args.sourceSchemaFingerprint,
        status: "running",
        startedAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.insert("migrationDomainRuns", {
      runId,
      domain: "identity",
      status: "running",
      expectedCounts: {
        users: args.expectedUsers,
        roles: args.expectedRoles,
        userRoles: args.expectedUserRoles,
      },
      startedAt: now,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "migration.identity.started",
      targetType: "migrationRun",
      targetId: runId,
      cutoverRunId: runId,
      metadata: {
        expectedUsers: args.expectedUsers,
        expectedRoles: args.expectedRoles,
        expectedUserRoles: args.expectedUserRoles,
      },
    });
    return { runId, status: "running" as const, created: true };
  },
});

export const transformRolesBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: checkpointResultValidator,
  handler: async (ctx, args) => {
    requireOperation(
      ctx.migrationOperationId,
      IDENTITY_OPERATIONS.roles,
    );
    requireBatchSize(args.batchSize);
    const runId = ctx.systemState.cutoverRunId;
    const { run } = await getRun(ctx, runId);
    const previous = await getCheckpoint(
      ctx,
      runId,
      IDENTITY_OPERATIONS.roles,
    );
    if (previous?.status === "completed") {
      return checkpointResult(previous);
    }

    const lastLegacyId =
      previous?.lastLegacyKey === undefined
        ? undefined
        : Number(previous.lastLegacyKey);
    if (
      lastLegacyId !== undefined &&
      !Number.isSafeInteger(lastLegacyId)
    ) {
      domainError(
        "INTERNAL_ERROR",
        "The role checkpoint cursor is invalid.",
      );
    }
    const rows = await ctx.db
      .query("migrationRawRoles")
      .withIndex("by_runId_and_legacyId", (query) => {
        const runRange = query.eq("runId", runId);
        return lastLegacyId === undefined
          ? runRange
          : runRange.gt("legacyId", lastLegacyId);
      })
      .take(args.batchSize + 1);
    const batch = rows.slice(0, args.batchSize);
    const completed = rows.length <= args.batchSize;
    let insertedThisBatch = 0;
    let reusedThisBatch = 0;

    for (const row of batch) {
      if (
        !Number.isSafeInteger(row.legacyId) ||
        row.legacyId < 0 ||
        row.legacyId > 255
      ) {
        domainError(
          "VALIDATION_FAILED",
          "A legacy role identifier is outside the SQL tinyint range.",
        );
      }
      const normalizedName = normalizeLookupKey(
        row.name,
        "Role name",
      );
      const expectedPermissions = row.admin ? ["admin"] : [];
      const existing = await ctx.db
        .query("roles")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", row.legacyId),
        )
        .unique();
      const normalizedCollision = await ctx.db
        .query("roles")
        .withIndex("by_normalizedName", (query) =>
          query.eq("normalizedName", normalizedName),
        )
        .unique();
      if (
        normalizedCollision &&
        normalizedCollision._id !== existing?._id
      ) {
        domainError(
          "CONFLICT",
          "Role normalization produced a duplicate canonical key.",
        );
      }

      if (existing) {
        const matches =
          existing.name === row.name &&
          existing.normalizedName === normalizedName &&
          existing.description === row.description &&
          existing.admin === row.admin &&
          existing.permissions.length ===
            expectedPermissions.length &&
          existing.permissions.every(
            (permission, index) =>
              permission === expectedPermissions[index],
          );
        if (!matches) {
          domainError(
            "CONFLICT",
            "A migrated role conflicts with its canonical document.",
          );
        }
        reusedThisBatch += 1;
      } else {
        await ctx.db.insert("roles", {
          legacyId: row.legacyId,
          name: row.name,
          normalizedName,
          description: row.description,
          admin: row.admin,
          permissions: expectedPermissions,
          createdAt: run.startedAt,
          updatedAt: run.startedAt,
        });
        insertedThisBatch += 1;
      }
    }

    const lastRow = batch.at(-1);
    const checkpoint = await saveCheckpoint(ctx, {
      runId,
      operation: IDENTITY_OPERATIONS.roles,
      previous,
      ...(lastRow === undefined
        ? {}
        : { lastLegacyKey: String(lastRow.legacyId) }),
      processedThisBatch: batch.length,
      insertedThisBatch,
      reusedThisBatch,
      completed,
    });
    await writeBatchAudit(ctx, {
      runId,
      operation: IDENTITY_OPERATIONS.roles,
      processedThisBatch: batch.length,
      insertedThisBatch,
      reusedThisBatch,
      completed,
    });
    return checkpointResult(checkpoint);
  },
});

export const transformUsersBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: checkpointResultValidator,
  handler: async (ctx, args) => {
    requireOperation(
      ctx.migrationOperationId,
      IDENTITY_OPERATIONS.users,
    );
    requireBatchSize(args.batchSize);
    const runId = ctx.systemState.cutoverRunId;
    const { run } = await getRun(ctx, runId);
    const previous = await getCheckpoint(
      ctx,
      runId,
      IDENTITY_OPERATIONS.users,
    );
    if (previous?.status === "completed") {
      return checkpointResult(previous);
    }

    const rows = await ctx.db
      .query("migrationRawUsers")
      .withIndex("by_runId_and_legacyId", (query) => {
        const runRange = query.eq("runId", runId);
        return previous?.lastLegacyKey === undefined
          ? runRange
          : runRange.gt("legacyId", previous.lastLegacyKey);
      })
      .take(args.batchSize + 1);
    const batch = rows.slice(0, args.batchSize);
    const completed = rows.length <= args.batchSize;
    let insertedThisBatch = 0;
    let reusedThisBatch = 0;

    for (const row of batch) {
      const normalizedEmail =
        row.email === undefined
          ? undefined
          : normalizeEmail(row.email);
      const existing = await ctx.db
        .query("users")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", row.legacyId),
        )
        .unique();
      const emailCollision =
        normalizedEmail === undefined
          ? null
          : await ctx.db
              .query("users")
              .withIndex("by_normalizedEmail", (query) =>
                query.eq("normalizedEmail", normalizedEmail),
              )
              .unique();
      if (emailCollision && emailCollision._id !== existing?._id) {
        domainError(
          "CONFLICT",
          "Email normalization produced multiple canonical user candidates.",
        );
      }

      if (existing) {
        const matches =
          existing.name === row.name &&
          existing.email === row.email &&
          existing.normalizedEmail === normalizedEmail &&
          existing.emailVerifiedAt === row.emailVerifiedAt &&
          existing.image === row.image &&
          existing.status === "active";
        if (!matches) {
          domainError(
            "CONFLICT",
            "A migrated user conflicts with its canonical document.",
          );
        }
        reusedThisBatch += 1;
      } else {
        await ctx.db.insert("users", {
          legacyId: row.legacyId,
          ...(row.name === undefined ? {} : { name: row.name }),
          ...(row.email === undefined ? {} : { email: row.email }),
          ...(normalizedEmail === undefined
            ? {}
            : { normalizedEmail }),
          ...(row.emailVerifiedAt === undefined
            ? {}
            : { emailVerifiedAt: row.emailVerifiedAt }),
          ...(row.image === undefined ? {} : { image: row.image }),
          status: "active",
          createdAt: run.startedAt,
          updatedAt: run.startedAt,
        });
        insertedThisBatch += 1;
      }
    }

    const lastRow = batch.at(-1);
    const checkpoint = await saveCheckpoint(ctx, {
      runId,
      operation: IDENTITY_OPERATIONS.users,
      previous,
      ...(lastRow === undefined
        ? {}
        : { lastLegacyKey: lastRow.legacyId }),
      processedThisBatch: batch.length,
      insertedThisBatch,
      reusedThisBatch,
      completed,
    });
    await writeBatchAudit(ctx, {
      runId,
      operation: IDENTITY_OPERATIONS.users,
      processedThisBatch: batch.length,
      insertedThisBatch,
      reusedThisBatch,
      completed,
    });
    return checkpointResult(checkpoint);
  },
});

export const transformUserRolesBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: checkpointResultValidator,
  handler: async (ctx, args) => {
    requireOperation(
      ctx.migrationOperationId,
      IDENTITY_OPERATIONS.userRoles,
    );
    requireBatchSize(args.batchSize);
    const runId = ctx.systemState.cutoverRunId;
    await getRun(ctx, runId);
    const userCheckpoint = await getCheckpoint(
      ctx,
      runId,
      IDENTITY_OPERATIONS.users,
    );
    const roleCheckpoint = await getCheckpoint(
      ctx,
      runId,
      IDENTITY_OPERATIONS.roles,
    );
    if (
      userCheckpoint?.status !== "completed" ||
      roleCheckpoint?.status !== "completed"
    ) {
      domainError(
        "CONFLICT",
        "Users and roles must finish before user-role links are transformed.",
      );
    }

    const previous = await getCheckpoint(
      ctx,
      runId,
      IDENTITY_OPERATIONS.userRoles,
    );
    if (previous?.status === "completed") {
      return checkpointResult(previous);
    }
    const rows = await ctx.db
      .query("migrationRawUserRoles")
      .withIndex("by_runId_and_legacyId", (query) => {
        const runRange = query.eq("runId", runId);
        return previous?.lastLegacyKey === undefined
          ? runRange
          : runRange.gt("legacyId", previous.lastLegacyKey);
      })
      .take(args.batchSize + 1);
    const batch = rows.slice(0, args.batchSize);
    const completed = rows.length <= args.batchSize;
    let insertedThisBatch = 0;
    let reusedThisBatch = 0;

    for (const row of batch) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", row.userLegacyId),
        )
        .unique();
      const role = await ctx.db
        .query("roles")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", row.roleLegacyId),
        )
        .unique();
      if (!user || !role) {
        domainError(
          "CONFLICT",
          "A user-role relationship references a missing canonical parent.",
        );
      }

      const existing = await ctx.db
        .query("userRoles")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", row.legacyId),
        )
        .unique();
      const relationshipCollision = await ctx.db
        .query("userRoles")
        .withIndex("by_userId_and_roleId", (query) =>
          query.eq("userId", user._id).eq("roleId", role._id),
        )
        .unique();
      if (
        relationshipCollision &&
        relationshipCollision._id !== existing?._id
      ) {
        domainError(
          "CONFLICT",
          "Multiple legacy user-role rows map to one canonical relationship.",
        );
      }

      if (existing) {
        if (
          existing.userId !== user._id ||
          existing.roleId !== role._id
        ) {
          domainError(
            "CONFLICT",
            "A migrated user-role link conflicts with its canonical document.",
          );
        }
        reusedThisBatch += 1;
      } else {
        await ctx.db.insert("userRoles", {
          legacyId: row.legacyId,
          userId: user._id,
          roleId: role._id,
        });
        insertedThisBatch += 1;
      }
    }

    const lastRow = batch.at(-1);
    const checkpoint = await saveCheckpoint(ctx, {
      runId,
      operation: IDENTITY_OPERATIONS.userRoles,
      previous,
      ...(lastRow === undefined
        ? {}
        : { lastLegacyKey: lastRow.legacyId }),
      processedThisBatch: batch.length,
      insertedThisBatch,
      reusedThisBatch,
      completed,
    });
    await writeBatchAudit(ctx, {
      runId,
      operation: IDENTITY_OPERATIONS.userRoles,
      processedThisBatch: batch.length,
      insertedThisBatch,
      reusedThisBatch,
      completed,
    });
    return checkpointResult(checkpoint);
  },
});

export const finishIdentityRun = internalMigrationMutation({
  args: {},
  returns: v.object({
    runId: v.string(),
    status: v.literal("transformed"),
    users: v.number(),
    roles: v.number(),
    userRoles: v.number(),
  }),
  handler: async (ctx) => {
    requireOperation(
      ctx.migrationOperationId,
      IDENTITY_OPERATIONS.finish,
    );
    const runId = ctx.systemState.cutoverRunId;
    const { domainRun } = await getRun(ctx, runId);
    const users = await getCheckpoint(
      ctx,
      runId,
      IDENTITY_OPERATIONS.users,
    );
    const roles = await getCheckpoint(
      ctx,
      runId,
      IDENTITY_OPERATIONS.roles,
    );
    const userRoles = await getCheckpoint(
      ctx,
      runId,
      IDENTITY_OPERATIONS.userRoles,
    );
    if (
      users?.status !== "completed" ||
      roles?.status !== "completed" ||
      userRoles?.status !== "completed"
    ) {
      domainError(
        "CONFLICT",
        "Every identity transform checkpoint must be complete.",
      );
    }
    if (
      users.processedCount !== domainRun.expectedCounts.users ||
      roles.processedCount !== domainRun.expectedCounts.roles ||
      userRoles.processedCount !==
        domainRun.expectedCounts.userRoles
    ) {
      domainError(
        "CONFLICT",
        "Identity transform counts do not match the approved source expectations.",
        {
          details: {
            users: users.processedCount,
            roles: roles.processedCount,
            userRoles: userRoles.processedCount,
          },
        },
      );
    }

    await ctx.db.patch("migrationDomainRuns", domainRun._id, {
      status: "transformed",
      updatedAt: Date.now(),
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "migration.identity.transformed",
      targetType: "migrationRun",
      targetId: runId,
      cutoverRunId: runId,
      metadata: {
        users: users.processedCount,
        roles: roles.processedCount,
        userRoles: userRoles.processedCount,
      },
    });
    return {
      runId,
      status: "transformed" as const,
      users: users.processedCount,
      roles: roles.processedCount,
      userRoles: userRoles.processedCount,
    };
  },
});
