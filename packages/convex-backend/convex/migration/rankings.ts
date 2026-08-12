import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { internalMigrationMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import type { ApplicationActor } from "../lib/actors.js";
import { domainError } from "../lib/errors.js";
import {
  RANKING_OPERATIONS,
  SOURCE_SCHEMA_FINGERPRINT,
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

const DOMAIN = "rankings";
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
type DatabaseContext = Pick<MutationCtx, "db">;
type MigrationContext = MutationCtx & {
  actor: ApplicationActor;
  migrationOperationId: string;
  systemState: Doc<"systemState">;
};
type UpsertOutcome = "inserted" | "reused";
type RawTable =
  | "migrationRawRankedItems"
  | "migrationRawRankedLists"
  | "migrationRawRankedListTypes";
interface RawRowByTable {
  migrationRawRankedItems: Doc<"migrationRawRankedItems">;
  migrationRawRankedLists: Doc<"migrationRawRankedLists">;
  migrationRawRankedListTypes: Doc<"migrationRawRankedListTypes">;
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

function requireFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    domainError("VALIDATION_FAILED", `${label} must be finite.`);
  }
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
      "A ranked list references a missing canonical user.",
    );
  }
  return document._id;
}

async function resolveListType(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Doc<"rankedListTypes">> {
  const normalized = normalizeUuid(
    legacyId,
    "Ranked list type relationship ID",
  );
  const document = await ctx.db
    .query("rankedListTypes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalized),
    )
    .unique();
  if (!document) {
    domainError(
      "CONFLICT",
      "A ranked list references a missing canonical list type.",
    );
  }
  return document;
}

async function resolveRankedList(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Doc<"rankedLists">> {
  const normalized = normalizeUuid(
    legacyId,
    "Ranked item list relationship ID",
  );
  const document = await ctx.db
    .query("rankedLists")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalized),
    )
    .unique();
  if (!document) {
    domainError(
      "CONFLICT",
      "A ranked item references a missing canonical list.",
    );
  }
  return document;
}

async function resolveMovieId(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Id<"movies">> {
  const normalized = normalizeUuid(
    legacyId,
    "Ranked item movie relationship ID",
  );
  const document = await ctx.db
    .query("movies")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalized),
    )
    .unique();
  if (!document) {
    domainError(
      "CONFLICT",
      "A ranked item references a missing canonical movie.",
    );
  }
  return document._id;
}

async function resolveShowId(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Id<"shows">> {
  const normalized = normalizeUuid(
    legacyId,
    "Ranked item show relationship ID",
  );
  const document = await ctx.db
    .query("shows")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalized),
    )
    .unique();
  if (!document) {
    domainError(
      "CONFLICT",
      "A ranked item references a missing canonical show.",
    );
  }
  return document._id;
}

async function resolveEpisodeId(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Id<"episodes">> {
  const normalized = normalizeUuid(
    legacyId,
    "Ranked item episode relationship ID",
  );
  const document = await ctx.db
    .query("episodes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalized),
    )
    .unique();
  if (!document) {
    domainError(
      "CONFLICT",
      "A ranked item references a missing canonical episode.",
    );
  }
  return document._id;
}

async function upsertListType(
  ctx: DatabaseContext,
  row: Doc<"migrationRawRankedListTypes">,
): Promise<UpsertOutcome> {
  const legacyId = normalizeUuid(
    row.legacyId,
    "Ranked list type legacy ID",
  );
  requireSqlInt(row.maxItems, "Ranked list type max items");
  if (row.maxItems < 1 || row.maxItems > 100) {
    domainError(
      "VALIDATION_FAILED",
      "Ranked list type max items must be from 1 through 100.",
    );
  }
  requireFinite(row.createdAt, "Ranked list type creation time");
  requireFinite(row.updatedAt, "Ranked list type update time");
  const existing = await ctx.db
    .query("rankedListTypes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  if (existing) {
    const matches =
      existing.name === row.name &&
      existing.description === row.description &&
      existing.maxItems === row.maxItems &&
      existing.targetType === row.targetType &&
      existing.createdAt === row.createdAt &&
      existing.updatedAt === row.updatedAt;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated ranked-list type conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("rankedListTypes", {
    legacyId,
    name: row.name,
    ...(row.description === undefined
      ? {}
      : { description: row.description }),
    maxItems: row.maxItems,
    targetType: row.targetType,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  return "inserted";
}

async function upsertList(
  ctx: DatabaseContext,
  row: Doc<"migrationRawRankedLists">,
): Promise<UpsertOutcome> {
  const legacyId = normalizeUuid(row.legacyId, "Ranked list legacy ID");
  requireFinite(row.createdAt, "Ranked list creation time");
  requireFinite(row.updatedAt, "Ranked list update time");
  const userId = await resolveUserId(ctx, row.userLegacyId);
  const listType = await resolveListType(
    ctx,
    row.rankedListTypeLegacyId,
  );
  const existing = await ctx.db
    .query("rankedLists")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  if (existing) {
    const matches =
      existing.userId === userId &&
      existing.rankedListTypeId === listType._id &&
      existing.status === row.status &&
      existing.title === row.title &&
      existing.createdAt === row.createdAt &&
      existing.updatedAt === row.updatedAt;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated ranked list conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("rankedLists", {
    legacyId,
    userId,
    rankedListTypeId: listType._id,
    status: row.status,
    ...(row.title === undefined ? {} : { title: row.title }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  return "inserted";
}

async function expectedItemTarget(
  ctx: DatabaseContext,
  row: Doc<"migrationRawRankedItems">,
  listType: Doc<"rankedListTypes">,
): Promise<
  | {
      targetType: "movie";
      movieId: Id<"movies">;
    }
  | {
      targetType: "show";
      showId: Id<"shows">;
    }
  | {
      targetType: "episode";
      episodeId: Id<"episodes">;
    }
> {
  const targetCount =
    (row.movieLegacyId === undefined ? 0 : 1) +
    (row.showLegacyId === undefined ? 0 : 1) +
    (row.episodeLegacyId === undefined ? 0 : 1);
  if (targetCount !== 1) {
    domainError(
      "VALIDATION_FAILED",
      "A ranked item must reference exactly one target.",
    );
  }
  if (
    listType.targetType === "MOVIE" &&
    row.movieLegacyId !== undefined
  ) {
    return {
      targetType: "movie",
      movieId: await resolveMovieId(ctx, row.movieLegacyId),
    };
  }
  if (
    listType.targetType === "SHOW" &&
    row.showLegacyId !== undefined
  ) {
    return {
      targetType: "show",
      showId: await resolveShowId(ctx, row.showLegacyId),
    };
  }
  if (
    listType.targetType === "EPISODE" &&
    row.episodeLegacyId !== undefined
  ) {
    return {
      targetType: "episode",
      episodeId: await resolveEpisodeId(
        ctx,
        row.episodeLegacyId,
      ),
    };
  }
  domainError(
    "VALIDATION_FAILED",
    "A ranked item target must match its owning list type.",
  );
}

async function upsertItem(
  ctx: DatabaseContext,
  row: Doc<"migrationRawRankedItems">,
): Promise<UpsertOutcome> {
  const legacyId = normalizeUuid(row.legacyId, "Ranked item legacy ID");
  requireSqlInt(row.rank, "Ranked item rank");
  requireFinite(row.createdAt, "Ranked item creation time");
  requireFinite(row.updatedAt, "Ranked item update time");
  const list = await resolveRankedList(ctx, row.rankedListLegacyId);
  const listType = await ctx.db.get(
    "rankedListTypes",
    list.rankedListTypeId,
  );
  if (!listType) {
    domainError(
      "CONFLICT",
      "A ranked item list has a missing canonical list type.",
    );
  }
  if (row.rank < 1 || row.rank > listType.maxItems) {
    domainError(
      "VALIDATION_FAILED",
      "A ranked item rank is outside its list-type bounds.",
    );
  }
  const target = await expectedItemTarget(ctx, row, listType);
  const existing = await ctx.db
    .query("rankedItems")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  const rankCollision = await ctx.db
    .query("rankedItems")
    .withIndex("by_rankedListId_and_rank", (query) =>
      query.eq("rankedListId", list._id).eq("rank", row.rank),
    )
    .unique();
  if (rankCollision && rankCollision._id !== existing?._id) {
    domainError(
      "CONFLICT",
      "Ranked-item migration produced a duplicate list/rank key.",
    );
  }
  if (existing) {
    const matches =
      existing.rankedListId === list._id &&
      existing.targetType === target.targetType &&
      existing.movieId ===
        ("movieId" in target ? target.movieId : undefined) &&
      existing.showId ===
        ("showId" in target ? target.showId : undefined) &&
      existing.episodeId ===
        ("episodeId" in target ? target.episodeId : undefined) &&
      existing.rank === row.rank &&
      existing.comment === row.comment &&
      existing.createdAt === row.createdAt &&
      existing.updatedAt === row.updatedAt;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated ranked item conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("rankedItems", {
    legacyId,
    rankedListId: list._id,
    ...target,
    rank: row.rank,
    ...(row.comment === undefined ? {} : { comment: row.comment }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  return "inserted";
}

async function transformBatch<Row extends { legacyId: string }>(
  ctx: MigrationContext,
  input: {
    runId: string;
    operation: string;
    batchSize: number;
    rows: Row[];
    previous: Doc<"migrationCheckpoints"> | null;
    upsert: (row: Row) => Promise<UpsertOutcome>;
  },
) {
  const batch = input.rows.slice(0, input.batchSize);
  const completed = input.rows.length <= input.batchSize;
  let insertedThisBatch = 0;
  let reusedThisBatch = 0;
  for (const row of batch) {
    const outcome = await input.upsert(row);
    if (outcome === "inserted") {
      insertedThisBatch += 1;
    } else {
      reusedThisBatch += 1;
    }
  }
  const lastRow = batch.at(-1);
  const checkpoint = await saveMigrationCheckpoint(ctx, {
    runId: input.runId,
    operation: input.operation,
    previous: input.previous,
    ...(lastRow === undefined
      ? {}
      : { lastLegacyKey: lastRow.legacyId }),
    processedThisBatch: batch.length,
    insertedThisBatch,
    reusedThisBatch,
    completed,
  });
  await writeMigrationBatchAudit(ctx, {
    runId: input.runId,
    domain: DOMAIN,
    operation: input.operation,
    processedThisBatch: batch.length,
    insertedThisBatch,
    reusedThisBatch,
    completed,
  });
  return migrationCheckpointResult(checkpoint);
}

function batchDefinition<RowTable extends RawTable>(
  operation: string,
  prerequisite: string | undefined,
  readRows: (
    ctx: DatabaseContext,
    runId: string,
    previousLegacyId: string | undefined,
    limit: number,
  ) => Promise<Array<RawRowByTable[RowTable]>>,
  upsert: (
    ctx: DatabaseContext,
    row: RawRowByTable[RowTable],
  ) => Promise<UpsertOutcome>,
) {
  return {
    args: { batchSize: v.number() },
    returns: checkpointResultValidator,
    handler: async (
      ctx: MigrationContext,
      args: { batchSize: number },
    ) => {
      requireMigrationOperation(ctx.migrationOperationId, operation);
      requireMigrationBatchSize(args.batchSize);
      const runId = ctx.systemState.cutoverRunId;
      await getActiveDomainRun(ctx, { runId, domain: DOMAIN });
      if (prerequisite !== undefined) {
        await requireCompletedMigrationCheckpoint(ctx, {
          runId,
          operation: prerequisite,
        });
      }
      const previous = await getMigrationCheckpoint(
        ctx,
        runId,
        operation,
      );
      if (previous?.status === "completed") {
        return migrationCheckpointResult(previous);
      }
      const rows = await readRows(
        ctx,
        runId,
        previous?.lastLegacyKey,
        args.batchSize + 1,
      );
      return await transformBatch(ctx, {
        runId,
        operation,
        batchSize: args.batchSize,
        rows,
        previous,
        upsert: async (row) => await upsert(ctx, row),
      });
    },
  };
}

export const startRankingRun = internalMigrationMutation({
  args: {
    sourceSchemaFingerprint: v.string(),
    expectedListTypes: v.number(),
    expectedLists: v.number(),
    expectedItems: v.number(),
  },
  returns: v.object({
    runId: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("transformed"),
      v.literal("reconciled"),
      v.literal("failed"),
    ),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      RANKING_OPERATIONS.start,
    );
    if (args.sourceSchemaFingerprint !== SOURCE_SCHEMA_FINGERPRINT) {
      domainError(
        "VALIDATION_FAILED",
        "Ranking source schema fingerprint is not approved.",
      );
    }
    requireMigrationCount(
      args.expectedListTypes,
      "Expected ranked-list type count",
    );
    requireMigrationCount(
      args.expectedLists,
      "Expected ranked-list count",
    );
    requireMigrationCount(
      args.expectedItems,
      "Expected ranked-item count",
    );
    const expectedCounts = {
      listTypes: args.expectedListTypes,
      lists: args.expectedLists,
      items: args.expectedItems,
    };
    const runId = ctx.systemState.cutoverRunId;
    await requireReconciledDomain(ctx, {
      runId,
      domain: "identity",
    });
    await requireReconciledDomain(ctx, {
      runId,
      domain: "catalog",
    });
    await requireReconciledDomain(ctx, {
      runId,
      domain: "episodes",
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
        action: "migration.rankings.started",
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

export const transformListTypesBatch = internalMigrationMutation(
  batchDefinition<"migrationRawRankedListTypes">(
    RANKING_OPERATIONS.listTypes,
    undefined,
    async (ctx, runId, previousLegacyId, limit) =>
      await ctx.db
        .query("migrationRawRankedListTypes")
        .withIndex("by_runId_and_legacyId", (query) =>
          previousLegacyId === undefined
            ? query.eq("runId", runId)
            : query
                .eq("runId", runId)
                .gt("legacyId", previousLegacyId),
        )
        .take(limit),
    upsertListType,
  ),
);

export const transformListsBatch = internalMigrationMutation(
  batchDefinition<"migrationRawRankedLists">(
    RANKING_OPERATIONS.lists,
    RANKING_OPERATIONS.listTypes,
    async (ctx, runId, previousLegacyId, limit) =>
      await ctx.db
        .query("migrationRawRankedLists")
        .withIndex("by_runId_and_legacyId", (query) =>
          previousLegacyId === undefined
            ? query.eq("runId", runId)
            : query
                .eq("runId", runId)
                .gt("legacyId", previousLegacyId),
        )
        .take(limit),
    upsertList,
  ),
);

export const transformItemsBatch = internalMigrationMutation(
  batchDefinition<"migrationRawRankedItems">(
    RANKING_OPERATIONS.items,
    RANKING_OPERATIONS.lists,
    async (ctx, runId, previousLegacyId, limit) =>
      await ctx.db
        .query("migrationRawRankedItems")
        .withIndex("by_runId_and_legacyId", (query) =>
          previousLegacyId === undefined
            ? query.eq("runId", runId)
            : query
                .eq("runId", runId)
                .gt("legacyId", previousLegacyId),
        )
        .take(limit),
    upsertItem,
  ),
);

export const finishRankingRun = internalMigrationMutation({
  args: {},
  returns: v.object({
    runId: v.string(),
    status: v.literal("transformed"),
    counts: v.record(v.string(), v.number()),
  }),
  handler: async (ctx) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      RANKING_OPERATIONS.finish,
    );
    const runId = ctx.systemState.cutoverRunId;
    const { domainRun } = await getActiveDomainRun(ctx, {
      runId,
      domain: DOMAIN,
    });
    const operations = {
      listTypes: RANKING_OPERATIONS.listTypes,
      lists: RANKING_OPERATIONS.lists,
      items: RANKING_OPERATIONS.items,
    };
    const counts: Record<string, number> = {};
    for (const [name, operation] of Object.entries(operations)) {
      const checkpoint = await requireCompletedMigrationCheckpoint(
        ctx,
        { runId, operation },
      );
      counts[name] = checkpoint.processedCount;
    }
    if (
      Object.entries(counts).some(
        ([name, count]) =>
          domainRun.expectedCounts[name] !== count,
      )
    ) {
      domainError(
        "CONFLICT",
        "Ranking transform counts do not match source expectations.",
        { details: counts },
      );
    }
    await ctx.db.patch("migrationDomainRuns", domainRun._id, {
      status: "transformed",
      updatedAt: Date.now(),
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "migration.rankings.transformed",
      targetType: "migrationDomainRun",
      targetId: domainRun._id,
      cutoverRunId: runId,
      metadata: counts,
    });
    return {
      runId,
      status: "transformed" as const,
      counts,
    };
  },
});
