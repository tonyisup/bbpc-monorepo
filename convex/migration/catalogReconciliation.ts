import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { internalMigrationMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  CATALOG_RECONCILIATION_OPERATIONS,
} from "./constants.js";
import { normalizeLookupKey } from "./normalize.js";
import {
  getMigrationCheckpoint,
  getReconciliationDomainRun,
  reconciliationCheckpointResult,
  requireMigrationBatchSize,
  requireMigrationOperation,
  saveMigrationCheckpoint,
  writeReconciliationBatchAudit,
} from "./runtime.js";

const DOMAIN = "catalog";
const reconciliationResultValidator = v.object({
  operation: v.string(),
  status: v.union(
    v.literal("running"),
    v.literal("completed"),
  ),
  checkedCount: v.number(),
});
type DatabaseContext = Pick<MutationCtx, "db">;

function normalizeUuid(value: string): string {
  return value.toLowerCase();
}

async function verifyMovie(
  ctx: DatabaseContext,
  row: Doc<"migrationRawMovies">,
): Promise<void> {
  const legacyId = normalizeUuid(row.legacyId);
  const canonical = await ctx.db
    .query("movies")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  const normalizedTitle = normalizeLookupKey(
    row.title,
    "Movie title",
  );
  if (
    canonical?.title !== row.title ||
    canonical.normalizedTitle !== normalizedTitle ||
    canonical.year !== row.year ||
    canonical.poster !== row.poster ||
    canonical.url !== row.url ||
    canonical.tmdbId !== row.tmdbId
  ) {
    domainError(
      "CONFLICT",
      "Catalog reconciliation found a movie mismatch.",
    );
  }
}

async function verifyShow(
  ctx: DatabaseContext,
  row: Doc<"migrationRawShows">,
): Promise<void> {
  const legacyId = normalizeUuid(row.legacyId);
  const canonical = await ctx.db
    .query("shows")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  const normalizedTitle = normalizeLookupKey(
    row.title,
    "Show title",
  );
  if (
    canonical?.title !== row.title ||
    canonical.normalizedTitle !== normalizedTitle ||
    canonical.year !== row.year ||
    canonical.poster !== row.poster ||
    canonical.url !== row.url
  ) {
    domainError(
      "CONFLICT",
      "Catalog reconciliation found a show mismatch.",
    );
  }
}

async function verifyTag(
  ctx: DatabaseContext,
  row: Doc<"migrationRawTags">,
): Promise<void> {
  const legacyId = normalizeUuid(row.legacyId);
  const canonical = await ctx.db
    .query("tags")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  const normalizedName = normalizeLookupKey(row.name, "Tag name");
  if (
    canonical?.name !== row.name ||
    canonical.normalizedName !== normalizedName ||
    canonical.description !== row.description ||
    canonical.createdAt !== row.createdAt
  ) {
    domainError(
      "CONFLICT",
      "Catalog reconciliation found a tag mismatch.",
    );
  }
}

export const reconcileMoviesBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: reconciliationResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      CATALOG_RECONCILIATION_OPERATIONS.movies,
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
      CATALOG_RECONCILIATION_OPERATIONS.movies,
    );
    if (previous?.status === "completed") {
      return reconciliationCheckpointResult(previous);
    }
    const rows = await ctx.db
      .query("migrationRawMovies")
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
      await verifyMovie(ctx, row);
    }
    const lastRow = batch.at(-1);
    const checkpoint = await saveMigrationCheckpoint(ctx, {
      runId,
      operation: CATALOG_RECONCILIATION_OPERATIONS.movies,
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
      operation: CATALOG_RECONCILIATION_OPERATIONS.movies,
      checkedThisBatch: batch.length,
      completed,
    });
    return reconciliationCheckpointResult(checkpoint);
  },
});

export const reconcileShowsBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: reconciliationResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      CATALOG_RECONCILIATION_OPERATIONS.shows,
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
      CATALOG_RECONCILIATION_OPERATIONS.shows,
    );
    if (previous?.status === "completed") {
      return reconciliationCheckpointResult(previous);
    }
    const rows = await ctx.db
      .query("migrationRawShows")
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
      await verifyShow(ctx, row);
    }
    const lastRow = batch.at(-1);
    const checkpoint = await saveMigrationCheckpoint(ctx, {
      runId,
      operation: CATALOG_RECONCILIATION_OPERATIONS.shows,
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
      operation: CATALOG_RECONCILIATION_OPERATIONS.shows,
      checkedThisBatch: batch.length,
      completed,
    });
    return reconciliationCheckpointResult(checkpoint);
  },
});

export const reconcileTagsBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: reconciliationResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      CATALOG_RECONCILIATION_OPERATIONS.tags,
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
      CATALOG_RECONCILIATION_OPERATIONS.tags,
    );
    if (previous?.status === "completed") {
      return reconciliationCheckpointResult(previous);
    }
    const rows = await ctx.db
      .query("migrationRawTags")
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
      await verifyTag(ctx, row);
    }
    const lastRow = batch.at(-1);
    const checkpoint = await saveMigrationCheckpoint(ctx, {
      runId,
      operation: CATALOG_RECONCILIATION_OPERATIONS.tags,
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
      operation: CATALOG_RECONCILIATION_OPERATIONS.tags,
      checkedThisBatch: batch.length,
      completed,
    });
    return reconciliationCheckpointResult(checkpoint);
  },
});

export const finishCatalogReconciliation =
  internalMigrationMutation({
    args: {},
    returns: v.object({
      runId: v.string(),
      status: v.literal("reconciled"),
      movies: v.number(),
      shows: v.number(),
      tags: v.number(),
    }),
    handler: async (ctx) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        CATALOG_RECONCILIATION_OPERATIONS.finish,
      );
      const runId = ctx.systemState.cutoverRunId;
      const { domainRun } = await getReconciliationDomainRun(ctx, {
        runId,
        domain: DOMAIN,
      });
      const movies = await getMigrationCheckpoint(
        ctx,
        runId,
        CATALOG_RECONCILIATION_OPERATIONS.movies,
      );
      const shows = await getMigrationCheckpoint(
        ctx,
        runId,
        CATALOG_RECONCILIATION_OPERATIONS.shows,
      );
      const tags = await getMigrationCheckpoint(
        ctx,
        runId,
        CATALOG_RECONCILIATION_OPERATIONS.tags,
      );
      if (
        movies?.status !== "completed" ||
        shows?.status !== "completed" ||
        tags?.status !== "completed"
      ) {
        domainError(
          "CONFLICT",
          "Every catalog reconciliation checkpoint must be complete.",
        );
      }
      if (
        movies.reusedCount !== domainRun.expectedCounts.movies ||
        shows.reusedCount !== domainRun.expectedCounts.shows ||
        tags.reusedCount !== domainRun.expectedCounts.tags
      ) {
        domainError(
          "CONFLICT",
          "Catalog reconciliation counts do not match source expectations.",
        );
      }
      if (domainRun.status !== "reconciled") {
        await ctx.db.patch("migrationDomainRuns", domainRun._id, {
          status: "reconciled",
          updatedAt: Date.now(),
        });
        await writeAuditEvent(ctx, {
          actor: ctx.actor,
          action: "migration.catalog.reconciled",
          targetType: "migrationDomainRun",
          targetId: domainRun._id,
          cutoverRunId: runId,
          metadata: {
            movies: movies.reusedCount,
            shows: shows.reusedCount,
            tags: tags.reusedCount,
          },
        });
      }
      return {
        runId,
        status: "reconciled" as const,
        movies: movies.reusedCount,
        shows: shows.reusedCount,
        tags: tags.reusedCount,
      };
    },
  });
