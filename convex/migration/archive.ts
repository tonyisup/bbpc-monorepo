import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { internalMigrationMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  ARCHIVE_OPERATIONS,
} from "./constants.js";
import {
  getActiveDomainRun,
  getMigrationCheckpoint,
  migrationCheckpointResult,
  requireCompletedMigrationCheckpoint,
  requireMigrationBatchSize,
  requireMigrationCount,
  requireMigrationOperation,
  requireReconciledDomain,
  saveMigrationCheckpoint,
  startDomainRun,
  writeMigrationBatchAudit,
} from "./runtime.js";

const DOMAIN = "archive";
const checkpointResultValidator = v.object({
  operation: v.string(),
  status: v.union(
    v.literal("running"),
    v.literal("completed"),
  ),
  processedCount: v.number(),
  insertedCount: v.number(),
  reusedCount: v.number(),
});
const runStatusValidator = v.union(
  v.literal("running"),
  v.literal("transformed"),
  v.literal("reconciled"),
  v.literal("failed"),
);
type DatabaseContext = Pick<MutationCtx, "db">;
type UpsertOutcome = "inserted" | "reused";

function requireSqlInt(value: number, label: string): void {
  if (
    !Number.isSafeInteger(value) ||
    value < -2_147_483_648 ||
    value > 2_147_483_647
  ) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must fit the SQL int range.`,
    );
  }
}

function normalizeUuid(value: string, label: string): string {
  const normalized = value.toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
      normalized,
    )
  ) {
    domainError("VALIDATION_FAILED", `${label} must be a UUID.`);
  }
  return normalized;
}

async function resolveOptionalEpisodeId(
  ctx: DatabaseContext,
  legacyId: string | undefined,
): Promise<Id<"episodes"> | undefined> {
  if (legacyId === undefined) {
    return undefined;
  }
  const normalized = normalizeUuid(
    legacyId,
    "Archive post episode relationship ID",
  );
  const episode = await ctx.db
    .query("episodes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalized),
    )
    .unique();
  if (!episode) {
    domainError(
      "CONFLICT",
      "An archive post references a missing canonical episode.",
    );
  }
  return episode._id;
}

async function upsertArchivePost(
  ctx: DatabaseContext,
  row: Doc<"migrationRawArchivePosts">,
): Promise<UpsertOutcome> {
  requireSqlInt(row.legacyId, "Archive post legacy ID");
  if (row.legacyId < 1) {
    domainError(
      "VALIDATION_FAILED",
      "Archive post legacy ID must be positive.",
    );
  }
  if (!Number.isFinite(row.postedAt)) {
    domainError(
      "VALIDATION_FAILED",
      "Archive post timestamp must be finite.",
    );
  }
  const episodeId = await resolveOptionalEpisodeId(
    ctx,
    row.episodeLegacyId,
  );
  const existing = await ctx.db
    .query("archivePosts")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", row.legacyId),
    )
    .unique();
  if (existing) {
    const matches =
      existing.postedAt === row.postedAt &&
      existing.content === row.content &&
      existing.title === row.title &&
      existing.episodeId === episodeId;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated archive post conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("archivePosts", {
    legacyId: row.legacyId,
    postedAt: row.postedAt,
    content: row.content,
    title: row.title,
    ...(episodeId === undefined ? {} : { episodeId }),
  });
  return "inserted";
}

export const startArchiveRun = internalMigrationMutation({
  args: {
    sourceSchemaFingerprint: v.string(),
    expectedPosts: v.number(),
  },
  returns: v.object({
    runId: v.string(),
    status: runStatusValidator,
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      ARCHIVE_OPERATIONS.start,
    );
    requireMigrationCount(
      args.expectedPosts,
      "Expected archive post count",
    );
    const runId = ctx.systemState.cutoverRunId;
    await requireReconciledDomain(ctx, {
      runId,
      domain: "episodes",
    });
    const result = await startDomainRun(ctx, {
      runId,
      domain: DOMAIN,
      sourceSchemaFingerprint: args.sourceSchemaFingerprint,
      expectedCounts: { posts: args.expectedPosts },
    });
    if (result.created) {
      await writeAuditEvent(ctx, {
        actor: ctx.actor,
        action: "migration.archive.started",
        targetType: "migrationDomainRun",
        targetId: result.domainRun._id,
        cutoverRunId: result.run.runId,
        metadata: { posts: args.expectedPosts },
      });
    }
    return {
      runId: result.run.runId,
      status: result.domainRun.status,
      created: result.created,
    };
  },
});

export const transformArchivePostsBatch =
  internalMigrationMutation({
    args: { batchSize: v.number() },
    returns: checkpointResultValidator,
    handler: async (ctx, args) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        ARCHIVE_OPERATIONS.posts,
      );
      requireMigrationBatchSize(args.batchSize);
      const runId = ctx.systemState.cutoverRunId;
      await getActiveDomainRun(ctx, {
        runId,
        domain: DOMAIN,
      });
      const previous = await getMigrationCheckpoint(
        ctx,
        runId,
        ARCHIVE_OPERATIONS.posts,
      );
      if (previous?.status === "completed") {
        return migrationCheckpointResult(previous);
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
          "The archive post checkpoint cursor is invalid.",
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
      let insertedThisBatch = 0;
      let reusedThisBatch = 0;
      for (const row of batch) {
        const outcome = await upsertArchivePost(ctx, row);
        if (outcome === "inserted") {
          insertedThisBatch += 1;
        } else {
          reusedThisBatch += 1;
        }
      }
      const lastRow = batch.at(-1);
      const checkpoint = await saveMigrationCheckpoint(ctx, {
        runId,
        operation: ARCHIVE_OPERATIONS.posts,
        previous,
        ...(lastRow === undefined
          ? {}
          : { lastLegacyKey: String(lastRow.legacyId) }),
        processedThisBatch: batch.length,
        insertedThisBatch,
        reusedThisBatch,
        completed,
      });
      await writeMigrationBatchAudit(ctx, {
        runId,
        domain: DOMAIN,
        operation: ARCHIVE_OPERATIONS.posts,
        processedThisBatch: batch.length,
        insertedThisBatch,
        reusedThisBatch,
        completed,
      });
      return migrationCheckpointResult(checkpoint);
    },
  });

export const finishArchiveRun = internalMigrationMutation({
  args: {},
  returns: v.object({
    runId: v.string(),
    status: v.literal("transformed"),
    posts: v.number(),
  }),
  handler: async (ctx) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      ARCHIVE_OPERATIONS.finish,
    );
    const runId = ctx.systemState.cutoverRunId;
    const { domainRun } = await getActiveDomainRun(ctx, {
      runId,
      domain: DOMAIN,
    });
    const checkpoint = await requireCompletedMigrationCheckpoint(
      ctx,
      {
        runId,
        operation: ARCHIVE_OPERATIONS.posts,
      },
    );
    if (domainRun.expectedCounts.posts !== checkpoint.processedCount) {
      domainError(
        "CONFLICT",
        "Archive transform count does not match source expectations.",
      );
    }
    await ctx.db.patch("migrationDomainRuns", domainRun._id, {
      status: "transformed",
      updatedAt: Date.now(),
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "migration.archive.transformed",
      targetType: "migrationDomainRun",
      targetId: domainRun._id,
      cutoverRunId: runId,
      metadata: { posts: checkpoint.processedCount },
    });
    return {
      runId,
      status: "transformed" as const,
      posts: checkpoint.processedCount,
    };
  },
});
