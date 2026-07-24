import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { internalMigrationMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import type { ApplicationActor } from "../lib/actors.js";
import { domainError } from "../lib/errors.js";
import {
  RANKING_RECONCILIATION_OPERATIONS,
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

const DOMAIN = "rankings";
const reconciliationResultValidator = v.object({
  operation: v.string(),
  status: v.union(
    v.literal("running"),
    v.literal("completed"),
  ),
  checkedCount: v.number(),
});
type DatabaseContext = Pick<MutationCtx, "db">;
type MigrationContext = MutationCtx & {
  actor: ApplicationActor;
  migrationOperationId: string;
  systemState: Doc<"systemState">;
};
type RawTable =
  | "migrationRawRankedItems"
  | "migrationRawRankedLists"
  | "migrationRawRankedListTypes";
interface RawRowByTable {
  migrationRawRankedItems: Doc<"migrationRawRankedItems">;
  migrationRawRankedLists: Doc<"migrationRawRankedLists">;
  migrationRawRankedListTypes: Doc<"migrationRawRankedListTypes">;
}

function normalizeUuid(value: string): string {
  return value.toLowerCase();
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
      "Ranking reconciliation found a missing user parent.",
    );
  }
  return document._id;
}

async function resolveListType(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Doc<"rankedListTypes">> {
  const document = await ctx.db
    .query("rankedListTypes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(legacyId)),
    )
    .unique();
  if (!document) {
    domainError(
      "CONFLICT",
      "Ranking reconciliation found a missing list-type parent.",
    );
  }
  return document;
}

async function resolveList(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Doc<"rankedLists">> {
  const document = await ctx.db
    .query("rankedLists")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(legacyId)),
    )
    .unique();
  if (!document) {
    domainError(
      "CONFLICT",
      "Ranking reconciliation found a missing list parent.",
    );
  }
  return document;
}

async function resolveMovieId(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Id<"movies">> {
  const document = await ctx.db
    .query("movies")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(legacyId)),
    )
    .unique();
  if (!document) {
    domainError(
      "CONFLICT",
      "Ranking reconciliation found a missing movie parent.",
    );
  }
  return document._id;
}

async function resolveShowId(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Id<"shows">> {
  const document = await ctx.db
    .query("shows")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(legacyId)),
    )
    .unique();
  if (!document) {
    domainError(
      "CONFLICT",
      "Ranking reconciliation found a missing show parent.",
    );
  }
  return document._id;
}

async function resolveEpisodeId(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Id<"episodes">> {
  const document = await ctx.db
    .query("episodes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(legacyId)),
    )
    .unique();
  if (!document) {
    domainError(
      "CONFLICT",
      "Ranking reconciliation found a missing episode parent.",
    );
  }
  return document._id;
}

async function verifyListType(
  ctx: DatabaseContext,
  row: Doc<"migrationRawRankedListTypes">,
): Promise<void> {
  const canonical = await ctx.db
    .query("rankedListTypes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(row.legacyId)),
    )
    .unique();
  if (
    canonical?.name !== row.name ||
    canonical.description !== row.description ||
    canonical.maxItems !== row.maxItems ||
    canonical.targetType !== row.targetType ||
    canonical.createdAt !== row.createdAt ||
    canonical.updatedAt !== row.updatedAt
  ) {
    domainError(
      "CONFLICT",
      "Ranking reconciliation found a list-type mismatch.",
    );
  }
}

async function verifyList(
  ctx: DatabaseContext,
  row: Doc<"migrationRawRankedLists">,
): Promise<void> {
  const userId = await resolveUserId(ctx, row.userLegacyId);
  const listType = await resolveListType(
    ctx,
    row.rankedListTypeLegacyId,
  );
  const canonical = await ctx.db
    .query("rankedLists")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(row.legacyId)),
    )
    .unique();
  if (
    canonical?.userId !== userId ||
    canonical.rankedListTypeId !== listType._id ||
    canonical.status !== row.status ||
    canonical.title !== row.title ||
    canonical.createdAt !== row.createdAt ||
    canonical.updatedAt !== row.updatedAt
  ) {
    domainError(
      "CONFLICT",
      "Ranking reconciliation found a list mismatch.",
    );
  }
}

async function expectedTarget(
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
      "CONFLICT",
      "Ranking reconciliation found an invalid target shape.",
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
    "CONFLICT",
    "Ranking reconciliation found a target/list-type mismatch.",
  );
}

async function verifyItem(
  ctx: DatabaseContext,
  row: Doc<"migrationRawRankedItems">,
): Promise<void> {
  const list = await resolveList(ctx, row.rankedListLegacyId);
  const listType = await ctx.db.get(
    "rankedListTypes",
    list.rankedListTypeId,
  );
  if (!listType) {
    domainError(
      "CONFLICT",
      "Ranking reconciliation found a missing list-type document.",
    );
  }
  const target = await expectedTarget(ctx, row, listType);
  const canonical = await ctx.db
    .query("rankedItems")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(row.legacyId)),
    )
    .unique();
  if (
    canonical?.rankedListId !== list._id ||
    canonical.targetType !== target.targetType ||
    canonical.movieId !==
      ("movieId" in target ? target.movieId : undefined) ||
    canonical.showId !==
      ("showId" in target ? target.showId : undefined) ||
    canonical.episodeId !==
      ("episodeId" in target ? target.episodeId : undefined) ||
    canonical.rank !== row.rank ||
    canonical.comment !== row.comment ||
    canonical.createdAt !== row.createdAt ||
    canonical.updatedAt !== row.updatedAt
  ) {
    domainError(
      "CONFLICT",
      "Ranking reconciliation found an item mismatch.",
    );
  }
}

function reconciliationDefinition<RowTable extends RawTable>(
  operation: string,
  readRows: (
    ctx: DatabaseContext,
    runId: string,
    previousLegacyId: string | undefined,
    limit: number,
  ) => Promise<Array<RawRowByTable[RowTable]>>,
  verify: (
    ctx: DatabaseContext,
    row: RawRowByTable[RowTable],
  ) => Promise<void>,
) {
  return {
    args: { batchSize: v.number() },
    returns: reconciliationResultValidator,
    handler: async (
      ctx: MigrationContext,
      args: { batchSize: number },
    ) => {
      requireMigrationOperation(ctx.migrationOperationId, operation);
      requireMigrationBatchSize(args.batchSize);
      const runId = ctx.systemState.cutoverRunId;
      await getReconciliationDomainRun(ctx, {
        runId,
        domain: DOMAIN,
      });
      const previous = await getMigrationCheckpoint(
        ctx,
        runId,
        operation,
      );
      if (previous?.status === "completed") {
        return reconciliationCheckpointResult(previous);
      }
      const rows = await readRows(
        ctx,
        runId,
        previous?.lastLegacyKey,
        args.batchSize + 1,
      );
      const batch = rows.slice(0, args.batchSize);
      const completed = rows.length <= args.batchSize;
      for (const row of batch) {
        await verify(ctx, row);
      }
      const lastRow = batch.at(-1);
      const checkpoint = await saveMigrationCheckpoint(ctx, {
        runId,
        operation,
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
        operation,
        checkedThisBatch: batch.length,
        completed,
      });
      return reconciliationCheckpointResult(checkpoint);
    },
  };
}

export const reconcileListTypesBatch = internalMigrationMutation(
  reconciliationDefinition<"migrationRawRankedListTypes">(
    RANKING_RECONCILIATION_OPERATIONS.listTypes,
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
    verifyListType,
  ),
);

export const reconcileListsBatch = internalMigrationMutation(
  reconciliationDefinition<"migrationRawRankedLists">(
    RANKING_RECONCILIATION_OPERATIONS.lists,
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
    verifyList,
  ),
);

export const reconcileItemsBatch = internalMigrationMutation(
  reconciliationDefinition<"migrationRawRankedItems">(
    RANKING_RECONCILIATION_OPERATIONS.items,
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
    verifyItem,
  ),
);

export const finishRankingReconciliation =
  internalMigrationMutation({
    args: {},
    returns: v.object({
      runId: v.string(),
      status: v.literal("reconciled"),
      counts: v.record(v.string(), v.number()),
    }),
    handler: async (ctx) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        RANKING_RECONCILIATION_OPERATIONS.finish,
      );
      const runId = ctx.systemState.cutoverRunId;
      const { domainRun } = await getReconciliationDomainRun(ctx, {
        runId,
        domain: DOMAIN,
      });
      const operations = {
        listTypes: RANKING_RECONCILIATION_OPERATIONS.listTypes,
        lists: RANKING_RECONCILIATION_OPERATIONS.lists,
        items: RANKING_RECONCILIATION_OPERATIONS.items,
      };
      const counts: Record<string, number> = {};
      for (const [name, operation] of Object.entries(operations)) {
        const checkpoint = await getMigrationCheckpoint(
          ctx,
          runId,
          operation,
        );
        if (checkpoint?.status !== "completed") {
          domainError(
            "CONFLICT",
            "Every ranking reconciliation checkpoint must be complete.",
          );
        }
        counts[name] = checkpoint.reusedCount;
      }
      if (
        Object.entries(counts).some(
          ([name, count]) =>
            domainRun.expectedCounts[name] !== count,
        )
      ) {
        domainError(
          "CONFLICT",
          "Ranking reconciliation counts do not match source expectations.",
          { details: counts },
        );
      }
      if (domainRun.status !== "reconciled") {
        await ctx.db.patch("migrationDomainRuns", domainRun._id, {
          status: "reconciled",
          updatedAt: Date.now(),
        });
        await writeAuditEvent(ctx, {
          actor: ctx.actor,
          action: "migration.rankings.reconciled",
          targetType: "migrationDomainRun",
          targetId: domainRun._id,
          cutoverRunId: runId,
          metadata: counts,
        });
      }
      return {
        runId,
        status: "reconciled" as const,
        counts,
      };
    },
  });
