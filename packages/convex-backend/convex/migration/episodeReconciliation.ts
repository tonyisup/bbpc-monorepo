import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { internalMigrationMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  EPISODE_RECONCILIATION_OPERATIONS,
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

const DOMAIN = "episodes";
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

async function resolveEpisodeId(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Id<"episodes">> {
  const episode = await ctx.db
    .query("episodes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(legacyId)),
    )
    .unique();
  if (!episode) {
    domainError(
      "CONFLICT",
      "Episode reconciliation found a missing episode parent.",
    );
  }
  return episode._id;
}

async function resolveOptionalEpisodeId(
  ctx: DatabaseContext,
  legacyId: string | undefined,
): Promise<Id<"episodes"> | undefined> {
  return legacyId === undefined
    ? undefined
    : await resolveEpisodeId(ctx, legacyId);
}

async function resolveUserId(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Id<"users">> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  if (!user) {
    domainError(
      "CONFLICT",
      "Episode reconciliation found a missing user parent.",
    );
  }
  return user._id;
}

async function resolveOptionalUserId(
  ctx: DatabaseContext,
  legacyId: string | undefined,
): Promise<Id<"users"> | undefined> {
  return legacyId === undefined
    ? undefined
    : await resolveUserId(ctx, legacyId);
}

async function verifyEpisode(
  ctx: DatabaseContext,
  row: Doc<"migrationRawEpisodes">,
): Promise<void> {
  const canonical = await ctx.db
    .query("episodes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(row.legacyId)),
    )
    .unique();
  const normalizedSlug =
    row.slug === undefined
      ? undefined
      : normalizeLookupKey(row.slug, "Episode slug");
  if (
    canonical?.number !== row.number ||
    canonical.title !== row.title ||
    canonical.recording !== row.recording ||
    canonical.date !== row.date ||
    canonical.description !== row.description ||
    canonical.status !== row.status ||
    canonical.notes !== row.notes ||
    canonical.seoDescription !== row.seoDescription ||
    canonical.seoKeywords !== row.seoKeywords ||
    canonical.seoTitle !== row.seoTitle ||
    canonical.slug !== row.slug ||
    canonical.normalizedSlug !== normalizedSlug
  ) {
    domainError(
      "CONFLICT",
      "Episode reconciliation found an episode mismatch.",
    );
  }
}

async function verifyEpisodeLink(
  ctx: DatabaseContext,
  row: Doc<"migrationRawEpisodeLinks">,
): Promise<void> {
  const episodeId = await resolveOptionalEpisodeId(
    ctx,
    row.episodeLegacyId,
  );
  const canonical = await ctx.db
    .query("episodeLinks")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(row.legacyId)),
    )
    .unique();
  if (
    canonical?.url !== row.url ||
    canonical.text !== row.text ||
    canonical.episodeId !== episodeId
  ) {
    domainError(
      "CONFLICT",
      "Episode reconciliation found a link mismatch.",
    );
  }
}

async function verifyBanger(
  ctx: DatabaseContext,
  row: Doc<"migrationRawBangers">,
): Promise<void> {
  const episodeId = await resolveOptionalEpisodeId(
    ctx,
    row.episodeLegacyId,
  );
  const userId = await resolveOptionalUserId(
    ctx,
    row.userLegacyId,
  );
  const canonical = await ctx.db
    .query("bangers")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(row.legacyId)),
    )
    .unique();
  if (
    canonical?.title !== row.title ||
    canonical.artist !== row.artist ||
    canonical.url !== row.url ||
    canonical.episodeId !== episodeId ||
    canonical.userId !== userId
  ) {
    domainError(
      "CONFLICT",
      "Episode reconciliation found a banger mismatch.",
    );
  }
}

async function verifyAudioMessage(
  ctx: DatabaseContext,
  row: Doc<"migrationRawEpisodeAudioMessages">,
): Promise<void> {
  const userId = await resolveUserId(ctx, row.userLegacyId);
  const episodeId = await resolveOptionalEpisodeId(
    ctx,
    row.episodeLegacyId,
  );
  const canonical = await ctx.db
    .query("episodeAudioMessages")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", row.legacyId),
    )
    .unique();
  if (
    canonical?.url !== row.url ||
    canonical.createdAt !== row.createdAt ||
    canonical.fileKey !== row.fileKey ||
    canonical.userId !== userId ||
    canonical.episodeId !== episodeId ||
    canonical.notes !== row.notes
  ) {
    domainError(
      "CONFLICT",
      "Episode reconciliation found an audio-message mismatch.",
    );
  }
}

export const reconcileEpisodesBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: reconciliationResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      EPISODE_RECONCILIATION_OPERATIONS.episodes,
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
      EPISODE_RECONCILIATION_OPERATIONS.episodes,
    );
    if (previous?.status === "completed") {
      return reconciliationCheckpointResult(previous);
    }
    const rows = await ctx.db
      .query("migrationRawEpisodes")
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
      await verifyEpisode(ctx, row);
    }
    const lastRow = batch.at(-1);
    const checkpoint = await saveMigrationCheckpoint(ctx, {
      runId,
      operation: EPISODE_RECONCILIATION_OPERATIONS.episodes,
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
      operation: EPISODE_RECONCILIATION_OPERATIONS.episodes,
      checkedThisBatch: batch.length,
      completed,
    });
    return reconciliationCheckpointResult(checkpoint);
  },
});

export const reconcileEpisodeLinksBatch =
  internalMigrationMutation({
    args: { batchSize: v.number() },
    returns: reconciliationResultValidator,
    handler: async (ctx, args) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        EPISODE_RECONCILIATION_OPERATIONS.links,
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
        EPISODE_RECONCILIATION_OPERATIONS.links,
      );
      if (previous?.status === "completed") {
        return reconciliationCheckpointResult(previous);
      }
      const rows = await ctx.db
        .query("migrationRawEpisodeLinks")
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
        await verifyEpisodeLink(ctx, row);
      }
      const lastRow = batch.at(-1);
      const checkpoint = await saveMigrationCheckpoint(ctx, {
        runId,
        operation: EPISODE_RECONCILIATION_OPERATIONS.links,
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
        operation: EPISODE_RECONCILIATION_OPERATIONS.links,
        checkedThisBatch: batch.length,
        completed,
      });
      return reconciliationCheckpointResult(checkpoint);
    },
  });

export const reconcileBangersBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: reconciliationResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      EPISODE_RECONCILIATION_OPERATIONS.bangers,
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
      EPISODE_RECONCILIATION_OPERATIONS.bangers,
    );
    if (previous?.status === "completed") {
      return reconciliationCheckpointResult(previous);
    }
    const rows = await ctx.db
      .query("migrationRawBangers")
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
      await verifyBanger(ctx, row);
    }
    const lastRow = batch.at(-1);
    const checkpoint = await saveMigrationCheckpoint(ctx, {
      runId,
      operation: EPISODE_RECONCILIATION_OPERATIONS.bangers,
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
      operation: EPISODE_RECONCILIATION_OPERATIONS.bangers,
      checkedThisBatch: batch.length,
      completed,
    });
    return reconciliationCheckpointResult(checkpoint);
  },
});

export const reconcileEpisodeAudioMessagesBatch =
  internalMigrationMutation({
    args: { batchSize: v.number() },
    returns: reconciliationResultValidator,
    handler: async (ctx, args) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        EPISODE_RECONCILIATION_OPERATIONS.audioMessages,
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
        EPISODE_RECONCILIATION_OPERATIONS.audioMessages,
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
          "The audio reconciliation checkpoint cursor is invalid.",
        );
      }
      const rows = await ctx.db
        .query("migrationRawEpisodeAudioMessages")
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
        await verifyAudioMessage(ctx, row);
      }
      const lastRow = batch.at(-1);
      const checkpoint = await saveMigrationCheckpoint(ctx, {
        runId,
        operation:
          EPISODE_RECONCILIATION_OPERATIONS.audioMessages,
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
        operation:
          EPISODE_RECONCILIATION_OPERATIONS.audioMessages,
        checkedThisBatch: batch.length,
        completed,
      });
      return reconciliationCheckpointResult(checkpoint);
    },
  });

export const finishEpisodeReconciliation =
  internalMigrationMutation({
    args: {},
    returns: v.object({
      runId: v.string(),
      status: v.literal("reconciled"),
      episodes: v.number(),
      links: v.number(),
      bangers: v.number(),
      audioMessages: v.number(),
    }),
    handler: async (ctx) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        EPISODE_RECONCILIATION_OPERATIONS.finish,
      );
      const runId = ctx.systemState.cutoverRunId;
      const { domainRun } = await getReconciliationDomainRun(ctx, {
        runId,
        domain: DOMAIN,
      });
      const episodes = await getMigrationCheckpoint(
        ctx,
        runId,
        EPISODE_RECONCILIATION_OPERATIONS.episodes,
      );
      const links = await getMigrationCheckpoint(
        ctx,
        runId,
        EPISODE_RECONCILIATION_OPERATIONS.links,
      );
      const bangers = await getMigrationCheckpoint(
        ctx,
        runId,
        EPISODE_RECONCILIATION_OPERATIONS.bangers,
      );
      const audioMessages = await getMigrationCheckpoint(
        ctx,
        runId,
        EPISODE_RECONCILIATION_OPERATIONS.audioMessages,
      );
      if (
        episodes?.status !== "completed" ||
        links?.status !== "completed" ||
        bangers?.status !== "completed" ||
        audioMessages?.status !== "completed"
      ) {
        domainError(
          "CONFLICT",
          "Every episode reconciliation checkpoint must be complete.",
        );
      }
      if (
        episodes.reusedCount !==
          domainRun.expectedCounts.episodes ||
        links.reusedCount !== domainRun.expectedCounts.links ||
        bangers.reusedCount !==
          domainRun.expectedCounts.bangers ||
        audioMessages.reusedCount !==
          domainRun.expectedCounts.audioMessages
      ) {
        domainError(
          "CONFLICT",
          "Episode reconciliation counts do not match source expectations.",
        );
      }
      if (domainRun.status !== "reconciled") {
        await ctx.db.patch("migrationDomainRuns", domainRun._id, {
          status: "reconciled",
          updatedAt: Date.now(),
        });
        await writeAuditEvent(ctx, {
          actor: ctx.actor,
          action: "migration.episodes.reconciled",
          targetType: "migrationDomainRun",
          targetId: domainRun._id,
          cutoverRunId: runId,
          metadata: {
            episodes: episodes.reusedCount,
            links: links.reusedCount,
            bangers: bangers.reusedCount,
            audioMessages: audioMessages.reusedCount,
          },
        });
      }
      return {
        runId,
        status: "reconciled" as const,
        episodes: episodes.reusedCount,
        links: links.reusedCount,
        bangers: bangers.reusedCount,
        audioMessages: audioMessages.reusedCount,
      };
    },
  });
