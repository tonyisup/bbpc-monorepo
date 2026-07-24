import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { internalMigrationMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import type { ApplicationActor } from "../lib/actors.js";
import { domainError } from "../lib/errors.js";
import { GAME_RECONCILIATION_OPERATIONS } from "./constants.js";
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

const DOMAIN = "games";
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
type TagVoteAward = Doc<"tagVotes">["award"];
type RawTable =
  | "migrationRawGamePointTypes"
  | "migrationRawGameTypes"
  | "migrationRawGamblingEntries"
  | "migrationRawGamblingTypes"
  | "migrationRawGuesses"
  | "migrationRawPoints"
  | "migrationRawQuoteSubmissions"
  | "migrationRawSeasons"
  | "migrationRawTagVotes";
interface RawRowByTable {
  migrationRawGamePointTypes: Doc<"migrationRawGamePointTypes">;
  migrationRawGameTypes: Doc<"migrationRawGameTypes">;
  migrationRawGamblingEntries: Doc<"migrationRawGamblingEntries">;
  migrationRawGamblingTypes: Doc<"migrationRawGamblingTypes">;
  migrationRawGuesses: Doc<"migrationRawGuesses">;
  migrationRawPoints: Doc<"migrationRawPoints">;
  migrationRawQuoteSubmissions: Doc<"migrationRawQuoteSubmissions">;
  migrationRawSeasons: Doc<"migrationRawSeasons">;
  migrationRawTagVotes: Doc<"migrationRawTagVotes">;
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
      "Game reconciliation found a missing user parent.",
    );
  }
  return document._id;
}

async function resolveOptionalUserId(
  ctx: DatabaseContext,
  legacyId: string | undefined,
): Promise<Id<"users"> | undefined> {
  return legacyId === undefined
    ? undefined
    : await resolveUserId(ctx, legacyId);
}

async function resolveGameTypeId(
  ctx: DatabaseContext,
  legacyId: number,
): Promise<Id<"gameTypes">> {
  const document = await ctx.db
    .query("gameTypes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  if (!document) {
    domainError(
      "CONFLICT",
      "Game reconciliation found a missing game-type parent.",
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
  const document = await ctx.db
    .query("gamePointTypes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  if (!document) {
    domainError(
      "CONFLICT",
      "Game reconciliation found a missing game-point-type parent.",
    );
  }
  return document._id;
}

type UuidParentTable =
  | "assignments"
  | "assignmentReviews"
  | "episodes"
  | "gamblingTypes"
  | "points"
  | "ratings"
  | "seasons";

async function resolveUuidParent<Table extends UuidParentTable>(
  ctx: DatabaseContext,
  table: Table,
  legacyId: string,
): Promise<Id<Table>> {
  const normalized = normalizeUuid(legacyId);
  let documentId: Id<Table> | undefined;
  switch (table) {
    case "assignments": {
      const document = await ctx.db
        .query("assignments")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", normalized),
        )
        .unique();
      documentId = document?._id as Id<Table> | undefined;
      break;
    }
    case "assignmentReviews": {
      const document = await ctx.db
        .query("assignmentReviews")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", normalized),
        )
        .unique();
      documentId = document?._id as Id<Table> | undefined;
      break;
    }
    case "episodes": {
      const document = await ctx.db
        .query("episodes")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", normalized),
        )
        .unique();
      documentId = document?._id as Id<Table> | undefined;
      break;
    }
    case "gamblingTypes": {
      const document = await ctx.db
        .query("gamblingTypes")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", normalized),
        )
        .unique();
      documentId = document?._id as Id<Table> | undefined;
      break;
    }
    case "points": {
      const document = await ctx.db
        .query("points")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", normalized),
        )
        .unique();
      documentId = document?._id as Id<Table> | undefined;
      break;
    }
    case "ratings": {
      const document = await ctx.db
        .query("ratings")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", normalized),
        )
        .unique();
      documentId = document?._id as Id<Table> | undefined;
      break;
    }
    case "seasons": {
      const document = await ctx.db
        .query("seasons")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", normalized),
        )
        .unique();
      documentId = document?._id as Id<Table> | undefined;
      break;
    }
  }
  if (!documentId) {
    domainError(
      "CONFLICT",
      `Game reconciliation found a missing ${table} parent.`,
    );
  }
  return documentId;
}

async function resolveOptionalUuidParent<
  Table extends "assignments" | "points" | "seasons",
>(
  ctx: DatabaseContext,
  table: Table,
  legacyId: string | undefined,
): Promise<Id<Table> | undefined> {
  return legacyId === undefined
    ? undefined
    : await resolveUuidParent(ctx, table, legacyId);
}

async function expectedTagVoteAward(
  ctx: DatabaseContext,
  legacyId: string | undefined,
): Promise<TagVoteAward> {
  if (legacyId === undefined) {
    return { kind: "unawarded" };
  }
  const normalized = normalizeUuid(legacyId);
  const point = await ctx.db
    .query("points")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalized),
    )
    .unique();
  return point
    ? { kind: "point", pointId: point._id }
    : {
        kind: "legacyAwardTombstone",
        legacyPointId: normalized,
      };
}

function awardsMatch(left: TagVoteAward, right: TagVoteAward): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "point" && right.kind === "point") {
    return left.pointId === right.pointId;
  }
  if (
    left.kind === "legacyAwardTombstone" &&
    right.kind === "legacyAwardTombstone"
  ) {
    return left.legacyPointId === right.legacyPointId;
  }
  return true;
}

async function verifyGameType(
  ctx: DatabaseContext,
  row: Doc<"migrationRawGameTypes">,
): Promise<void> {
  const canonical = await ctx.db
    .query("gameTypes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", row.legacyId),
    )
    .unique();
  if (
    canonical?.title !== row.title ||
    canonical.description !== row.description ||
    canonical.lookupId !== row.lookupId ||
    canonical.normalizedLookupId !==
      normalizeLookupKey(row.lookupId, "Game type lookup ID")
  ) {
    domainError(
      "CONFLICT",
      "Game reconciliation found a game-type mismatch.",
    );
  }
}

async function verifyGamePointType(
  ctx: DatabaseContext,
  row: Doc<"migrationRawGamePointTypes">,
): Promise<void> {
  const gameTypeId = await resolveGameTypeId(
    ctx,
    row.gameTypeLegacyId,
  );
  const canonical = await ctx.db
    .query("gamePointTypes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", row.legacyId),
    )
    .unique();
  if (
    canonical?.lookupId !== row.lookupId ||
    canonical.normalizedLookupId !==
      normalizeLookupKey(row.lookupId, "Game point type lookup ID") ||
    canonical.title !== row.title ||
    canonical.description !== row.description ||
    canonical.points !== row.points ||
    canonical.gameTypeId !== gameTypeId
  ) {
    domainError(
      "CONFLICT",
      "Game reconciliation found a game-point-type mismatch.",
    );
  }
}

async function verifySeason(
  ctx: DatabaseContext,
  row: Doc<"migrationRawSeasons">,
): Promise<void> {
  const gameTypeId = await resolveGameTypeId(
    ctx,
    row.gameTypeLegacyId,
  );
  const canonical = await ctx.db
    .query("seasons")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(row.legacyId)),
    )
    .unique();
  if (
    canonical?.title !== row.title ||
    canonical.description !== row.description ||
    canonical.gameTypeId !== gameTypeId ||
    canonical.endedOn !== row.endedOn ||
    canonical.startedOn !== row.startedOn
  ) {
    domainError(
      "CONFLICT",
      "Game reconciliation found a season mismatch.",
    );
  }
}

async function verifyPoint(
  ctx: DatabaseContext,
  row: Doc<"migrationRawPoints">,
): Promise<void> {
  const userId = await resolveUserId(ctx, row.userLegacyId);
  const seasonId = await resolveUuidParent(
    ctx,
    "seasons",
    row.seasonLegacyId,
  );
  const gamePointTypeId = await resolveOptionalGamePointTypeId(
    ctx,
    row.gamePointTypeLegacyId,
  );
  const canonical = await ctx.db
    .query("points")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(row.legacyId)),
    )
    .unique();
  if (
    canonical?.userId !== userId ||
    canonical.seasonId !== seasonId ||
    canonical.reason !== row.reason ||
    canonical.earnedAt !== row.earnedAt ||
    canonical.adjustment !== row.adjustment ||
    canonical.gamePointTypeId !== gamePointTypeId
  ) {
    domainError(
      "CONFLICT",
      "Game reconciliation found a point mismatch.",
    );
  }
}

async function verifyGuess(
  ctx: DatabaseContext,
  row: Doc<"migrationRawGuesses">,
): Promise<void> {
  const ratingId = await resolveUuidParent(
    ctx,
    "ratings",
    row.ratingLegacyId,
  );
  const userId = await resolveUserId(ctx, row.userLegacyId);
  const assignmentReviewId = await resolveUuidParent(
    ctx,
    "assignmentReviews",
    row.assignmentReviewLegacyId,
  );
  const seasonId = await resolveUuidParent(
    ctx,
    "seasons",
    row.seasonLegacyId,
  );
  const pointId = await resolveOptionalUuidParent(
    ctx,
    "points",
    row.pointLegacyId,
  );
  const canonical = await ctx.db
    .query("guesses")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(row.legacyId)),
    )
    .unique();
  if (
    canonical?.ratingId !== ratingId ||
    canonical.createdAt !== row.createdAt ||
    canonical.userId !== userId ||
    canonical.assignmentReviewId !== assignmentReviewId ||
    canonical.seasonId !== seasonId ||
    canonical.pointId !== pointId
  ) {
    domainError(
      "CONFLICT",
      "Game reconciliation found a guess mismatch.",
    );
  }
}

async function verifyGamblingType(
  ctx: DatabaseContext,
  row: Doc<"migrationRawGamblingTypes">,
): Promise<void> {
  const canonical = await ctx.db
    .query("gamblingTypes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(row.legacyId)),
    )
    .unique();
  if (
    canonical?.lookupId !== row.lookupId ||
    canonical.normalizedLookupId !==
      normalizeLookupKey(row.lookupId, "Gambling type lookup ID") ||
    canonical.title !== row.title ||
    canonical.description !== row.description ||
    canonical.multiplier !== row.multiplier ||
    canonical.isActive !== row.isActive ||
    canonical.createdAt !== row.createdAt
  ) {
    domainError(
      "CONFLICT",
      "Game reconciliation found a gambling-type mismatch.",
    );
  }
}

async function verifyGamblingEntry(
  ctx: DatabaseContext,
  row: Doc<"migrationRawGamblingEntries">,
): Promise<void> {
  const userId = await resolveUserId(ctx, row.userLegacyId);
  const assignmentId = await resolveOptionalUuidParent(
    ctx,
    "assignments",
    row.assignmentLegacyId,
  );
  const awardPointId = await resolveOptionalUuidParent(
    ctx,
    "points",
    row.pointLegacyId,
  );
  const seasonId = await resolveOptionalUuidParent(
    ctx,
    "seasons",
    row.seasonLegacyId,
  );
  const gamblingTypeId = await resolveUuidParent(
    ctx,
    "gamblingTypes",
    row.gamblingTypeLegacyId,
  );
  const targetUserId = await resolveOptionalUserId(
    ctx,
    row.targetUserLegacyId,
  );
  const canonical = await ctx.db
    .query("gamblingEntries")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(row.legacyId)),
    )
    .unique();
  if (
    canonical?.userId !== userId ||
    canonical.assignmentId !== assignmentId ||
    canonical.points !== row.points ||
    canonical.createdAt !== row.createdAt ||
    canonical.awardPointId !== awardPointId ||
    canonical.seasonId !== seasonId ||
    canonical.notes !== row.notes ||
    canonical.gamblingTypeId !== gamblingTypeId ||
    canonical.targetUserId !== targetUserId ||
    canonical.status !== row.status
  ) {
    domainError(
      "CONFLICT",
      "Game reconciliation found a gambling-entry mismatch.",
    );
  }
}

async function verifyTagVote(
  ctx: DatabaseContext,
  row: Doc<"migrationRawTagVotes">,
): Promise<void> {
  const userId = await resolveOptionalUserId(
    ctx,
    row.userLegacyId,
  );
  const award = await expectedTagVoteAward(
    ctx,
    row.pointLegacyId,
  );
  const canonical = await ctx.db
    .query("tagVotes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(row.legacyId)),
    )
    .unique();
  if (
    canonical?.tag !== row.tag ||
    canonical.normalizedTag !==
      normalizeLookupKey(row.tag, "Tag vote tag") ||
    canonical.tmdbId !== row.tmdbId ||
    canonical.isTag !== row.isTag ||
    canonical.createdAt !== row.createdAt ||
    canonical.sessionId !== row.sessionId ||
    canonical.userId !== userId ||
    !awardsMatch(canonical.award, award)
  ) {
    domainError(
      "CONFLICT",
      "Game reconciliation found a tag-vote mismatch.",
    );
  }
}

async function verifyQuoteSubmission(
  ctx: DatabaseContext,
  row: Doc<"migrationRawQuoteSubmissions">,
): Promise<void> {
  const userId = await resolveUserId(ctx, row.userLegacyId);
  const episodeId = await resolveUuidParent(
    ctx,
    "episodes",
    row.episodeLegacyId,
  );
  const seasonId = await resolveUuidParent(
    ctx,
    "seasons",
    row.seasonLegacyId,
  );
  const pointId = await resolveOptionalUuidParent(
    ctx,
    "points",
    row.pointLegacyId,
  );
  const canonical = await ctx.db
    .query("quoteSubmissions")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(row.legacyId)),
    )
    .unique();
  if (
    canonical?.userId !== userId ||
    canonical.episodeId !== episodeId ||
    canonical.seasonId !== seasonId ||
    canonical.quoteText !== row.quoteText ||
    canonical.sourceTitle !== row.sourceTitle ||
    canonical.sourceType !== row.sourceType ||
    canonical.clipUrl !== row.clipUrl ||
    canonical.clipStartSeconds !== row.clipStartSeconds ||
    canonical.listenerNotes !== row.listenerNotes ||
    canonical.status !== row.status ||
    canonical.bracketOrder !== row.bracketOrder ||
    canonical.placement !== row.placement ||
    canonical.adminNotes !== row.adminNotes ||
    canonical.pointId !== pointId ||
    canonical.createdAt !== row.createdAt ||
    canonical.updatedAt !== row.updatedAt
  ) {
    domainError(
      "CONFLICT",
      "Game reconciliation found a quote-submission mismatch.",
    );
  }
}

function reconciliationDefinition<RowTable extends RawTable>(
  operation: string,
  readRows: (
    ctx: DatabaseContext,
    runId: string,
    previousLegacyKey: string | undefined,
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
          : { lastLegacyKey: String(lastRow.legacyId) }),
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

export const reconcileGameTypesBatch = internalMigrationMutation(
  reconciliationDefinition<"migrationRawGameTypes">(
    GAME_RECONCILIATION_OPERATIONS.gameTypes,
    async (ctx, runId, previousLegacyKey, limit) =>
      await ctx.db
        .query("migrationRawGameTypes")
        .withIndex("by_runId_and_legacyId", (query) =>
          previousLegacyKey === undefined
            ? query.eq("runId", runId)
            : query
                .eq("runId", runId)
                .gt("legacyId", Number(previousLegacyKey)),
        )
        .take(limit),
    verifyGameType,
  ),
);

export const reconcileGamePointTypesBatch =
  internalMigrationMutation(
    reconciliationDefinition<"migrationRawGamePointTypes">(
      GAME_RECONCILIATION_OPERATIONS.gamePointTypes,
      async (ctx, runId, previousLegacyKey, limit) =>
        await ctx.db
          .query("migrationRawGamePointTypes")
          .withIndex("by_runId_and_legacyId", (query) =>
            previousLegacyKey === undefined
              ? query.eq("runId", runId)
              : query
                  .eq("runId", runId)
                  .gt("legacyId", Number(previousLegacyKey)),
          )
          .take(limit),
      verifyGamePointType,
    ),
  );

export const reconcileSeasonsBatch = internalMigrationMutation(
  reconciliationDefinition<"migrationRawSeasons">(
    GAME_RECONCILIATION_OPERATIONS.seasons,
    async (ctx, runId, previousLegacyKey, limit) =>
      await ctx.db
        .query("migrationRawSeasons")
        .withIndex("by_runId_and_legacyId", (query) =>
          previousLegacyKey === undefined
            ? query.eq("runId", runId)
            : query
                .eq("runId", runId)
                .gt("legacyId", previousLegacyKey),
        )
        .take(limit),
    verifySeason,
  ),
);

export const reconcilePointsBatch = internalMigrationMutation(
  reconciliationDefinition<"migrationRawPoints">(
    GAME_RECONCILIATION_OPERATIONS.points,
    async (ctx, runId, previousLegacyKey, limit) =>
      await ctx.db
        .query("migrationRawPoints")
        .withIndex("by_runId_and_legacyId", (query) =>
          previousLegacyKey === undefined
            ? query.eq("runId", runId)
            : query
                .eq("runId", runId)
                .gt("legacyId", previousLegacyKey),
        )
        .take(limit),
    verifyPoint,
  ),
);

export const reconcileGuessesBatch = internalMigrationMutation(
  reconciliationDefinition<"migrationRawGuesses">(
    GAME_RECONCILIATION_OPERATIONS.guesses,
    async (ctx, runId, previousLegacyKey, limit) =>
      await ctx.db
        .query("migrationRawGuesses")
        .withIndex("by_runId_and_legacyId", (query) =>
          previousLegacyKey === undefined
            ? query.eq("runId", runId)
            : query
                .eq("runId", runId)
                .gt("legacyId", previousLegacyKey),
        )
        .take(limit),
    verifyGuess,
  ),
);

export const reconcileGamblingTypesBatch =
  internalMigrationMutation(
    reconciliationDefinition<"migrationRawGamblingTypes">(
      GAME_RECONCILIATION_OPERATIONS.gamblingTypes,
      async (ctx, runId, previousLegacyKey, limit) =>
        await ctx.db
          .query("migrationRawGamblingTypes")
          .withIndex("by_runId_and_legacyId", (query) =>
            previousLegacyKey === undefined
              ? query.eq("runId", runId)
              : query
                  .eq("runId", runId)
                  .gt("legacyId", previousLegacyKey),
          )
          .take(limit),
      verifyGamblingType,
    ),
  );

export const reconcileGamblingEntriesBatch =
  internalMigrationMutation(
    reconciliationDefinition<"migrationRawGamblingEntries">(
      GAME_RECONCILIATION_OPERATIONS.gamblingEntries,
      async (ctx, runId, previousLegacyKey, limit) =>
        await ctx.db
          .query("migrationRawGamblingEntries")
          .withIndex("by_runId_and_legacyId", (query) =>
            previousLegacyKey === undefined
              ? query.eq("runId", runId)
              : query
                  .eq("runId", runId)
                  .gt("legacyId", previousLegacyKey),
          )
          .take(limit),
      verifyGamblingEntry,
    ),
  );

export const reconcileTagVotesBatch = internalMigrationMutation(
  reconciliationDefinition<"migrationRawTagVotes">(
    GAME_RECONCILIATION_OPERATIONS.tagVotes,
    async (ctx, runId, previousLegacyKey, limit) =>
      await ctx.db
        .query("migrationRawTagVotes")
        .withIndex("by_runId_and_legacyId", (query) =>
          previousLegacyKey === undefined
            ? query.eq("runId", runId)
            : query
                .eq("runId", runId)
                .gt("legacyId", previousLegacyKey),
        )
        .take(limit),
    verifyTagVote,
  ),
);

export const reconcileQuoteSubmissionsBatch =
  internalMigrationMutation(
    reconciliationDefinition<"migrationRawQuoteSubmissions">(
      GAME_RECONCILIATION_OPERATIONS.quoteSubmissions,
      async (ctx, runId, previousLegacyKey, limit) =>
        await ctx.db
          .query("migrationRawQuoteSubmissions")
          .withIndex("by_runId_and_legacyId", (query) =>
            previousLegacyKey === undefined
              ? query.eq("runId", runId)
              : query
                  .eq("runId", runId)
                  .gt("legacyId", previousLegacyKey),
          )
          .take(limit),
      verifyQuoteSubmission,
    ),
  );

export const finishGameReconciliation =
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
        GAME_RECONCILIATION_OPERATIONS.finish,
      );
      const runId = ctx.systemState.cutoverRunId;
      const { domainRun } = await getReconciliationDomainRun(ctx, {
        runId,
        domain: DOMAIN,
      });
      const operations = {
        gameTypes: GAME_RECONCILIATION_OPERATIONS.gameTypes,
        gamePointTypes:
          GAME_RECONCILIATION_OPERATIONS.gamePointTypes,
        seasons: GAME_RECONCILIATION_OPERATIONS.seasons,
        points: GAME_RECONCILIATION_OPERATIONS.points,
        guesses: GAME_RECONCILIATION_OPERATIONS.guesses,
        gamblingTypes:
          GAME_RECONCILIATION_OPERATIONS.gamblingTypes,
        gamblingEntries:
          GAME_RECONCILIATION_OPERATIONS.gamblingEntries,
        tagVotes: GAME_RECONCILIATION_OPERATIONS.tagVotes,
        quoteSubmissions:
          GAME_RECONCILIATION_OPERATIONS.quoteSubmissions,
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
            "Every game reconciliation checkpoint must be complete.",
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
          "Game reconciliation counts do not match source expectations.",
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
          action: "migration.games.reconciled",
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
