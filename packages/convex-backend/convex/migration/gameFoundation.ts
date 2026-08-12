import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { internalMigrationMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import { GAME_OPERATIONS } from "./constants.js";
import { normalizeLookupKey } from "./normalize.js";
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

const DOMAIN = "games";
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
type UpsertOutcome = "inserted" | "reused";

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

function requireTinyInt(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 255) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must fit the SQL tinyint range.`,
    );
  }
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

async function resolveGameTypeId(
  ctx: DatabaseContext,
  legacyId: number,
): Promise<Id<"gameTypes">> {
  requireTinyInt(legacyId, "Game type relationship ID");
  const document = await ctx.db
    .query("gameTypes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  if (!document) {
    domainError(
      "CONFLICT",
      "A game record references a missing canonical game type.",
    );
  }
  return document._id;
}

async function resolveSeasonId(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Id<"seasons">> {
  const normalized = normalizeUuid(
    legacyId,
    "Point season relationship ID",
  );
  const document = await ctx.db
    .query("seasons")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalized),
    )
    .unique();
  if (!document) {
    domainError(
      "CONFLICT",
      "A point references a missing canonical season.",
    );
  }
  return document._id;
}

async function resolveUserId(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Id<"users">> {
  const document = await ctx.db
    .query("users")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  if (!document) {
    domainError(
      "CONFLICT",
      "A point references a missing canonical user.",
    );
  }
  return document._id;
}

async function resolveOptionalGamePointTypeId(
  ctx: DatabaseContext,
  legacyId: number | undefined,
): Promise<Id<"gamePointTypes"> | undefined> {
  if (legacyId === undefined) {
    return undefined;
  }
  requireTinyInt(legacyId, "Game point type relationship ID");
  const document = await ctx.db
    .query("gamePointTypes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  if (!document) {
    domainError(
      "CONFLICT",
      "A point references a missing canonical game point type.",
    );
  }
  return document._id;
}

async function upsertGameType(
  ctx: DatabaseContext,
  row: Doc<"migrationRawGameTypes">,
): Promise<UpsertOutcome> {
  requireTinyInt(row.legacyId, "Game type legacy ID");
  const normalizedLookupId = normalizeLookupKey(
    row.lookupId,
    "Game type lookup ID",
  );
  const existing = await ctx.db
    .query("gameTypes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", row.legacyId),
    )
    .unique();
  const lookupCollision = await ctx.db
    .query("gameTypes")
    .withIndex("by_normalizedLookupId", (query) =>
      query.eq("normalizedLookupId", normalizedLookupId),
    )
    .unique();
  if (lookupCollision && lookupCollision._id !== existing?._id) {
    domainError(
      "CONFLICT",
      "Game type normalization produced a duplicate canonical key.",
    );
  }
  if (existing) {
    const matches =
      existing.title === row.title &&
      existing.description === row.description &&
      existing.lookupId === row.lookupId &&
      existing.normalizedLookupId === normalizedLookupId;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated game type conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("gameTypes", {
    legacyId: row.legacyId,
    title: row.title,
    ...(row.description === undefined
      ? {}
      : { description: row.description }),
    lookupId: row.lookupId,
    normalizedLookupId,
  });
  return "inserted";
}

async function upsertGamePointType(
  ctx: DatabaseContext,
  row: Doc<"migrationRawGamePointTypes">,
): Promise<UpsertOutcome> {
  requireTinyInt(row.legacyId, "Game point type legacy ID");
  requireSmallInt(row.points, "Game point type points");
  const gameTypeId = await resolveGameTypeId(
    ctx,
    row.gameTypeLegacyId,
  );
  const normalizedLookupId = normalizeLookupKey(
    row.lookupId,
    "Game point type lookup ID",
  );
  const existing = await ctx.db
    .query("gamePointTypes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", row.legacyId),
    )
    .unique();
  const lookupCollision = await ctx.db
    .query("gamePointTypes")
    .withIndex("by_normalizedLookupId", (query) =>
      query.eq("normalizedLookupId", normalizedLookupId),
    )
    .unique();
  if (lookupCollision && lookupCollision._id !== existing?._id) {
    domainError(
      "CONFLICT",
      "Game point type normalization produced a duplicate canonical key.",
    );
  }
  if (existing) {
    const matches =
      existing.lookupId === row.lookupId &&
      existing.normalizedLookupId === normalizedLookupId &&
      existing.title === row.title &&
      existing.description === row.description &&
      existing.points === row.points &&
      existing.gameTypeId === gameTypeId;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated game point type conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("gamePointTypes", {
    legacyId: row.legacyId,
    lookupId: row.lookupId,
    normalizedLookupId,
    title: row.title,
    ...(row.description === undefined
      ? {}
      : { description: row.description }),
    points: row.points,
    gameTypeId,
  });
  return "inserted";
}

async function upsertSeason(
  ctx: DatabaseContext,
  row: Doc<"migrationRawSeasons">,
): Promise<UpsertOutcome> {
  const legacyId = normalizeUuid(row.legacyId, "Season legacy ID");
  if (row.endedOn !== undefined) {
    requireCalendarDate(row.endedOn, "Season end date");
  }
  if (row.startedOn !== undefined) {
    requireCalendarDate(row.startedOn, "Season start date");
  }
  const gameTypeId = await resolveGameTypeId(
    ctx,
    row.gameTypeLegacyId,
  );
  const existing = await ctx.db
    .query("seasons")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  if (existing) {
    const matches =
      existing.title === row.title &&
      existing.description === row.description &&
      existing.gameTypeId === gameTypeId &&
      existing.endedOn === row.endedOn &&
      existing.startedOn === row.startedOn;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated season conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("seasons", {
    legacyId,
    title: row.title,
    ...(row.description === undefined
      ? {}
      : { description: row.description }),
    gameTypeId,
    ...(row.endedOn === undefined ? {} : { endedOn: row.endedOn }),
    ...(row.startedOn === undefined
      ? {}
      : { startedOn: row.startedOn }),
  });
  return "inserted";
}

async function upsertPoint(
  ctx: DatabaseContext,
  row: Doc<"migrationRawPoints">,
): Promise<UpsertOutcome> {
  const legacyId = normalizeUuid(row.legacyId, "Point legacy ID");
  if (!Number.isFinite(row.earnedAt)) {
    domainError(
      "VALIDATION_FAILED",
      "Point earned time must be finite.",
    );
  }
  if (row.adjustment !== null) {
    requireSqlInt(row.adjustment, "Point adjustment");
  }
  const userId = await resolveUserId(ctx, row.userLegacyId);
  const seasonId = await resolveSeasonId(
    ctx,
    row.seasonLegacyId,
  );
  const gamePointTypeId = await resolveOptionalGamePointTypeId(
    ctx,
    row.gamePointTypeLegacyId,
  );
  const existing = await ctx.db
    .query("points")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  if (existing) {
    const matches =
      existing.userId === userId &&
      existing.seasonId === seasonId &&
      existing.reason === row.reason &&
      existing.earnedAt === row.earnedAt &&
      existing.adjustment === row.adjustment &&
      existing.gamePointTypeId === gamePointTypeId;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated point conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("points", {
    legacyId,
    userId,
    seasonId,
    ...(row.reason === undefined ? {} : { reason: row.reason }),
    earnedAt: row.earnedAt,
    adjustment: row.adjustment,
    ...(gamePointTypeId === undefined ? {} : { gamePointTypeId }),
  });
  return "inserted";
}

export const startGameRun = internalMigrationMutation({
  args: {
    sourceSchemaFingerprint: v.string(),
    expectedGameTypes: v.number(),
    expectedGamePointTypes: v.number(),
    expectedSeasons: v.number(),
    expectedPoints: v.number(),
    expectedGuesses: v.number(),
    expectedGamblingTypes: v.number(),
    expectedGamblingEntries: v.number(),
    expectedTagVotes: v.number(),
    expectedQuoteSubmissions: v.number(),
  },
  returns: v.object({
    runId: v.string(),
    status: runStatusValidator,
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      GAME_OPERATIONS.start,
    );
    const expectedCounts = {
      gameTypes: args.expectedGameTypes,
      gamePointTypes: args.expectedGamePointTypes,
      seasons: args.expectedSeasons,
      points: args.expectedPoints,
      guesses: args.expectedGuesses,
      gamblingTypes: args.expectedGamblingTypes,
      gamblingEntries: args.expectedGamblingEntries,
      tagVotes: args.expectedTagVotes,
      quoteSubmissions: args.expectedQuoteSubmissions,
    };
    for (const [name, count] of Object.entries(expectedCounts)) {
      requireMigrationCount(count, `Expected game ${name} count`);
    }
    const runId = ctx.systemState.cutoverRunId;
    await requireReconciledDomain(ctx, {
      runId,
      domain: "identity",
    });
    await requireReconciledDomain(ctx, {
      runId,
      domain: "reviews",
    });
    const result = await startDomainRun(ctx, {
      runId,
      domain: DOMAIN,
      sourceSchemaFingerprint: args.sourceSchemaFingerprint,
      expectedCounts,
    });
    if (result.created) {
      await writeAuditEvent(ctx, {
        actor: ctx.actor,
        action: "migration.games.started",
        targetType: "migrationDomainRun",
        targetId: result.domainRun._id,
        cutoverRunId: result.run.runId,
        metadata: expectedCounts,
      });
    }
    return {
      runId: result.run.runId,
      status: result.domainRun.status,
      created: result.created,
    };
  },
});

export const transformGameTypesBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: checkpointResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      GAME_OPERATIONS.gameTypes,
    );
    requireMigrationBatchSize(args.batchSize);
    const runId = ctx.systemState.cutoverRunId;
    await getActiveDomainRun(ctx, { runId, domain: DOMAIN });
    const previous = await getMigrationCheckpoint(
      ctx,
      runId,
      GAME_OPERATIONS.gameTypes,
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
        "The game-type checkpoint cursor is invalid.",
      );
    }
    const rows = await ctx.db
      .query("migrationRawGameTypes")
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
      const outcome = await upsertGameType(ctx, row);
      if (outcome === "inserted") {
        insertedThisBatch += 1;
      } else {
        reusedThisBatch += 1;
      }
    }
    const lastRow = batch.at(-1);
    const checkpoint = await saveMigrationCheckpoint(ctx, {
      runId,
      operation: GAME_OPERATIONS.gameTypes,
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
      operation: GAME_OPERATIONS.gameTypes,
      processedThisBatch: batch.length,
      insertedThisBatch,
      reusedThisBatch,
      completed,
    });
    return migrationCheckpointResult(checkpoint);
  },
});

export const transformGamePointTypesBatch =
  internalMigrationMutation({
    args: { batchSize: v.number() },
    returns: checkpointResultValidator,
    handler: async (ctx, args) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        GAME_OPERATIONS.gamePointTypes,
      );
      requireMigrationBatchSize(args.batchSize);
      const runId = ctx.systemState.cutoverRunId;
      await getActiveDomainRun(ctx, { runId, domain: DOMAIN });
      await requireCompletedMigrationCheckpoint(ctx, {
        runId,
        operation: GAME_OPERATIONS.gameTypes,
      });
      const previous = await getMigrationCheckpoint(
        ctx,
        runId,
        GAME_OPERATIONS.gamePointTypes,
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
          "The game-point-type checkpoint cursor is invalid.",
        );
      }
      const rows = await ctx.db
        .query("migrationRawGamePointTypes")
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
        const outcome = await upsertGamePointType(ctx, row);
        if (outcome === "inserted") {
          insertedThisBatch += 1;
        } else {
          reusedThisBatch += 1;
        }
      }
      const lastRow = batch.at(-1);
      const checkpoint = await saveMigrationCheckpoint(ctx, {
        runId,
        operation: GAME_OPERATIONS.gamePointTypes,
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
        operation: GAME_OPERATIONS.gamePointTypes,
        processedThisBatch: batch.length,
        insertedThisBatch,
        reusedThisBatch,
        completed,
      });
      return migrationCheckpointResult(checkpoint);
    },
  });

export const transformSeasonsBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: checkpointResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      GAME_OPERATIONS.seasons,
    );
    requireMigrationBatchSize(args.batchSize);
    const runId = ctx.systemState.cutoverRunId;
    await getActiveDomainRun(ctx, { runId, domain: DOMAIN });
    await requireCompletedMigrationCheckpoint(ctx, {
      runId,
      operation: GAME_OPERATIONS.gameTypes,
    });
    const previous = await getMigrationCheckpoint(
      ctx,
      runId,
      GAME_OPERATIONS.seasons,
    );
    if (previous?.status === "completed") {
      return migrationCheckpointResult(previous);
    }
    const rows = await ctx.db
      .query("migrationRawSeasons")
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
      const outcome = await upsertSeason(ctx, row);
      if (outcome === "inserted") {
        insertedThisBatch += 1;
      } else {
        reusedThisBatch += 1;
      }
    }
    const lastRow = batch.at(-1);
    const checkpoint = await saveMigrationCheckpoint(ctx, {
      runId,
      operation: GAME_OPERATIONS.seasons,
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
      operation: GAME_OPERATIONS.seasons,
      processedThisBatch: batch.length,
      insertedThisBatch,
      reusedThisBatch,
      completed,
    });
    return migrationCheckpointResult(checkpoint);
  },
});

export const transformPointsBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: checkpointResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      GAME_OPERATIONS.points,
    );
    requireMigrationBatchSize(args.batchSize);
    const runId = ctx.systemState.cutoverRunId;
    await getActiveDomainRun(ctx, { runId, domain: DOMAIN });
    await requireCompletedMigrationCheckpoint(ctx, {
      runId,
      operation: GAME_OPERATIONS.gamePointTypes,
    });
    await requireCompletedMigrationCheckpoint(ctx, {
      runId,
      operation: GAME_OPERATIONS.seasons,
    });
    const previous = await getMigrationCheckpoint(
      ctx,
      runId,
      GAME_OPERATIONS.points,
    );
    if (previous?.status === "completed") {
      return migrationCheckpointResult(previous);
    }
    const rows = await ctx.db
      .query("migrationRawPoints")
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
      const outcome = await upsertPoint(ctx, row);
      if (outcome === "inserted") {
        insertedThisBatch += 1;
      } else {
        reusedThisBatch += 1;
      }
    }
    const lastRow = batch.at(-1);
    const checkpoint = await saveMigrationCheckpoint(ctx, {
      runId,
      operation: GAME_OPERATIONS.points,
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
      operation: GAME_OPERATIONS.points,
      processedThisBatch: batch.length,
      insertedThisBatch,
      reusedThisBatch,
      completed,
    });
    return migrationCheckpointResult(checkpoint);
  },
});
