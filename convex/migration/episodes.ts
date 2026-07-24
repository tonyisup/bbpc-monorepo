import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { internalMigrationMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import { EPISODE_OPERATIONS } from "./constants.js";
import { normalizeLookupKey } from "./normalize.js";
import {
  getActiveDomainRun,
  getMigrationCheckpoint,
  migrationCheckpointResult,
  requireMigrationBatchSize,
  requireMigrationCount,
  requireMigrationOperation,
  requireTransformedDomain,
  saveMigrationCheckpoint,
  startDomainRun,
  writeMigrationBatchAudit,
} from "./runtime.js";

const DOMAIN = "episodes";
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
    domainError("VALIDATION_FAILED", `${label} must be a UUID.`);
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

function requireCalendarDate(value: string, label: string): void {
  const match =
    /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u.exec(value);
  if (!match?.groups) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must use YYYY-MM-DD calendar form.`,
    );
  }
  const year = Number(match.groups.year);
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must be a real calendar date.`,
    );
  }
}

async function resolveEpisodeId(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Id<"episodes">> {
  const normalized = normalizeUuid(legacyId, "Episode relationship ID");
  const episode = await ctx.db
    .query("episodes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalized),
    )
    .unique();
  if (!episode) {
    domainError(
      "CONFLICT",
      "An episode relationship references a missing canonical episode.",
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
      "An episode record references a missing canonical user.",
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

async function upsertEpisode(
  ctx: DatabaseContext,
  row: Doc<"migrationRawEpisodes">,
): Promise<"inserted" | "reused"> {
  const legacyId = normalizeUuid(row.legacyId, "Episode legacy ID");
  requireSmallInt(row.number, "Episode number");
  if (row.date !== undefined) {
    requireCalendarDate(row.date, "Episode date");
  }
  const slugFields =
    row.slug === undefined
      ? {}
      : {
          slug: row.slug,
          normalizedSlug: normalizeLookupKey(
            row.slug,
            "Episode slug",
          ),
        };
  const normalizedSlug =
    "normalizedSlug" in slugFields
      ? slugFields.normalizedSlug
      : undefined;
  const existing = await ctx.db
    .query("episodes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  const slugCollision =
    normalizedSlug === undefined
      ? null
      : await ctx.db
          .query("episodes")
          .withIndex("by_normalizedSlug", (query) =>
            query.eq("normalizedSlug", normalizedSlug),
          )
          .unique();
  if (slugCollision && slugCollision._id !== existing?._id) {
    domainError(
      "CONFLICT",
      "Episode slug normalization produced a duplicate canonical key.",
    );
  }
  if (existing) {
    const matches =
      existing.number === row.number &&
      existing.title === row.title &&
      existing.recording === row.recording &&
      existing.date === row.date &&
      existing.description === row.description &&
      existing.status === row.status &&
      existing.notes === row.notes &&
      existing.seoDescription === row.seoDescription &&
      existing.seoKeywords === row.seoKeywords &&
      existing.seoTitle === row.seoTitle &&
      existing.slug === row.slug &&
      existing.normalizedSlug === normalizedSlug;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated episode conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("episodes", {
    legacyId,
    number: row.number,
    title: row.title,
    ...(row.recording === undefined
      ? {}
      : { recording: row.recording }),
    ...(row.date === undefined ? {} : { date: row.date }),
    ...(row.description === undefined
      ? {}
      : { description: row.description }),
    ...(row.status === undefined ? {} : { status: row.status }),
    ...(row.notes === undefined ? {} : { notes: row.notes }),
    ...(row.seoDescription === undefined
      ? {}
      : { seoDescription: row.seoDescription }),
    ...(row.seoKeywords === undefined
      ? {}
      : { seoKeywords: row.seoKeywords }),
    ...(row.seoTitle === undefined
      ? {}
      : { seoTitle: row.seoTitle }),
    ...slugFields,
  });
  return "inserted";
}

async function upsertEpisodeLink(
  ctx: DatabaseContext,
  row: Doc<"migrationRawEpisodeLinks">,
): Promise<"inserted" | "reused"> {
  const legacyId = normalizeUuid(row.legacyId, "Link legacy ID");
  const episodeId = await resolveOptionalEpisodeId(
    ctx,
    row.episodeLegacyId,
  );
  const existing = await ctx.db
    .query("episodeLinks")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  if (existing) {
    const matches =
      existing.url === row.url &&
      existing.text === row.text &&
      existing.episodeId === episodeId;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated episode link conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("episodeLinks", {
    legacyId,
    url: row.url,
    text: row.text,
    ...(episodeId === undefined ? {} : { episodeId }),
  });
  return "inserted";
}

async function upsertBanger(
  ctx: DatabaseContext,
  row: Doc<"migrationRawBangers">,
): Promise<"inserted" | "reused"> {
  const legacyId = normalizeUuid(row.legacyId, "Banger legacy ID");
  const episodeId = await resolveOptionalEpisodeId(
    ctx,
    row.episodeLegacyId,
  );
  const userId = await resolveOptionalUserId(
    ctx,
    row.userLegacyId,
  );
  const existing = await ctx.db
    .query("bangers")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  if (existing) {
    const matches =
      existing.title === row.title &&
      existing.artist === row.artist &&
      existing.url === row.url &&
      existing.episodeId === episodeId &&
      existing.userId === userId;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated banger conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("bangers", {
    legacyId,
    title: row.title,
    artist: row.artist,
    url: row.url,
    ...(episodeId === undefined ? {} : { episodeId }),
    ...(userId === undefined ? {} : { userId }),
  });
  return "inserted";
}

async function upsertEpisodeAudioMessage(
  ctx: DatabaseContext,
  row: Doc<"migrationRawEpisodeAudioMessages">,
): Promise<"inserted" | "reused"> {
  requireInt(row.legacyId, "Episode audio message legacy ID");
  if (!Number.isFinite(row.createdAt)) {
    domainError(
      "VALIDATION_FAILED",
      "Episode audio message creation time must be finite.",
    );
  }
  const userId = await resolveUserId(ctx, row.userLegacyId);
  const episodeId = await resolveOptionalEpisodeId(
    ctx,
    row.episodeLegacyId,
  );
  const existing = await ctx.db
    .query("episodeAudioMessages")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", row.legacyId),
    )
    .unique();
  if (existing) {
    const matches =
      existing.url === row.url &&
      existing.createdAt === row.createdAt &&
      existing.fileKey === row.fileKey &&
      existing.userId === userId &&
      existing.episodeId === episodeId &&
      existing.notes === row.notes;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated episode audio message conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("episodeAudioMessages", {
    legacyId: row.legacyId,
    url: row.url,
    createdAt: row.createdAt,
    ...(row.fileKey === undefined ? {} : { fileKey: row.fileKey }),
    userId,
    ...(episodeId === undefined ? {} : { episodeId }),
    ...(row.notes === undefined ? {} : { notes: row.notes }),
  });
  return "inserted";
}

async function requireCompletedCheckpoint(
  ctx: DatabaseContext,
  runId: string,
  operation: string,
): Promise<void> {
  const checkpoint = await getMigrationCheckpoint(
    ctx,
    runId,
    operation,
  );
  if (checkpoint?.status !== "completed") {
    domainError(
      "CONFLICT",
      `Migration checkpoint ${operation} must be completed first.`,
    );
  }
}

export const startEpisodeRun = internalMigrationMutation({
  args: {
    sourceSchemaFingerprint: v.string(),
    expectedEpisodes: v.number(),
    expectedLinks: v.number(),
    expectedBangers: v.number(),
    expectedAudioMessages: v.number(),
  },
  returns: v.object({
    runId: v.string(),
    status: runStatusValidator,
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      EPISODE_OPERATIONS.start,
    );
    requireMigrationCount(
      args.expectedEpisodes,
      "Expected episode count",
    );
    requireMigrationCount(args.expectedLinks, "Expected link count");
    requireMigrationCount(
      args.expectedBangers,
      "Expected banger count",
    );
    requireMigrationCount(
      args.expectedAudioMessages,
      "Expected episode audio message count",
    );
    const runId = ctx.systemState.cutoverRunId;
    await requireTransformedDomain(ctx, {
      runId,
      domain: "identity",
    });
    const result = await startDomainRun(ctx, {
      runId,
      domain: DOMAIN,
      sourceSchemaFingerprint: args.sourceSchemaFingerprint,
      expectedCounts: {
        episodes: args.expectedEpisodes,
        links: args.expectedLinks,
        bangers: args.expectedBangers,
        audioMessages: args.expectedAudioMessages,
      },
    });
    if (result.created) {
      await writeAuditEvent(ctx, {
        actor: ctx.actor,
        action: "migration.episodes.started",
        targetType: "migrationDomainRun",
        targetId: result.domainRun._id,
        cutoverRunId: result.run.runId,
        metadata: {
          expectedEpisodes: args.expectedEpisodes,
          expectedLinks: args.expectedLinks,
          expectedBangers: args.expectedBangers,
          expectedAudioMessages: args.expectedAudioMessages,
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

export const transformEpisodesBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: checkpointResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      EPISODE_OPERATIONS.episodes,
    );
    requireMigrationBatchSize(args.batchSize);
    const runId = ctx.systemState.cutoverRunId;
    await getActiveDomainRun(ctx, { runId, domain: DOMAIN });
    const previous = await getMigrationCheckpoint(
      ctx,
      runId,
      EPISODE_OPERATIONS.episodes,
    );
    if (previous?.status === "completed") {
      return migrationCheckpointResult(previous);
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
    let insertedThisBatch = 0;
    let reusedThisBatch = 0;
    for (const row of batch) {
      const outcome = await upsertEpisode(ctx, row);
      if (outcome === "inserted") {
        insertedThisBatch += 1;
      } else {
        reusedThisBatch += 1;
      }
    }
    const lastRow = batch.at(-1);
    const checkpoint = await saveMigrationCheckpoint(ctx, {
      runId,
      operation: EPISODE_OPERATIONS.episodes,
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
      operation: EPISODE_OPERATIONS.episodes,
      processedThisBatch: batch.length,
      insertedThisBatch,
      reusedThisBatch,
      completed,
    });
    return migrationCheckpointResult(checkpoint);
  },
});

export const transformEpisodeLinksBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: checkpointResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      EPISODE_OPERATIONS.links,
    );
    requireMigrationBatchSize(args.batchSize);
    const runId = ctx.systemState.cutoverRunId;
    await getActiveDomainRun(ctx, { runId, domain: DOMAIN });
    await requireCompletedCheckpoint(
      ctx,
      runId,
      EPISODE_OPERATIONS.episodes,
    );
    const previous = await getMigrationCheckpoint(
      ctx,
      runId,
      EPISODE_OPERATIONS.links,
    );
    if (previous?.status === "completed") {
      return migrationCheckpointResult(previous);
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
    let insertedThisBatch = 0;
    let reusedThisBatch = 0;
    for (const row of batch) {
      const outcome = await upsertEpisodeLink(ctx, row);
      if (outcome === "inserted") {
        insertedThisBatch += 1;
      } else {
        reusedThisBatch += 1;
      }
    }
    const lastRow = batch.at(-1);
    const checkpoint = await saveMigrationCheckpoint(ctx, {
      runId,
      operation: EPISODE_OPERATIONS.links,
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
      operation: EPISODE_OPERATIONS.links,
      processedThisBatch: batch.length,
      insertedThisBatch,
      reusedThisBatch,
      completed,
    });
    return migrationCheckpointResult(checkpoint);
  },
});

export const transformBangersBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: checkpointResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      EPISODE_OPERATIONS.bangers,
    );
    requireMigrationBatchSize(args.batchSize);
    const runId = ctx.systemState.cutoverRunId;
    await getActiveDomainRun(ctx, { runId, domain: DOMAIN });
    await requireCompletedCheckpoint(
      ctx,
      runId,
      EPISODE_OPERATIONS.episodes,
    );
    const previous = await getMigrationCheckpoint(
      ctx,
      runId,
      EPISODE_OPERATIONS.bangers,
    );
    if (previous?.status === "completed") {
      return migrationCheckpointResult(previous);
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
    let insertedThisBatch = 0;
    let reusedThisBatch = 0;
    for (const row of batch) {
      const outcome = await upsertBanger(ctx, row);
      if (outcome === "inserted") {
        insertedThisBatch += 1;
      } else {
        reusedThisBatch += 1;
      }
    }
    const lastRow = batch.at(-1);
    const checkpoint = await saveMigrationCheckpoint(ctx, {
      runId,
      operation: EPISODE_OPERATIONS.bangers,
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
      operation: EPISODE_OPERATIONS.bangers,
      processedThisBatch: batch.length,
      insertedThisBatch,
      reusedThisBatch,
      completed,
    });
    return migrationCheckpointResult(checkpoint);
  },
});

export const transformEpisodeAudioMessagesBatch =
  internalMigrationMutation({
    args: { batchSize: v.number() },
    returns: checkpointResultValidator,
    handler: async (ctx, args) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        EPISODE_OPERATIONS.audioMessages,
      );
      requireMigrationBatchSize(args.batchSize);
      const runId = ctx.systemState.cutoverRunId;
      await getActiveDomainRun(ctx, { runId, domain: DOMAIN });
      await requireCompletedCheckpoint(
        ctx,
        runId,
        EPISODE_OPERATIONS.episodes,
      );
      const previous = await getMigrationCheckpoint(
        ctx,
        runId,
        EPISODE_OPERATIONS.audioMessages,
      );
      if (previous?.status === "completed") {
        return migrationCheckpointResult(previous);
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
          "The episode audio checkpoint cursor is invalid.",
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
      let insertedThisBatch = 0;
      let reusedThisBatch = 0;
      for (const row of batch) {
        const outcome = await upsertEpisodeAudioMessage(ctx, row);
        if (outcome === "inserted") {
          insertedThisBatch += 1;
        } else {
          reusedThisBatch += 1;
        }
      }
      const lastRow = batch.at(-1);
      const checkpoint = await saveMigrationCheckpoint(ctx, {
        runId,
        operation: EPISODE_OPERATIONS.audioMessages,
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
        operation: EPISODE_OPERATIONS.audioMessages,
        processedThisBatch: batch.length,
        insertedThisBatch,
        reusedThisBatch,
        completed,
      });
      return migrationCheckpointResult(checkpoint);
    },
  });

export const finishEpisodeRun = internalMigrationMutation({
  args: {},
  returns: v.object({
    runId: v.string(),
    status: v.literal("transformed"),
    episodes: v.number(),
    links: v.number(),
    bangers: v.number(),
    audioMessages: v.number(),
  }),
  handler: async (ctx) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      EPISODE_OPERATIONS.finish,
    );
    const runId = ctx.systemState.cutoverRunId;
    const { domainRun } = await getActiveDomainRun(ctx, {
      runId,
      domain: DOMAIN,
    });
    const episodes = await getMigrationCheckpoint(
      ctx,
      runId,
      EPISODE_OPERATIONS.episodes,
    );
    const links = await getMigrationCheckpoint(
      ctx,
      runId,
      EPISODE_OPERATIONS.links,
    );
    const bangers = await getMigrationCheckpoint(
      ctx,
      runId,
      EPISODE_OPERATIONS.bangers,
    );
    const audioMessages = await getMigrationCheckpoint(
      ctx,
      runId,
      EPISODE_OPERATIONS.audioMessages,
    );
    if (
      episodes?.status !== "completed" ||
      links?.status !== "completed" ||
      bangers?.status !== "completed" ||
      audioMessages?.status !== "completed"
    ) {
      domainError(
        "CONFLICT",
        "Every episode transform checkpoint must be complete.",
      );
    }
    if (
      episodes.processedCount !==
        domainRun.expectedCounts.episodes ||
      links.processedCount !== domainRun.expectedCounts.links ||
      bangers.processedCount !==
        domainRun.expectedCounts.bangers ||
      audioMessages.processedCount !==
        domainRun.expectedCounts.audioMessages
    ) {
      domainError(
        "CONFLICT",
        "Episode transform counts do not match source expectations.",
        {
          details: {
            episodes: episodes.processedCount,
            links: links.processedCount,
            bangers: bangers.processedCount,
            audioMessages: audioMessages.processedCount,
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
      action: "migration.episodes.transformed",
      targetType: "migrationDomainRun",
      targetId: domainRun._id,
      cutoverRunId: runId,
      metadata: {
        episodes: episodes.processedCount,
        links: links.processedCount,
        bangers: bangers.processedCount,
        audioMessages: audioMessages.processedCount,
      },
    });
    return {
      runId,
      status: "transformed" as const,
      episodes: episodes.processedCount,
      links: links.processedCount,
      bangers: bangers.processedCount,
      audioMessages: audioMessages.processedCount,
    };
  },
});
