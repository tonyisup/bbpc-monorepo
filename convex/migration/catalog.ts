import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { internalMigrationMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import { CATALOG_OPERATIONS } from "./constants.js";
import { normalizeLookupKey } from "./normalize.js";
import {
  getActiveDomainRun,
  getMigrationCheckpoint,
  migrationCheckpointResult,
  requireMigrationBatchSize,
  requireMigrationCount,
  requireMigrationOperation,
  saveMigrationCheckpoint,
  startDomainRun,
  writeMigrationBatchAudit,
} from "./runtime.js";

const DOMAIN = "catalog";
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

function normalizeUuid(value: string, label: string): string {
  const normalized = value.toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
      normalized,
    )
  ) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must be a UUID.`,
    );
  }
  return normalized;
}

function requireSmallInt(value: number, label: string): void {
  if (
    !Number.isSafeInteger(value) ||
    value < -32_768 ||
    value > 32_767
  ) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must fit the SQL smallint range.`,
    );
  }
}

function requireInt(value: number, label: string): void {
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

async function upsertMovie(
  ctx: DatabaseContext,
  row: Doc<"migrationRawMovies">,
): Promise<"inserted" | "reused"> {
  const legacyId = normalizeUuid(row.legacyId, "Movie legacy ID");
  requireSmallInt(row.year, "Movie year");
  if (row.tmdbId !== undefined) {
    requireInt(row.tmdbId, "Movie TMDB ID");
  }
  const normalizedTitle = normalizeLookupKey(
    row.title,
    "Movie title",
  );
  const existing = await ctx.db
    .query("movies")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  if (existing) {
    const matches =
      existing.title === row.title &&
      existing.normalizedTitle === normalizedTitle &&
      existing.year === row.year &&
      existing.poster === row.poster &&
      existing.url === row.url &&
      existing.tmdbId === row.tmdbId;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated movie conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("movies", {
    legacyId,
    title: row.title,
    normalizedTitle,
    year: row.year,
    ...(row.poster === undefined ? {} : { poster: row.poster }),
    url: row.url,
    ...(row.tmdbId === undefined ? {} : { tmdbId: row.tmdbId }),
  });
  return "inserted";
}

async function upsertShow(
  ctx: DatabaseContext,
  row: Doc<"migrationRawShows">,
): Promise<"inserted" | "reused"> {
  const legacyId = normalizeUuid(row.legacyId, "Show legacy ID");
  requireSmallInt(row.year, "Show year");
  const normalizedTitle = normalizeLookupKey(
    row.title,
    "Show title",
  );
  const existing = await ctx.db
    .query("shows")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  if (existing) {
    const matches =
      existing.title === row.title &&
      existing.normalizedTitle === normalizedTitle &&
      existing.year === row.year &&
      existing.poster === row.poster &&
      existing.url === row.url;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated show conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("shows", {
    legacyId,
    title: row.title,
    normalizedTitle,
    year: row.year,
    ...(row.poster === undefined ? {} : { poster: row.poster }),
    url: row.url,
  });
  return "inserted";
}

async function upsertTag(
  ctx: DatabaseContext,
  row: Doc<"migrationRawTags">,
): Promise<"inserted" | "reused"> {
  const legacyId = normalizeUuid(row.legacyId, "Tag legacy ID");
  if (!Number.isFinite(row.createdAt)) {
    domainError(
      "VALIDATION_FAILED",
      "Tag creation time must be finite.",
    );
  }
  const normalizedName = normalizeLookupKey(row.name, "Tag name");
  const existing = await ctx.db
    .query("tags")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  const normalizedCollision = await ctx.db
    .query("tags")
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
      "Tag normalization produced a duplicate canonical key.",
    );
  }
  if (existing) {
    const matches =
      existing.name === row.name &&
      existing.normalizedName === normalizedName &&
      existing.description === row.description &&
      existing.createdAt === row.createdAt;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated tag conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("tags", {
    legacyId,
    name: row.name,
    normalizedName,
    ...(row.description === undefined
      ? {}
      : { description: row.description }),
    createdAt: row.createdAt,
  });
  return "inserted";
}

export const startCatalogRun = internalMigrationMutation({
  args: {
    sourceSchemaFingerprint: v.string(),
    expectedMovies: v.number(),
    expectedShows: v.number(),
    expectedTags: v.number(),
  },
  returns: v.object({
    runId: v.string(),
    status: runStatusValidator,
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      CATALOG_OPERATIONS.start,
    );
    requireMigrationCount(args.expectedMovies, "Expected movie count");
    requireMigrationCount(args.expectedShows, "Expected show count");
    requireMigrationCount(args.expectedTags, "Expected tag count");
    const result = await startDomainRun(ctx, {
      runId: ctx.systemState.cutoverRunId,
      domain: DOMAIN,
      sourceSchemaFingerprint: args.sourceSchemaFingerprint,
      expectedCounts: {
        movies: args.expectedMovies,
        shows: args.expectedShows,
        tags: args.expectedTags,
      },
    });
    if (result.created) {
      await writeAuditEvent(ctx, {
        actor: ctx.actor,
        action: "migration.catalog.started",
        targetType: "migrationDomainRun",
        targetId: result.domainRun._id,
        cutoverRunId: result.run.runId,
        metadata: {
          expectedMovies: args.expectedMovies,
          expectedShows: args.expectedShows,
          expectedTags: args.expectedTags,
        },
      });
    }
    return {
      runId: result.run.runId,
      status: result.domainRun.status,
      created: result.created,
    };
  },
});

export const transformMoviesBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: checkpointResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      CATALOG_OPERATIONS.movies,
    );
    requireMigrationBatchSize(args.batchSize);
    const runId = ctx.systemState.cutoverRunId;
    await getActiveDomainRun(ctx, { runId, domain: DOMAIN });
    const previous = await getMigrationCheckpoint(
      ctx,
      runId,
      CATALOG_OPERATIONS.movies,
    );
    if (previous?.status === "completed") {
      return migrationCheckpointResult(previous);
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
    let insertedThisBatch = 0;
    let reusedThisBatch = 0;
    for (const row of batch) {
      const outcome = await upsertMovie(ctx, row);
      if (outcome === "inserted") {
        insertedThisBatch += 1;
      } else {
        reusedThisBatch += 1;
      }
    }
    const lastRow = batch.at(-1);
    const checkpoint = await saveMigrationCheckpoint(ctx, {
      runId,
      operation: CATALOG_OPERATIONS.movies,
      previous,
      ...(lastRow === undefined
        ? {}
        : { lastLegacyKey: lastRow.legacyId }),
      processedThisBatch: batch.length,
      insertedThisBatch,
      reusedThisBatch,
      completed,
    });
    await writeMigrationBatchAudit(ctx, {
      runId,
      domain: DOMAIN,
      operation: CATALOG_OPERATIONS.movies,
      processedThisBatch: batch.length,
      insertedThisBatch,
      reusedThisBatch,
      completed,
    });
    return migrationCheckpointResult(checkpoint);
  },
});

export const transformShowsBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: checkpointResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      CATALOG_OPERATIONS.shows,
    );
    requireMigrationBatchSize(args.batchSize);
    const runId = ctx.systemState.cutoverRunId;
    await getActiveDomainRun(ctx, { runId, domain: DOMAIN });
    const previous = await getMigrationCheckpoint(
      ctx,
      runId,
      CATALOG_OPERATIONS.shows,
    );
    if (previous?.status === "completed") {
      return migrationCheckpointResult(previous);
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
    let insertedThisBatch = 0;
    let reusedThisBatch = 0;
    for (const row of batch) {
      const outcome = await upsertShow(ctx, row);
      if (outcome === "inserted") {
        insertedThisBatch += 1;
      } else {
        reusedThisBatch += 1;
      }
    }
    const lastRow = batch.at(-1);
    const checkpoint = await saveMigrationCheckpoint(ctx, {
      runId,
      operation: CATALOG_OPERATIONS.shows,
      previous,
      ...(lastRow === undefined
        ? {}
        : { lastLegacyKey: lastRow.legacyId }),
      processedThisBatch: batch.length,
      insertedThisBatch,
      reusedThisBatch,
      completed,
    });
    await writeMigrationBatchAudit(ctx, {
      runId,
      domain: DOMAIN,
      operation: CATALOG_OPERATIONS.shows,
      processedThisBatch: batch.length,
      insertedThisBatch,
      reusedThisBatch,
      completed,
    });
    return migrationCheckpointResult(checkpoint);
  },
});

export const transformTagsBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: checkpointResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      CATALOG_OPERATIONS.tags,
    );
    requireMigrationBatchSize(args.batchSize);
    const runId = ctx.systemState.cutoverRunId;
    await getActiveDomainRun(ctx, { runId, domain: DOMAIN });
    const previous = await getMigrationCheckpoint(
      ctx,
      runId,
      CATALOG_OPERATIONS.tags,
    );
    if (previous?.status === "completed") {
      return migrationCheckpointResult(previous);
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
    let insertedThisBatch = 0;
    let reusedThisBatch = 0;
    for (const row of batch) {
      const outcome = await upsertTag(ctx, row);
      if (outcome === "inserted") {
        insertedThisBatch += 1;
      } else {
        reusedThisBatch += 1;
      }
    }
    const lastRow = batch.at(-1);
    const checkpoint = await saveMigrationCheckpoint(ctx, {
      runId,
      operation: CATALOG_OPERATIONS.tags,
      previous,
      ...(lastRow === undefined
        ? {}
        : { lastLegacyKey: lastRow.legacyId }),
      processedThisBatch: batch.length,
      insertedThisBatch,
      reusedThisBatch,
      completed,
    });
    await writeMigrationBatchAudit(ctx, {
      runId,
      domain: DOMAIN,
      operation: CATALOG_OPERATIONS.tags,
      processedThisBatch: batch.length,
      insertedThisBatch,
      reusedThisBatch,
      completed,
    });
    return migrationCheckpointResult(checkpoint);
  },
});

export const finishCatalogRun = internalMigrationMutation({
  args: {},
  returns: v.object({
    runId: v.string(),
    status: v.literal("transformed"),
    movies: v.number(),
    shows: v.number(),
    tags: v.number(),
  }),
  handler: async (ctx) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      CATALOG_OPERATIONS.finish,
    );
    const runId = ctx.systemState.cutoverRunId;
    const { domainRun } = await getActiveDomainRun(ctx, {
      runId,
      domain: DOMAIN,
    });
    const movies = await getMigrationCheckpoint(
      ctx,
      runId,
      CATALOG_OPERATIONS.movies,
    );
    const shows = await getMigrationCheckpoint(
      ctx,
      runId,
      CATALOG_OPERATIONS.shows,
    );
    const tags = await getMigrationCheckpoint(
      ctx,
      runId,
      CATALOG_OPERATIONS.tags,
    );
    if (
      movies?.status !== "completed" ||
      shows?.status !== "completed" ||
      tags?.status !== "completed"
    ) {
      domainError(
        "CONFLICT",
        "Every catalog transform checkpoint must be complete.",
      );
    }
    if (
      movies.processedCount !== domainRun.expectedCounts.movies ||
      shows.processedCount !== domainRun.expectedCounts.shows ||
      tags.processedCount !== domainRun.expectedCounts.tags
    ) {
      domainError(
        "CONFLICT",
        "Catalog transform counts do not match source expectations.",
        {
          details: {
            movies: movies.processedCount,
            shows: shows.processedCount,
            tags: tags.processedCount,
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
      action: "migration.catalog.transformed",
      targetType: "migrationDomainRun",
      targetId: domainRun._id,
      cutoverRunId: runId,
      metadata: {
        movies: movies.processedCount,
        shows: shows.processedCount,
        tags: tags.processedCount,
      },
    });
    return {
      runId,
      status: "transformed" as const,
      movies: movies.processedCount,
      shows: shows.processedCount,
      tags: tags.processedCount,
    };
  },
});
