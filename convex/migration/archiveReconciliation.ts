import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { internalMigrationMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  ARCHIVE_RECONCILIATION_OPERATIONS,
} from "./constants.js";
import {
  getMigrationCheckpoint,
  getReconciliationDomainRun,
  reconciliationCheckpointResult,
  requireMigrationBatchSize,
  requireMigrationOperation,
  saveMigrationCheckpoint,
  writeReconciliationBatchAudit,
} from "./runtime.js";

const DOMAIN = "archive";
const reconciliationResultValidator = v.object({
  operation: v.string(),
  status: v.union(
    v.literal("running"),
    v.literal("completed"),
  ),
  checkedCount: v.number(),
});
type DatabaseContext = Pick<MutationCtx, "db">;

async function resolveOptionalEpisodeId(
  ctx: DatabaseContext,
  legacyId: string | undefined,
): Promise<Id<"episodes"> | undefined> {
  if (legacyId === undefined) {
    return undefined;
  }
  const episode = await ctx.db
    .query("episodes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId.toLowerCase()),
    )
    .unique();
  if (!episode) {
    domainError(
      "CONFLICT",
      "Archive reconciliation found a missing episode parent.",
    );
  }
  return episode._id;
}

async function verifyArchivePost(
  ctx: DatabaseContext,
  row: Doc<"migrationRawArchivePosts">,
): Promise<void> {
  const episodeId = await resolveOptionalEpisodeId(
    ctx,
    row.episodeLegacyId,
  );
  const canonical = await ctx.db
    .query("archivePosts")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", row.legacyId),
    )
    .unique();
  if (
    canonical?.postedAt !== row.postedAt ||
    canonical.content !== row.content ||
    canonical.title !== row.title ||
    canonical.episodeId !== episodeId
  ) {
    domainError(
      "CONFLICT",
      "Archive reconciliation found a post mismatch.",
    );
  }
}

export const reconcileArchivePostsBatch =
  internalMigrationMutation({
    args: { batchSize: v.number() },
    returns: reconciliationResultValidator,
    handler: async (ctx, args) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        ARCHIVE_RECONCILIATION_OPERATIONS.posts,
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
        ARCHIVE_RECONCILIATION_OPERATIONS.posts,
      );
      if (previous?.status === "completed") {
        return reconciliationCheckpointResult(previous);
      }
      const previousLegacyId =
        previous?.lastLegacyKey === undefined
          ? undefined
          : Number(previous.lastLegacyKey);
      if (
        previousLegacyId !== undefined &&
        !Number.isSafeInteger(previousLegacyId)
      ) {
        domainError(
          "CONFLICT",
          "The archive reconciliation cursor is invalid.",
        );
      }
      const rows = await ctx.db
        .query("migrationRawArchivePosts")
        .withIndex("by_runId_and_legacyId", (query) =>
          previousLegacyId === undefined
            ? query.eq("runId", runId)
            : query
                .eq("runId", runId)
                .gt("legacyId", previousLegacyId),
        )
        .take(args.batchSize + 1);
      const batch = rows.slice(0, args.batchSize);
      const completed = rows.length <= args.batchSize;
      for (const row of batch) {
        await verifyArchivePost(ctx, row);
      }
      const lastRow = batch.at(-1);
      const checkpoint = await saveMigrationCheckpoint(ctx, {
        runId,
        operation: ARCHIVE_RECONCILIATION_OPERATIONS.posts,
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
        operation: ARCHIVE_RECONCILIATION_OPERATIONS.posts,
        checkedThisBatch: batch.length,
        completed,
      });
      return reconciliationCheckpointResult(checkpoint);
    },
  });

export const finishArchiveReconciliation =
  internalMigrationMutation({
    args: {},
    returns: v.object({
      runId: v.string(),
      status: v.literal("reconciled"),
      posts: v.number(),
    }),
    handler: async (ctx) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        ARCHIVE_RECONCILIATION_OPERATIONS.finish,
      );
      const runId = ctx.systemState.cutoverRunId;
      const { domainRun } = await getReconciliationDomainRun(ctx, {
        runId,
        domain: DOMAIN,
      });
      const checkpoint = await getMigrationCheckpoint(
        ctx,
        runId,
        ARCHIVE_RECONCILIATION_OPERATIONS.posts,
      );
      if (checkpoint?.status !== "completed") {
        domainError(
          "CONFLICT",
          "The archive reconciliation checkpoint must be complete.",
        );
      }
      if (domainRun.expectedCounts.posts !== checkpoint.reusedCount) {
        domainError(
          "CONFLICT",
          "Archive reconciliation count does not match source expectations.",
        );
      }
      if (domainRun.status !== "reconciled") {
        await ctx.db.patch("migrationDomainRuns", domainRun._id, {
          status: "reconciled",
          updatedAt: Date.now(),
        });
        await writeAuditEvent(ctx, {
          actor: ctx.actor,
          action: "migration.archive.reconciled",
          targetType: "migrationDomainRun",
          targetId: domainRun._id,
          cutoverRunId: runId,
          metadata: { posts: checkpoint.reusedCount },
        });
      }
      return {
        runId,
        status: "reconciled" as const,
        posts: checkpoint.reusedCount,
      };
    },
  });
