import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { internalMigrationMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  FINAL_SCRUB_OPERATIONS,
  FINAL_SCRUB_SCOPE,
  FOUNDATION_SCRUB_OPERATIONS,
  FOUNDATION_SCRUB_SCOPE,
  MIGRATION_DOMAINS,
  MIGRATION_RAW_TABLES_BY_DOMAIN,
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

const migrationDomainValidator = v.union(
  v.literal("identity"),
  v.literal("catalog"),
  v.literal("episodes"),
  v.literal("assignments"),
  v.literal("reviews"),
  v.literal("games"),
  v.literal("rankings"),
  v.literal("archive"),
);

type MigrationDomain = (typeof MIGRATION_DOMAINS)[number];

type RawTableName =
  (typeof MIGRATION_RAW_TABLES_BY_DOMAIN)[MigrationDomain][number];

const finalScrubBatchResultValidator = v.object({
  deletedThisBatch: v.number(),
  totalDeleted: v.number(),
  done: v.boolean(),
});

async function requireAllDomainsReconciled(
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
      "The global migration run is not eligible for portable scrub.",
    );
  }
  for (const domain of MIGRATION_DOMAINS) {
    const domainRun = await ctx.db
      .query("migrationDomainRuns")
      .withIndex("by_runId_and_domain", (query) =>
        query.eq("runId", runId).eq("domain", domain),
      )
      .unique();
    if (domainRun?.status !== "reconciled") {
      domainError(
        "CONFLICT",
        `The ${domain} domain must be reconciled before portable scrub.`,
      );
    }
  }
}

async function getFinalScrubRun(
  ctx: DatabaseContext,
  runId: string,
): Promise<Doc<"migrationScrubRuns">> {
  const scrubRun = await ctx.db
    .query("migrationScrubRuns")
    .withIndex("by_runId_and_scope", (query) =>
      query.eq("runId", runId).eq("scope", FINAL_SCRUB_SCOPE),
    )
    .unique();
  if (scrubRun?.status !== "running") {
    domainError(
      "CONFLICT",
      "The portable scrub has not been started or is no longer active.",
    );
  }
  return scrubRun;
}

function rawOperationForDomain(domain: MigrationDomain): string {
  return FINAL_SCRUB_OPERATIONS.raw[domain];
}

async function deleteRawTableBatch(
  ctx: DatabaseContext,
  table: RawTableName,
  limit: number,
): Promise<number> {
  const rows = await ctx.db
    .query(table)
    .withIndex("by_runId_and_legacyId")
    .take(limit);
  for (const row of rows) {
    await ctx.db.delete(table, row._id);
  }
  return rows.length;
}

async function deleteRawDomainBatch(
  ctx: DatabaseContext,
  domain: MigrationDomain,
  batchSize: number,
): Promise<number> {
  let remaining = batchSize;
  let deleted = 0;
  for (const table of MIGRATION_RAW_TABLES_BY_DOMAIN[domain]) {
    if (remaining === 0) {
      break;
    }
    const tableDeleted = await deleteRawTableBatch(
      ctx,
      table,
      remaining,
    );
    deleted += tableDeleted;
    remaining -= tableDeleted;
  }
  return deleted;
}

async function hasRawRowsForDomain(
  ctx: DatabaseContext,
  domain: MigrationDomain,
): Promise<boolean> {
  for (const table of MIGRATION_RAW_TABLES_BY_DOMAIN[domain]) {
    const row = await ctx.db
      .query(table)
      .withIndex("by_runId_and_legacyId")
      .first();
    if (row !== null) {
      return true;
    }
  }
  return false;
}

async function hasAnyMigrationRawRows(
  ctx: DatabaseContext,
): Promise<boolean> {
  for (const domain of MIGRATION_DOMAINS) {
    if (await hasRawRowsForDomain(ctx, domain)) {
      return true;
    }
  }
  return false;
}

async function hasLegacyTagAwardIds(
  ctx: DatabaseContext,
): Promise<boolean> {
  const vote = await ctx.db
    .query("tagVotes")
    .withIndex("by_legacyAwardPointId", (query) =>
      query.gt("award.legacyPointId", ""),
    )
    .first();
  return vote !== null;
}

function hasAllRawScrubEvidence(
  scrubRun: Doc<"migrationScrubRuns">,
): boolean {
  for (const domain of MIGRATION_DOMAINS) {
    const deleted = scrubRun.rawRowsDeleted?.[domain];
    if (!Number.isSafeInteger(deleted) || (deleted ?? -1) < 0) {
      return false;
    }
  }
  return true;
}

async function hasMigrationMetadataExcept(
  ctx: DatabaseContext,
  retainedScrubId: Doc<"migrationScrubRuns">["_id"],
): Promise<boolean> {
  const checkpoint = await ctx.db
    .query("migrationCheckpoints")
    .withIndex("by_runId_and_operation")
    .first();
  const domainRun = await ctx.db
    .query("migrationDomainRuns")
    .withIndex("by_runId_and_domain")
    .first();
  const migrationRun = await ctx.db
    .query("migrationRuns")
    .withIndex("by_runId")
    .first();
  const scrubRuns = await ctx.db
    .query("migrationScrubRuns")
    .withIndex("by_runId_and_scope")
    .take(2);
  return (
    checkpoint !== null ||
    domainRun !== null ||
    migrationRun !== null ||
    scrubRuns.some((scrubRun) => scrubRun._id !== retainedScrubId)
  );
}

async function hasDeploymentControlRows(
  ctx: DatabaseContext,
): Promise<boolean> {
  const impersonationSession = await ctx.db
    .query("impersonationSessions")
    .withIndex("by_actorUserId_and_startedAt")
    .first();
  const servicePrincipal = await ctx.db
    .query("servicePrincipals")
    .withIndex("by_status")
    .first();
  return impersonationSession !== null || servicePrincipal !== null;
}

async function hasUnresolvedSideEffectIntents(
  ctx: DatabaseContext,
): Promise<boolean> {
  for (const status of [
    "pending",
    "processing",
    "retryScheduled",
    "terminal",
  ] as const) {
    const intent = await ctx.db
      .query("sideEffectIntents")
      .withIndex("by_status_and_nextAttemptAt", (query) =>
        query.eq("status", status),
      )
      .first();
    if (intent !== null) {
      return true;
    }
  }
  return false;
}

export const startFinalScrub = internalMigrationMutation({
  args: {},
  returns: v.object({
    runId: v.string(),
    scope: v.literal(FINAL_SCRUB_SCOPE),
    status: v.literal("running"),
    created: v.boolean(),
  }),
  handler: async (ctx) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      FINAL_SCRUB_OPERATIONS.start,
    );
    const runId = ctx.systemState.cutoverRunId;
    await requireAllDomainsReconciled(ctx, runId);
    if (await hasUnresolvedSideEffectIntents(ctx)) {
      domainError(
        "CONFLICT",
        "Every side-effect intent must be reconciled before portable scrub.",
      );
    }
    const existing = await ctx.db
      .query("migrationScrubRuns")
      .withIndex("by_runId_and_scope", (query) =>
        query.eq("runId", runId).eq("scope", FINAL_SCRUB_SCOPE),
      )
      .unique();
    if (existing) {
      if (existing.status !== "running") {
        domainError(
          "CONFLICT",
          "The portable scrub is already complete.",
        );
      }
      return {
        runId,
        scope: "portable-v1" as const,
        status: "running" as const,
        created: false,
      };
    }
    const now = Date.now();
    const scrubRunId = await ctx.db.insert("migrationScrubRuns", {
      runId,
      scope: FINAL_SCRUB_SCOPE,
      status: "running",
      identityRawRowsDeleted: 0,
      catalogRawRowsDeleted: 0,
      episodeRawRowsDeleted: 0,
      checkpointsDeleted: 0,
      rawRowsDeleted: {},
      domainRunsDeleted: 0,
      migrationRunsDeleted: 0,
      priorScrubRunsDeleted: 0,
      impersonationSessionsDeleted: 0,
      servicePrincipalsDeleted: 0,
      tagAwardArchiveIdsRemoved: 0,
      startedAt: now,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "migration.portableScrub.started",
      targetType: "migrationScrubRun",
      targetId: scrubRunId,
      cutoverRunId: runId,
      metadata: { scope: FINAL_SCRUB_SCOPE },
    });
    return {
      runId,
      scope: "portable-v1" as const,
      status: "running" as const,
      created: true,
    };
  },
});

export const scrubFinalRawDomainBatch = internalMigrationMutation({
  args: {
    domain: migrationDomainValidator,
    batchSize: v.number(),
  },
  returns: v.object({
    domain: migrationDomainValidator,
    deletedThisBatch: v.number(),
    totalDeleted: v.number(),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      rawOperationForDomain(args.domain),
    );
    requireMigrationBatchSize(args.batchSize);
    const runId = ctx.systemState.cutoverRunId;
    const scrubRun = await getFinalScrubRun(ctx, runId);
    const deletedThisBatch = await deleteRawDomainBatch(
      ctx,
      args.domain,
      args.batchSize,
    );
    const rawRowsDeleted = {
      ...(scrubRun.rawRowsDeleted ?? {}),
      [args.domain]:
        (scrubRun.rawRowsDeleted?.[args.domain] ?? 0) +
        deletedThisBatch,
    };
    await ctx.db.patch("migrationScrubRuns", scrubRun._id, {
      rawRowsDeleted,
      updatedAt: Date.now(),
    });
    return {
      domain: args.domain,
      deletedThisBatch,
      totalDeleted: rawRowsDeleted[args.domain] ?? 0,
      done: !(await hasRawRowsForDomain(ctx, args.domain)),
    };
  },
});

export const scrubFinalTagAwardArchiveBatch =
  internalMigrationMutation({
    args: { batchSize: v.number() },
    returns: finalScrubBatchResultValidator,
    handler: async (ctx, args) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        FINAL_SCRUB_OPERATIONS.tagAwardArchive,
      );
      requireMigrationBatchSize(args.batchSize);
      const runId = ctx.systemState.cutoverRunId;
      const scrubRun = await getFinalScrubRun(ctx, runId);
      if (
        (await hasAnyMigrationRawRows(ctx)) ||
        !hasAllRawScrubEvidence(scrubRun)
      ) {
        domainError(
          "CONFLICT",
          "Every raw domain must be archived and scrubbed before tag-award identifiers.",
        );
      }
      const votes = await ctx.db
        .query("tagVotes")
        .withIndex("by_legacyAwardPointId", (query) =>
          query.gt("award.legacyPointId", ""),
        )
        .take(args.batchSize);
      for (const vote of votes) {
        if (vote.award.kind !== "legacyAwardTombstone") {
          domainError(
            "CONFLICT",
            "A tag-award archive identifier has an invalid award state.",
          );
        }
        await ctx.db.patch("tagVotes", vote._id, {
          award: { kind: "legacyAwardTombstone" },
        });
      }
      const totalDeleted =
        (scrubRun.tagAwardArchiveIdsRemoved ?? 0) +
        votes.length;
      await ctx.db.patch("migrationScrubRuns", scrubRun._id, {
        tagAwardArchiveIdsRemoved: totalDeleted,
        updatedAt: Date.now(),
      });
      return {
        deletedThisBatch: votes.length,
        totalDeleted,
        done: !(await hasLegacyTagAwardIds(ctx)),
      };
    },
  });

export const scrubFinalMigrationMetadataBatch =
  internalMigrationMutation({
    args: { batchSize: v.number() },
    returns: finalScrubBatchResultValidator,
    handler: async (ctx, args) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        FINAL_SCRUB_OPERATIONS.migrationMetadata,
      );
      requireMigrationBatchSize(args.batchSize);
      const runId = ctx.systemState.cutoverRunId;
      const scrubRun = await getFinalScrubRun(ctx, runId);
      if (
        (await hasAnyMigrationRawRows(ctx)) ||
        !hasAllRawScrubEvidence(scrubRun) ||
        (await hasLegacyTagAwardIds(ctx))
      ) {
        domainError(
          "CONFLICT",
          "Every raw domain must be scrubbed and recorded before migration metadata.",
        );
      }
      let remaining = args.batchSize;
      let deletedThisBatch = 0;

      const checkpoints = await ctx.db
        .query("migrationCheckpoints")
        .withIndex("by_runId_and_operation")
        .take(remaining);
      for (const checkpoint of checkpoints) {
        await ctx.db.delete(
          "migrationCheckpoints",
          checkpoint._id,
        );
      }
      remaining -= checkpoints.length;
      deletedThisBatch += checkpoints.length;

      const domainRuns =
        remaining === 0
          ? []
          : await ctx.db
              .query("migrationDomainRuns")
              .withIndex("by_runId_and_domain")
              .take(remaining);
      for (const domainRun of domainRuns) {
        await ctx.db.delete("migrationDomainRuns", domainRun._id);
      }
      remaining -= domainRuns.length;
      deletedThisBatch += domainRuns.length;

      const migrationRuns =
        remaining === 0
          ? []
          : await ctx.db
              .query("migrationRuns")
              .withIndex("by_runId")
              .take(remaining);
      for (const migrationRun of migrationRuns) {
        await ctx.db.delete("migrationRuns", migrationRun._id);
      }
      remaining -= migrationRuns.length;
      deletedThisBatch += migrationRuns.length;

      const scrubCandidates =
        remaining === 0
          ? []
          : await ctx.db
              .query("migrationScrubRuns")
              .withIndex("by_runId_and_scope")
              .take(remaining + 1);
      const otherScrubRuns: Array<Doc<"migrationScrubRuns">> = [];
      for (const candidate of scrubCandidates) {
        if (
          candidate._id !== scrubRun._id &&
          otherScrubRuns.length < remaining
        ) {
          otherScrubRuns.push(candidate);
        }
      }
      for (const otherScrubRun of otherScrubRuns) {
        await ctx.db.delete(
          "migrationScrubRuns",
          otherScrubRun._id,
        );
      }
      deletedThisBatch += otherScrubRuns.length;

      const checkpointsDeleted =
        scrubRun.checkpointsDeleted + checkpoints.length;
      const domainRunsDeleted =
        (scrubRun.domainRunsDeleted ?? 0) + domainRuns.length;
      const migrationRunsDeleted =
        (scrubRun.migrationRunsDeleted ?? 0) +
        migrationRuns.length;
      const priorScrubRunsDeleted =
        (scrubRun.priorScrubRunsDeleted ?? 0) +
        otherScrubRuns.length;
      await ctx.db.patch("migrationScrubRuns", scrubRun._id, {
        checkpointsDeleted,
        domainRunsDeleted,
        migrationRunsDeleted,
        priorScrubRunsDeleted,
        updatedAt: Date.now(),
      });
      return {
        deletedThisBatch,
        totalDeleted:
          checkpointsDeleted +
          domainRunsDeleted +
          migrationRunsDeleted +
          priorScrubRunsDeleted,
        done: !(
          await hasMigrationMetadataExcept(ctx, scrubRun._id)
        ),
      };
    },
  });

export const scrubFinalDeploymentControlBatch =
  internalMigrationMutation({
    args: { batchSize: v.number() },
    returns: finalScrubBatchResultValidator,
    handler: async (ctx, args) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        FINAL_SCRUB_OPERATIONS.deploymentControl,
      );
      requireMigrationBatchSize(args.batchSize);
      const runId = ctx.systemState.cutoverRunId;
      const scrubRun = await getFinalScrubRun(ctx, runId);
      if (
        (await hasAnyMigrationRawRows(ctx)) ||
        !hasAllRawScrubEvidence(scrubRun) ||
        (await hasLegacyTagAwardIds(ctx)) ||
        (await hasMigrationMetadataExcept(ctx, scrubRun._id))
      ) {
        domainError(
          "CONFLICT",
          "Migration staging and metadata must be scrubbed before deployment control state.",
        );
      }
      let remaining = args.batchSize;
      const impersonationSessions = await ctx.db
        .query("impersonationSessions")
        .withIndex("by_actorUserId_and_startedAt")
        .take(remaining);
      for (const session of impersonationSessions) {
        await ctx.db.delete("impersonationSessions", session._id);
      }
      remaining -= impersonationSessions.length;
      const servicePrincipals =
        remaining === 0
          ? []
          : await ctx.db
              .query("servicePrincipals")
              .withIndex("by_status")
              .take(remaining);
      for (const principal of servicePrincipals) {
        await ctx.db.delete("servicePrincipals", principal._id);
      }
      const deletedThisBatch =
        impersonationSessions.length + servicePrincipals.length;
      const impersonationSessionsDeleted =
        (scrubRun.impersonationSessionsDeleted ?? 0) +
        impersonationSessions.length;
      const servicePrincipalsDeleted =
        (scrubRun.servicePrincipalsDeleted ?? 0) +
        servicePrincipals.length;
      await ctx.db.patch("migrationScrubRuns", scrubRun._id, {
        impersonationSessionsDeleted,
        servicePrincipalsDeleted,
        updatedAt: Date.now(),
      });
      return {
        deletedThisBatch,
        totalDeleted:
          impersonationSessionsDeleted + servicePrincipalsDeleted,
        done: !(await hasDeploymentControlRows(ctx)),
      };
    },
  });

export const finishFinalScrub = internalMigrationMutation({
  args: {},
  returns: v.object({
    runId: v.string(),
    scope: v.literal(FINAL_SCRUB_SCOPE),
    status: v.literal("completed"),
    rawRowsDeleted: v.record(v.string(), v.number()),
    checkpointsDeleted: v.number(),
    domainRunsDeleted: v.number(),
    migrationRunsDeleted: v.number(),
    priorScrubRunsDeleted: v.number(),
    impersonationSessionsDeleted: v.number(),
    servicePrincipalsDeleted: v.number(),
    tagAwardArchiveIdsRemoved: v.number(),
    systemStateDeleted: v.literal(true),
  }),
  handler: async (ctx) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      FINAL_SCRUB_OPERATIONS.finish,
    );
    const runId = ctx.systemState.cutoverRunId;
    const scrubRun = await getFinalScrubRun(ctx, runId);
    if (
      (await hasAnyMigrationRawRows(ctx)) ||
      !hasAllRawScrubEvidence(scrubRun) ||
      (await hasLegacyTagAwardIds(ctx)) ||
      (await hasMigrationMetadataExcept(ctx, scrubRun._id)) ||
      (await hasDeploymentControlRows(ctx)) ||
      (await hasUnresolvedSideEffectIntents(ctx))
    ) {
      domainError(
        "CONFLICT",
        "Portable scrub cannot finish while temporary state remains.",
      );
    }
    const rawRowsDeleted = scrubRun.rawRowsDeleted ?? {};
    const domainRunsDeleted = scrubRun.domainRunsDeleted ?? 0;
    const migrationRunsDeleted = scrubRun.migrationRunsDeleted ?? 0;
    const priorScrubRunsDeleted =
      scrubRun.priorScrubRunsDeleted ?? 0;
    const impersonationSessionsDeleted =
      scrubRun.impersonationSessionsDeleted ?? 0;
    const servicePrincipalsDeleted =
      scrubRun.servicePrincipalsDeleted ?? 0;
    const tagAwardArchiveIdsRemoved =
      scrubRun.tagAwardArchiveIdsRemoved ?? 0;
    const rawAuditCounts = Object.fromEntries(
      Object.entries(rawRowsDeleted).map(([domain, count]) => [
        `${domain}RawRowsDeleted`,
        count,
      ]),
    );
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "migration.portableScrub.completed",
      targetType: "migrationScrubRun",
      targetId: scrubRun._id,
      cutoverRunId: runId,
      metadata: {
        scope: FINAL_SCRUB_SCOPE,
        ...rawAuditCounts,
        checkpointsDeleted: scrubRun.checkpointsDeleted,
        domainRunsDeleted,
        migrationRunsDeleted,
        priorScrubRunsDeleted,
        impersonationSessionsDeleted,
        servicePrincipalsDeleted,
        tagAwardArchiveIdsRemoved,
        systemStateDeleted: true,
      },
    });
    await ctx.db.delete("migrationScrubRuns", scrubRun._id);
    await ctx.db.delete("systemState", ctx.systemState._id);
    return {
      runId,
      scope: "portable-v1" as const,
      status: "completed" as const,
      rawRowsDeleted,
      checkpointsDeleted: scrubRun.checkpointsDeleted,
      domainRunsDeleted,
      migrationRunsDeleted,
      priorScrubRunsDeleted,
      impersonationSessionsDeleted,
      servicePrincipalsDeleted,
      tagAwardArchiveIdsRemoved,
      systemStateDeleted: true as const,
    };
  },
});
