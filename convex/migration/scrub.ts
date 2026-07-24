import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { internalMigrationMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  FOUNDATION_SCRUB_OPERATIONS,
  FOUNDATION_SCRUB_SCOPE,
  SOURCE_SCHEMA_FINGERPRINT,
} from "./constants.js";
import {
  requireMigrationBatchSize,
  requireMigrationOperation,
} from "./runtime.js";

type DatabaseContext = Pick<MutationCtx, "db">;
const scrubBatchResultValidator = v.object({
  deletedThisBatch: v.number(),
  totalDeleted: v.number(),
  done: v.boolean(),
});

async function requireFoundationDomainsReconciled(
  ctx: DatabaseContext,
  runId: string,
): Promise<void> {
  const run = await ctx.db
    .query("migrationRuns")
    .withIndex("by_runId", (query) => query.eq("runId", runId))
    .unique();
  if (
    run?.sourceSchemaFingerprint !== SOURCE_SCHEMA_FINGERPRINT ||
    run.status !== "running"
  ) {
    domainError(
      "CONFLICT",
      "The global migration run is not eligible for raw staging scrub.",
    );
  }
  for (const domain of ["identity", "catalog", "episodes"]) {
    const domainRun = await ctx.db
      .query("migrationDomainRuns")
      .withIndex("by_runId_and_domain", (query) =>
        query.eq("runId", runId).eq("domain", domain),
      )
      .unique();
    if (domainRun?.status !== "reconciled") {
      domainError(
        "CONFLICT",
        `The ${domain} domain must be reconciled before raw staging scrub.`,
      );
    }
  }
}

async function getScrubRun(
  ctx: DatabaseContext,
  runId: string,
): Promise<Doc<"migrationScrubRuns">> {
  const scrubRun = await ctx.db
    .query("migrationScrubRuns")
    .withIndex("by_runId_and_scope", (query) =>
      query.eq("runId", runId).eq("scope", FOUNDATION_SCRUB_SCOPE),
    )
    .unique();
  if (!scrubRun) {
    domainError(
      "CONFLICT",
      "The foundation raw staging scrub has not been started.",
    );
  }
  return scrubRun;
}

async function hasIdentityRowsForRun(
  ctx: DatabaseContext,
  runId: string,
): Promise<boolean> {
  const user = await ctx.db
    .query("migrationRawUsers")
    .withIndex("by_runId_and_legacyId", (query) =>
      query.eq("runId", runId),
    )
    .first();
  const role = await ctx.db
    .query("migrationRawRoles")
    .withIndex("by_runId_and_legacyId", (query) =>
      query.eq("runId", runId),
    )
    .first();
  const link = await ctx.db
    .query("migrationRawUserRoles")
    .withIndex("by_runId_and_legacyId", (query) =>
      query.eq("runId", runId),
    )
    .first();
  return user !== null || role !== null || link !== null;
}

async function hasCatalogRowsForRun(
  ctx: DatabaseContext,
  runId: string,
): Promise<boolean> {
  const movie = await ctx.db
    .query("migrationRawMovies")
    .withIndex("by_runId_and_legacyId", (query) =>
      query.eq("runId", runId),
    )
    .first();
  const show = await ctx.db
    .query("migrationRawShows")
    .withIndex("by_runId_and_legacyId", (query) =>
      query.eq("runId", runId),
    )
    .first();
  const tag = await ctx.db
    .query("migrationRawTags")
    .withIndex("by_runId_and_legacyId", (query) =>
      query.eq("runId", runId),
    )
    .first();
  return movie !== null || show !== null || tag !== null;
}

async function hasEpisodeRowsForRun(
  ctx: DatabaseContext,
  runId: string,
): Promise<boolean> {
  const episode = await ctx.db
    .query("migrationRawEpisodes")
    .withIndex("by_runId_and_legacyId", (query) =>
      query.eq("runId", runId),
    )
    .first();
  const link = await ctx.db
    .query("migrationRawEpisodeLinks")
    .withIndex("by_runId_and_legacyId", (query) =>
      query.eq("runId", runId),
    )
    .first();
  const banger = await ctx.db
    .query("migrationRawBangers")
    .withIndex("by_runId_and_legacyId", (query) =>
      query.eq("runId", runId),
    )
    .first();
  const audio = await ctx.db
    .query("migrationRawEpisodeAudioMessages")
    .withIndex("by_runId_and_legacyId", (query) =>
      query.eq("runId", runId),
    )
    .first();
  return (
    episode !== null ||
    link !== null ||
    banger !== null ||
    audio !== null
  );
}

async function hasAnyRawRows(
  ctx: DatabaseContext,
): Promise<boolean> {
  const checks = [
    await ctx.db
      .query("migrationRawUsers")
      .withIndex("by_runId_and_legacyId")
      .first(),
    await ctx.db
      .query("migrationRawRoles")
      .withIndex("by_runId_and_legacyId")
      .first(),
    await ctx.db
      .query("migrationRawUserRoles")
      .withIndex("by_runId_and_legacyId")
      .first(),
    await ctx.db
      .query("migrationRawMovies")
      .withIndex("by_runId_and_legacyId")
      .first(),
    await ctx.db
      .query("migrationRawShows")
      .withIndex("by_runId_and_legacyId")
      .first(),
    await ctx.db
      .query("migrationRawTags")
      .withIndex("by_runId_and_legacyId")
      .first(),
    await ctx.db
      .query("migrationRawEpisodes")
      .withIndex("by_runId_and_legacyId")
      .first(),
    await ctx.db
      .query("migrationRawEpisodeLinks")
      .withIndex("by_runId_and_legacyId")
      .first(),
    await ctx.db
      .query("migrationRawBangers")
      .withIndex("by_runId_and_legacyId")
      .first(),
    await ctx.db
      .query("migrationRawEpisodeAudioMessages")
      .withIndex("by_runId_and_legacyId")
      .first(),
  ];
  return checks.some((document) => document !== null);
}

export const startFoundationScrub = internalMigrationMutation({
  args: {},
  returns: v.object({
    runId: v.string(),
    scope: v.literal(FOUNDATION_SCRUB_SCOPE),
    status: v.union(v.literal("running"), v.literal("completed")),
    created: v.boolean(),
  }),
  handler: async (ctx) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      FOUNDATION_SCRUB_OPERATIONS.start,
    );
    const runId = ctx.systemState.cutoverRunId;
    await requireFoundationDomainsReconciled(ctx, runId);
    const existing = await ctx.db
      .query("migrationScrubRuns")
      .withIndex("by_runId_and_scope", (query) =>
        query
          .eq("runId", runId)
          .eq("scope", FOUNDATION_SCRUB_SCOPE),
      )
      .unique();
    if (existing) {
      return {
        runId,
        scope: "foundation-v1" as const,
        status: existing.status,
        created: false,
      };
    }
    const now = Date.now();
    const scrubRunId = await ctx.db.insert("migrationScrubRuns", {
      runId,
      scope: FOUNDATION_SCRUB_SCOPE,
      status: "running",
      identityRawRowsDeleted: 0,
      catalogRawRowsDeleted: 0,
      episodeRawRowsDeleted: 0,
      checkpointsDeleted: 0,
      startedAt: now,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "migration.foundationScrub.started",
      targetType: "migrationScrubRun",
      targetId: scrubRunId,
      cutoverRunId: runId,
      metadata: { scope: FOUNDATION_SCRUB_SCOPE },
    });
    return {
      runId,
      scope: "foundation-v1" as const,
      status: "running" as const,
      created: true,
    };
  },
});

export const scrubIdentityRawBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: scrubBatchResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      FOUNDATION_SCRUB_OPERATIONS.identity,
    );
    requireMigrationBatchSize(args.batchSize);
    const runId = ctx.systemState.cutoverRunId;
    await requireFoundationDomainsReconciled(ctx, runId);
    const scrubRun = await getScrubRun(ctx, runId);
    if (scrubRun.status === "completed") {
      return {
        deletedThisBatch: 0,
        totalDeleted: scrubRun.identityRawRowsDeleted,
        done: true,
      };
    }
    let remaining = args.batchSize;
    let deletedThisBatch = 0;
    const users = await ctx.db
      .query("migrationRawUsers")
      .withIndex("by_runId_and_legacyId", (query) =>
        query.eq("runId", runId),
      )
      .take(remaining);
    for (const row of users) {
      await ctx.db.delete("migrationRawUsers", row._id);
    }
    remaining -= users.length;
    deletedThisBatch += users.length;
    const roles =
      remaining === 0
        ? []
        : await ctx.db
            .query("migrationRawRoles")
            .withIndex("by_runId_and_legacyId", (query) =>
              query.eq("runId", runId),
            )
            .take(remaining);
    for (const row of roles) {
      await ctx.db.delete("migrationRawRoles", row._id);
    }
    remaining -= roles.length;
    deletedThisBatch += roles.length;
    const links =
      remaining === 0
        ? []
        : await ctx.db
            .query("migrationRawUserRoles")
            .withIndex("by_runId_and_legacyId", (query) =>
              query.eq("runId", runId),
            )
            .take(remaining);
    for (const row of links) {
      await ctx.db.delete("migrationRawUserRoles", row._id);
    }
    deletedThisBatch += links.length;
    const totalDeleted =
      scrubRun.identityRawRowsDeleted + deletedThisBatch;
    await ctx.db.patch("migrationScrubRuns", scrubRun._id, {
      identityRawRowsDeleted: totalDeleted,
      updatedAt: Date.now(),
    });
    return {
      deletedThisBatch,
      totalDeleted,
      done: !(await hasIdentityRowsForRun(ctx, runId)),
    };
  },
});

export const scrubCatalogRawBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: scrubBatchResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      FOUNDATION_SCRUB_OPERATIONS.catalog,
    );
    requireMigrationBatchSize(args.batchSize);
    const runId = ctx.systemState.cutoverRunId;
    await requireFoundationDomainsReconciled(ctx, runId);
    const scrubRun = await getScrubRun(ctx, runId);
    if (scrubRun.status === "completed") {
      return {
        deletedThisBatch: 0,
        totalDeleted: scrubRun.catalogRawRowsDeleted,
        done: true,
      };
    }
    let remaining = args.batchSize;
    let deletedThisBatch = 0;
    const movies = await ctx.db
      .query("migrationRawMovies")
      .withIndex("by_runId_and_legacyId", (query) =>
        query.eq("runId", runId),
      )
      .take(remaining);
    for (const row of movies) {
      await ctx.db.delete("migrationRawMovies", row._id);
    }
    remaining -= movies.length;
    deletedThisBatch += movies.length;
    const shows =
      remaining === 0
        ? []
        : await ctx.db
            .query("migrationRawShows")
            .withIndex("by_runId_and_legacyId", (query) =>
              query.eq("runId", runId),
            )
            .take(remaining);
    for (const row of shows) {
      await ctx.db.delete("migrationRawShows", row._id);
    }
    remaining -= shows.length;
    deletedThisBatch += shows.length;
    const tags =
      remaining === 0
        ? []
        : await ctx.db
            .query("migrationRawTags")
            .withIndex("by_runId_and_legacyId", (query) =>
              query.eq("runId", runId),
            )
            .take(remaining);
    for (const row of tags) {
      await ctx.db.delete("migrationRawTags", row._id);
    }
    deletedThisBatch += tags.length;
    const totalDeleted =
      scrubRun.catalogRawRowsDeleted + deletedThisBatch;
    await ctx.db.patch("migrationScrubRuns", scrubRun._id, {
      catalogRawRowsDeleted: totalDeleted,
      updatedAt: Date.now(),
    });
    return {
      deletedThisBatch,
      totalDeleted,
      done: !(await hasCatalogRowsForRun(ctx, runId)),
    };
  },
});

export const scrubEpisodeRawBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: scrubBatchResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      FOUNDATION_SCRUB_OPERATIONS.episodes,
    );
    requireMigrationBatchSize(args.batchSize);
    const runId = ctx.systemState.cutoverRunId;
    await requireFoundationDomainsReconciled(ctx, runId);
    const scrubRun = await getScrubRun(ctx, runId);
    if (scrubRun.status === "completed") {
      return {
        deletedThisBatch: 0,
        totalDeleted: scrubRun.episodeRawRowsDeleted,
        done: true,
      };
    }
    let remaining = args.batchSize;
    let deletedThisBatch = 0;
    const episodes = await ctx.db
      .query("migrationRawEpisodes")
      .withIndex("by_runId_and_legacyId", (query) =>
        query.eq("runId", runId),
      )
      .take(remaining);
    for (const row of episodes) {
      await ctx.db.delete("migrationRawEpisodes", row._id);
    }
    remaining -= episodes.length;
    deletedThisBatch += episodes.length;
    const links =
      remaining === 0
        ? []
        : await ctx.db
            .query("migrationRawEpisodeLinks")
            .withIndex("by_runId_and_legacyId", (query) =>
              query.eq("runId", runId),
            )
            .take(remaining);
    for (const row of links) {
      await ctx.db.delete("migrationRawEpisodeLinks", row._id);
    }
    remaining -= links.length;
    deletedThisBatch += links.length;
    const bangers =
      remaining === 0
        ? []
        : await ctx.db
            .query("migrationRawBangers")
            .withIndex("by_runId_and_legacyId", (query) =>
              query.eq("runId", runId),
            )
            .take(remaining);
    for (const row of bangers) {
      await ctx.db.delete("migrationRawBangers", row._id);
    }
    remaining -= bangers.length;
    deletedThisBatch += bangers.length;
    const audio =
      remaining === 0
        ? []
        : await ctx.db
            .query("migrationRawEpisodeAudioMessages")
            .withIndex("by_runId_and_legacyId", (query) =>
              query.eq("runId", runId),
            )
            .take(remaining);
    for (const row of audio) {
      await ctx.db.delete(
        "migrationRawEpisodeAudioMessages",
        row._id,
      );
    }
    deletedThisBatch += audio.length;
    const totalDeleted =
      scrubRun.episodeRawRowsDeleted + deletedThisBatch;
    await ctx.db.patch("migrationScrubRuns", scrubRun._id, {
      episodeRawRowsDeleted: totalDeleted,
      updatedAt: Date.now(),
    });
    return {
      deletedThisBatch,
      totalDeleted,
      done: !(await hasEpisodeRowsForRun(ctx, runId)),
    };
  },
});

export const scrubCheckpointsBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: scrubBatchResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      FOUNDATION_SCRUB_OPERATIONS.checkpoints,
    );
    requireMigrationBatchSize(args.batchSize);
    const runId = ctx.systemState.cutoverRunId;
    await requireFoundationDomainsReconciled(ctx, runId);
    const scrubRun = await getScrubRun(ctx, runId);
    if (scrubRun.status === "completed") {
      return {
        deletedThisBatch: 0,
        totalDeleted: scrubRun.checkpointsDeleted,
        done: true,
      };
    }
    const checkpoints = await ctx.db
      .query("migrationCheckpoints")
      .withIndex("by_runId_and_operation", (query) =>
        query.eq("runId", runId),
      )
      .take(args.batchSize);
    for (const checkpoint of checkpoints) {
      await ctx.db.delete(
        "migrationCheckpoints",
        checkpoint._id,
      );
    }
    const totalDeleted =
      scrubRun.checkpointsDeleted + checkpoints.length;
    await ctx.db.patch("migrationScrubRuns", scrubRun._id, {
      checkpointsDeleted: totalDeleted,
      updatedAt: Date.now(),
    });
    const remaining = await ctx.db
      .query("migrationCheckpoints")
      .withIndex("by_runId_and_operation", (query) =>
        query.eq("runId", runId),
      )
      .first();
    return {
      deletedThisBatch: checkpoints.length,
      totalDeleted,
      done: remaining === null,
    };
  },
});

export const finishFoundationScrub = internalMigrationMutation({
  args: {},
  returns: v.object({
    runId: v.string(),
    scope: v.literal(FOUNDATION_SCRUB_SCOPE),
    status: v.literal("completed"),
    identityRawRowsDeleted: v.number(),
    catalogRawRowsDeleted: v.number(),
    episodeRawRowsDeleted: v.number(),
    checkpointsDeleted: v.number(),
  }),
  handler: async (ctx) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      FOUNDATION_SCRUB_OPERATIONS.finish,
    );
    const runId = ctx.systemState.cutoverRunId;
    await requireFoundationDomainsReconciled(ctx, runId);
    const scrubRun = await getScrubRun(ctx, runId);
    const anyCheckpoint = await ctx.db
      .query("migrationCheckpoints")
      .withIndex("by_runId_and_operation")
      .first();
    if ((await hasAnyRawRows(ctx)) || anyCheckpoint !== null) {
      domainError(
        "CONFLICT",
        "Raw staging or migration checkpoints remain; scrub cannot complete.",
      );
    }
    if (scrubRun.status !== "completed") {
      const now = Date.now();
      await ctx.db.patch("migrationScrubRuns", scrubRun._id, {
        status: "completed",
        completedAt: now,
        updatedAt: now,
      });
      await writeAuditEvent(ctx, {
        actor: ctx.actor,
        action: "migration.foundationScrub.completed",
        targetType: "migrationScrubRun",
        targetId: scrubRun._id,
        cutoverRunId: runId,
        metadata: {
          scope: FOUNDATION_SCRUB_SCOPE,
          identityRawRowsDeleted:
            scrubRun.identityRawRowsDeleted,
          catalogRawRowsDeleted: scrubRun.catalogRawRowsDeleted,
          episodeRawRowsDeleted: scrubRun.episodeRawRowsDeleted,
          checkpointsDeleted: scrubRun.checkpointsDeleted,
        },
      });
    }
    return {
      runId,
      scope: "foundation-v1" as const,
      status: "completed" as const,
      identityRawRowsDeleted: scrubRun.identityRawRowsDeleted,
      catalogRawRowsDeleted: scrubRun.catalogRawRowsDeleted,
      episodeRawRowsDeleted: scrubRun.episodeRawRowsDeleted,
      checkpointsDeleted: scrubRun.checkpointsDeleted,
    };
  },
});
