import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { internalMigrationMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  IDENTITY_RECONCILIATION_OPERATIONS,
} from "./constants.js";
import {
  normalizeEmail,
  normalizeLookupKey,
} from "./normalize.js";
import {
  getMigrationCheckpoint,
  getReconciliationDomainRun,
  reconciliationCheckpointResult,
  requireMigrationBatchSize,
  requireMigrationOperation,
  saveMigrationCheckpoint,
  writeReconciliationBatchAudit,
} from "./runtime.js";

const DOMAIN = "identity";
const reconciliationResultValidator = v.object({
  operation: v.string(),
  status: v.union(
    v.literal("running"),
    v.literal("completed"),
  ),
  checkedCount: v.number(),
});
type DatabaseContext = Pick<MutationCtx, "db">;

async function verifyUser(
  ctx: DatabaseContext,
  row: Doc<"migrationRawUsers">,
): Promise<void> {
  const canonical = await ctx.db
    .query("users")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", row.legacyId),
    )
    .unique();
  const normalizedEmail =
    row.email === undefined ? undefined : normalizeEmail(row.email);
  if (
    canonical?.name !== row.name ||
    canonical?.email !== row.email ||
    canonical?.normalizedEmail !== normalizedEmail ||
    canonical?.emailVerifiedAt !== row.emailVerifiedAt ||
    canonical?.image !== row.image ||
    canonical?.status !== "active"
  ) {
    domainError(
      "CONFLICT",
      "Identity reconciliation found a user mismatch.",
    );
  }
}

async function verifyRole(
  ctx: DatabaseContext,
  row: Doc<"migrationRawRoles">,
): Promise<void> {
  const canonical = await ctx.db
    .query("roles")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", row.legacyId),
    )
    .unique();
  const normalizedName = normalizeLookupKey(row.name, "Role name");
  const expectedPermissions = row.admin ? ["admin"] : [];
  if (
    canonical?.name !== row.name ||
    canonical.description !== row.description ||
    canonical.normalizedName !== normalizedName ||
    canonical.admin !== row.admin ||
    canonical.permissions.length !== expectedPermissions.length ||
    !canonical.permissions.every(
      (permission, index) =>
        permission === expectedPermissions[index],
    )
  ) {
    domainError(
      "CONFLICT",
      "Identity reconciliation found a role mismatch.",
    );
  }
}

async function verifyUserRole(
  ctx: DatabaseContext,
  row: Doc<"migrationRawUserRoles">,
): Promise<void> {
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
  const canonical = await ctx.db
    .query("userRoles")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", row.legacyId),
    )
    .unique();
  if (
    !user ||
    !role ||
    canonical?.userId !== user._id ||
    canonical.roleId !== role._id
  ) {
    domainError(
      "CONFLICT",
      "Identity reconciliation found a user-role mismatch.",
    );
  }
}

export const reconcileUsersBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: reconciliationResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      IDENTITY_RECONCILIATION_OPERATIONS.users,
    );
    requireMigrationBatchSize(args.batchSize);
    const runId = ctx.systemState.cutoverRunId;
    await getReconciliationDomainRun(ctx, {
      runId,
      domain: DOMAIN,
    });
    const previous = await getMigrationCheckpoint(
      ctx,
      runId,
      IDENTITY_RECONCILIATION_OPERATIONS.users,
    );
    if (previous?.status === "completed") {
      return reconciliationCheckpointResult(previous);
    }
    const rows = await ctx.db
      .query("migrationRawUsers")
      .withIndex("by_runId_and_legacyId", (query) => {
        const range = query.eq("runId", runId);
        return previous?.lastLegacyKey === undefined
          ? range
          : range.gt("legacyId", previous.lastLegacyKey);
      })
      .take(args.batchSize + 1);
    const batch = rows.slice(0, args.batchSize);
    const completed = rows.length <= args.batchSize;
    for (const row of batch) {
      await verifyUser(ctx, row);
    }
    const lastRow = batch.at(-1);
    const checkpoint = await saveMigrationCheckpoint(ctx, {
      runId,
      operation: IDENTITY_RECONCILIATION_OPERATIONS.users,
      previous,
      ...(lastRow === undefined
        ? {}
        : { lastLegacyKey: lastRow.legacyId }),
      processedThisBatch: batch.length,
      insertedThisBatch: 0,
      reusedThisBatch: batch.length,
      completed,
    });
    await writeReconciliationBatchAudit(ctx, {
      runId,
      domain: DOMAIN,
      operation: IDENTITY_RECONCILIATION_OPERATIONS.users,
      checkedThisBatch: batch.length,
      completed,
    });
    return reconciliationCheckpointResult(checkpoint);
  },
});

export const reconcileRolesBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: reconciliationResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      IDENTITY_RECONCILIATION_OPERATIONS.roles,
    );
    requireMigrationBatchSize(args.batchSize);
    const runId = ctx.systemState.cutoverRunId;
    await getReconciliationDomainRun(ctx, {
      runId,
      domain: DOMAIN,
    });
    const previous = await getMigrationCheckpoint(
      ctx,
      runId,
      IDENTITY_RECONCILIATION_OPERATIONS.roles,
    );
    if (previous?.status === "completed") {
      return reconciliationCheckpointResult(previous);
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
        "CONFLICT",
        "The role reconciliation checkpoint cursor is invalid.",
      );
    }
    const rows = await ctx.db
      .query("migrationRawRoles")
      .withIndex("by_runId_and_legacyId", (query) => {
        const range = query.eq("runId", runId);
        return lastLegacyId === undefined
          ? range
          : range.gt("legacyId", lastLegacyId);
      })
      .take(args.batchSize + 1);
    const batch = rows.slice(0, args.batchSize);
    const completed = rows.length <= args.batchSize;
    for (const row of batch) {
      await verifyRole(ctx, row);
    }
    const lastRow = batch.at(-1);
    const checkpoint = await saveMigrationCheckpoint(ctx, {
      runId,
      operation: IDENTITY_RECONCILIATION_OPERATIONS.roles,
      previous,
      ...(lastRow === undefined
        ? {}
        : { lastLegacyKey: String(lastRow.legacyId) }),
      processedThisBatch: batch.length,
      insertedThisBatch: 0,
      reusedThisBatch: batch.length,
      completed,
    });
    await writeReconciliationBatchAudit(ctx, {
      runId,
      domain: DOMAIN,
      operation: IDENTITY_RECONCILIATION_OPERATIONS.roles,
      checkedThisBatch: batch.length,
      completed,
    });
    return reconciliationCheckpointResult(checkpoint);
  },
});

export const reconcileUserRolesBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: reconciliationResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      IDENTITY_RECONCILIATION_OPERATIONS.userRoles,
    );
    requireMigrationBatchSize(args.batchSize);
    const runId = ctx.systemState.cutoverRunId;
    await getReconciliationDomainRun(ctx, {
      runId,
      domain: DOMAIN,
    });
    const previous = await getMigrationCheckpoint(
      ctx,
      runId,
      IDENTITY_RECONCILIATION_OPERATIONS.userRoles,
    );
    if (previous?.status === "completed") {
      return reconciliationCheckpointResult(previous);
    }
    const rows = await ctx.db
      .query("migrationRawUserRoles")
      .withIndex("by_runId_and_legacyId", (query) => {
        const range = query.eq("runId", runId);
        return previous?.lastLegacyKey === undefined
          ? range
          : range.gt("legacyId", previous.lastLegacyKey);
      })
      .take(args.batchSize + 1);
    const batch = rows.slice(0, args.batchSize);
    const completed = rows.length <= args.batchSize;
    for (const row of batch) {
      await verifyUserRole(ctx, row);
    }
    const lastRow = batch.at(-1);
    const checkpoint = await saveMigrationCheckpoint(ctx, {
      runId,
      operation: IDENTITY_RECONCILIATION_OPERATIONS.userRoles,
      previous,
      ...(lastRow === undefined
        ? {}
        : { lastLegacyKey: lastRow.legacyId }),
      processedThisBatch: batch.length,
      insertedThisBatch: 0,
      reusedThisBatch: batch.length,
      completed,
    });
    await writeReconciliationBatchAudit(ctx, {
      runId,
      domain: DOMAIN,
      operation: IDENTITY_RECONCILIATION_OPERATIONS.userRoles,
      checkedThisBatch: batch.length,
      completed,
    });
    return reconciliationCheckpointResult(checkpoint);
  },
});

export const finishIdentityReconciliation =
  internalMigrationMutation({
    args: {},
    returns: v.object({
      runId: v.string(),
      status: v.literal("reconciled"),
      users: v.number(),
      roles: v.number(),
      userRoles: v.number(),
    }),
    handler: async (ctx) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        IDENTITY_RECONCILIATION_OPERATIONS.finish,
      );
      const runId = ctx.systemState.cutoverRunId;
      const { domainRun } = await getReconciliationDomainRun(ctx, {
        runId,
        domain: DOMAIN,
      });
      const users = await getMigrationCheckpoint(
        ctx,
        runId,
        IDENTITY_RECONCILIATION_OPERATIONS.users,
      );
      const roles = await getMigrationCheckpoint(
        ctx,
        runId,
        IDENTITY_RECONCILIATION_OPERATIONS.roles,
      );
      const userRoles = await getMigrationCheckpoint(
        ctx,
        runId,
        IDENTITY_RECONCILIATION_OPERATIONS.userRoles,
      );
      if (
        users?.status !== "completed" ||
        roles?.status !== "completed" ||
        userRoles?.status !== "completed"
      ) {
        domainError(
          "CONFLICT",
          "Every identity reconciliation checkpoint must be complete.",
        );
      }
      if (
        users.reusedCount !== domainRun.expectedCounts.users ||
        roles.reusedCount !== domainRun.expectedCounts.roles ||
        userRoles.reusedCount !==
          domainRun.expectedCounts.userRoles
      ) {
        domainError(
          "CONFLICT",
          "Identity reconciliation counts do not match source expectations.",
        );
      }
      if (domainRun.status !== "reconciled") {
        await ctx.db.patch("migrationDomainRuns", domainRun._id, {
          status: "reconciled",
          updatedAt: Date.now(),
        });
        await writeAuditEvent(ctx, {
          actor: ctx.actor,
          action: "migration.identity.reconciled",
          targetType: "migrationDomainRun",
          targetId: domainRun._id,
          cutoverRunId: runId,
          metadata: {
            users: users.reusedCount,
            roles: roles.reusedCount,
            userRoles: userRoles.reusedCount,
          },
        });
      }
      return {
        runId,
        status: "reconciled" as const,
        users: users.reusedCount,
        roles: roles.reusedCount,
        userRoles: userRoles.reusedCount,
      };
    },
  });
