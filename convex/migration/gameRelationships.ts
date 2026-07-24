import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { internalMigrationMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import type { ApplicationActor } from "../lib/actors.js";
import { domainError } from "../lib/errors.js";
import {
  ASSIGNMENT_OPERATIONS,
  GAME_OPERATIONS,
} from "./constants.js";
import { normalizeLookupKey } from "./normalize.js";
import {
  getActiveDomainRun,
  getMigrationCheckpoint,
  migrationCheckpointResult,
  requireCompletedMigrationCheckpoint,
  requireMigrationBatchSize,
  requireMigrationOperation,
  saveMigrationCheckpoint,
  writeMigrationBatchAudit,
} from "./runtime.js";

const DOMAIN = "games";
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
type MigrationContext = MutationCtx & {
  actor: ApplicationActor;
  migrationOperationId: string;
  systemState: Doc<"systemState">;
};
type UpsertOutcome = "inserted" | "reused";
type TagVoteAward = Doc<"tagVotes">["award"];

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

function requireTinyInt(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 255) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must fit the SQL tinyint range.`,
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
      "A game relationship references a missing canonical user.",
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
  label: string,
): Promise<Id<Table>> {
  const normalized = normalizeUuid(legacyId, `${label} relationship ID`);
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
      `${label} references a missing canonical ${table} document.`,
    );
  }
  return documentId;
}

async function resolveOptionalUuidParent<
  Table extends
    | "assignments"
    | "points"
    | "seasons",
>(
  ctx: DatabaseContext,
  table: Table,
  legacyId: string | undefined,
  label: string,
): Promise<Id<Table> | undefined> {
  return legacyId === undefined
    ? undefined
    : await resolveUuidParent(ctx, table, legacyId, label);
}

async function tagVoteAward(
  ctx: DatabaseContext,
  legacyId: string | undefined,
): Promise<TagVoteAward> {
  if (legacyId === undefined) {
    return { kind: "unawarded" };
  }
  const normalized = normalizeUuid(
    legacyId,
    "Tag vote point relationship ID",
  );
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

async function upsertGuess(
  ctx: DatabaseContext,
  row: Doc<"migrationRawGuesses">,
): Promise<UpsertOutcome> {
  const legacyId = normalizeUuid(row.legacyId, "Guess legacy ID");
  requireFinite(row.createdAt, "Guess creation time");
  const ratingId = await resolveUuidParent(
    ctx,
    "ratings",
    row.ratingLegacyId,
    "Guess rating",
  );
  const userId = await resolveUserId(ctx, row.userLegacyId);
  const assignmentReviewId = await resolveUuidParent(
    ctx,
    "assignmentReviews",
    row.assignmentReviewLegacyId,
    "Guess assignment review",
  );
  const seasonId = await resolveUuidParent(
    ctx,
    "seasons",
    row.seasonLegacyId,
    "Guess season",
  );
  const pointId = await resolveOptionalUuidParent(
    ctx,
    "points",
    row.pointLegacyId,
    "Guess point",
  );
  const existing = await ctx.db
    .query("guesses")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  if (existing) {
    const matches =
      existing.ratingId === ratingId &&
      existing.createdAt === row.createdAt &&
      existing.userId === userId &&
      existing.assignmentReviewId === assignmentReviewId &&
      existing.seasonId === seasonId &&
      existing.pointId === pointId;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated guess conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("guesses", {
    legacyId,
    ratingId,
    createdAt: row.createdAt,
    userId,
    assignmentReviewId,
    seasonId,
    ...(pointId === undefined ? {} : { pointId }),
  });
  return "inserted";
}

async function upsertGamblingType(
  ctx: DatabaseContext,
  row: Doc<"migrationRawGamblingTypes">,
): Promise<UpsertOutcome> {
  const legacyId = normalizeUuid(
    row.legacyId,
    "Gambling type legacy ID",
  );
  requireFinite(row.multiplier, "Gambling type multiplier");
  requireFinite(row.createdAt, "Gambling type creation time");
  const normalizedLookupId = normalizeLookupKey(
    row.lookupId,
    "Gambling type lookup ID",
  );
  const existing = await ctx.db
    .query("gamblingTypes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  const lookupCollision = await ctx.db
    .query("gamblingTypes")
    .withIndex("by_normalizedLookupId", (query) =>
      query.eq("normalizedLookupId", normalizedLookupId),
    )
    .unique();
  if (lookupCollision && lookupCollision._id !== existing?._id) {
    domainError(
      "CONFLICT",
      "Gambling type normalization produced a duplicate canonical key.",
    );
  }
  if (existing) {
    const matches =
      existing.lookupId === row.lookupId &&
      existing.normalizedLookupId === normalizedLookupId &&
      existing.title === row.title &&
      existing.description === row.description &&
      existing.multiplier === row.multiplier &&
      existing.isActive === row.isActive &&
      existing.createdAt === row.createdAt;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated gambling type conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("gamblingTypes", {
    legacyId,
    lookupId: row.lookupId,
    normalizedLookupId,
    title: row.title,
    ...(row.description === undefined
      ? {}
      : { description: row.description }),
    multiplier: row.multiplier,
    isActive: row.isActive,
    createdAt: row.createdAt,
  });
  return "inserted";
}

async function upsertGamblingEntry(
  ctx: DatabaseContext,
  row: Doc<"migrationRawGamblingEntries">,
): Promise<UpsertOutcome> {
  const legacyId = normalizeUuid(
    row.legacyId,
    "Gambling entry legacy ID",
  );
  requireSqlInt(row.points, "Gambling entry points");
  requireFinite(row.createdAt, "Gambling entry creation time");
  const userId = await resolveUserId(ctx, row.userLegacyId);
  const assignmentId = await resolveOptionalUuidParent(
    ctx,
    "assignments",
    row.assignmentLegacyId,
    "Gambling assignment",
  );
  const awardPointId = await resolveOptionalUuidParent(
    ctx,
    "points",
    row.pointLegacyId,
    "Gambling award point",
  );
  const seasonId = await resolveOptionalUuidParent(
    ctx,
    "seasons",
    row.seasonLegacyId,
    "Gambling season",
  );
  const gamblingTypeId = await resolveUuidParent(
    ctx,
    "gamblingTypes",
    row.gamblingTypeLegacyId,
    "Gambling type",
  );
  const targetUserId = await resolveOptionalUserId(
    ctx,
    row.targetUserLegacyId,
  );
  const existing = await ctx.db
    .query("gamblingEntries")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  if (existing) {
    const matches =
      existing.userId === userId &&
      existing.assignmentId === assignmentId &&
      existing.points === row.points &&
      existing.createdAt === row.createdAt &&
      existing.awardPointId === awardPointId &&
      existing.seasonId === seasonId &&
      existing.notes === row.notes &&
      existing.gamblingTypeId === gamblingTypeId &&
      existing.targetUserId === targetUserId &&
      existing.status === row.status;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated gambling entry conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("gamblingEntries", {
    legacyId,
    userId,
    ...(assignmentId === undefined ? {} : { assignmentId }),
    points: row.points,
    createdAt: row.createdAt,
    ...(awardPointId === undefined ? {} : { awardPointId }),
    ...(seasonId === undefined ? {} : { seasonId }),
    ...(row.notes === undefined ? {} : { notes: row.notes }),
    gamblingTypeId,
    ...(targetUserId === undefined ? {} : { targetUserId }),
    status: row.status,
  });
  return "inserted";
}

async function upsertTagVote(
  ctx: DatabaseContext,
  row: Doc<"migrationRawTagVotes">,
): Promise<UpsertOutcome> {
  const legacyId = normalizeUuid(row.legacyId, "Tag vote legacy ID");
  requireSqlInt(row.tmdbId, "Tag vote TMDB ID");
  requireFinite(row.createdAt, "Tag vote creation time");
  const normalizedTag = normalizeLookupKey(row.tag, "Tag vote tag");
  const userId = await resolveOptionalUserId(
    ctx,
    row.userLegacyId,
  );
  const award = await tagVoteAward(ctx, row.pointLegacyId);
  const existing = await ctx.db
    .query("tagVotes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  if (existing) {
    const matches =
      existing.tag === row.tag &&
      existing.normalizedTag === normalizedTag &&
      existing.tmdbId === row.tmdbId &&
      existing.isTag === row.isTag &&
      existing.createdAt === row.createdAt &&
      existing.sessionId === row.sessionId &&
      existing.userId === userId &&
      awardsMatch(existing.award, award);
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated tag vote conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("tagVotes", {
    legacyId,
    tag: row.tag,
    normalizedTag,
    tmdbId: row.tmdbId,
    ...(row.isTag === undefined ? {} : { isTag: row.isTag }),
    createdAt: row.createdAt,
    ...(row.sessionId === undefined
      ? {}
      : { sessionId: row.sessionId }),
    ...(userId === undefined ? {} : { userId }),
    award,
  });
  return "inserted";
}

async function upsertQuoteSubmission(
  ctx: DatabaseContext,
  row: Doc<"migrationRawQuoteSubmissions">,
): Promise<UpsertOutcome> {
  const legacyId = normalizeUuid(
    row.legacyId,
    "Quote submission legacy ID",
  );
  if (!["MOVIE", "TV", "OTHER"].includes(row.sourceType)) {
    domainError(
      "VALIDATION_FAILED",
      "Quote source type is outside the SQL check constraint.",
    );
  }
  if (!["SUBMITTED", "INCLUDED", "REJECTED"].includes(row.status)) {
    domainError(
      "VALIDATION_FAILED",
      "Quote status is outside the SQL check constraint.",
    );
  }
  if (row.clipStartSeconds !== undefined) {
    requireSqlInt(row.clipStartSeconds, "Quote clip start");
    if (row.clipStartSeconds < 0) {
      domainError(
        "VALIDATION_FAILED",
        "Quote clip start cannot be negative.",
      );
    }
  }
  if (row.bracketOrder !== undefined) {
    requireSmallInt(row.bracketOrder, "Quote bracket order");
  }
  if (row.placement !== undefined) {
    requireTinyInt(row.placement, "Quote placement");
    if (row.placement < 1 || row.placement > 3) {
      domainError(
        "VALIDATION_FAILED",
        "Quote placement must be from 1 through 3.",
      );
    }
  }
  requireFinite(row.createdAt, "Quote creation time");
  requireFinite(row.updatedAt, "Quote update time");
  const userId = await resolveUserId(ctx, row.userLegacyId);
  const episodeId = await resolveUuidParent(
    ctx,
    "episodes",
    row.episodeLegacyId,
    "Quote episode",
  );
  const seasonId = await resolveUuidParent(
    ctx,
    "seasons",
    row.seasonLegacyId,
    "Quote season",
  );
  const pointId = await resolveOptionalUuidParent(
    ctx,
    "points",
    row.pointLegacyId,
    "Quote point",
  );
  const existing = await ctx.db
    .query("quoteSubmissions")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  const userCollision = await ctx.db
    .query("quoteSubmissions")
    .withIndex("by_episodeId_and_userId", (query) =>
      query.eq("episodeId", episodeId).eq("userId", userId),
    )
    .unique();
  if (userCollision && userCollision._id !== existing?._id) {
    domainError(
      "CONFLICT",
      "Quote migration produced a duplicate episode/user key.",
    );
  }
  const pointCollision =
    pointId === undefined
      ? null
      : await ctx.db
          .query("quoteSubmissions")
          .withIndex("by_pointId", (query) =>
            query.eq("pointId", pointId),
          )
          .unique();
  if (pointCollision && pointCollision._id !== existing?._id) {
    domainError(
      "CONFLICT",
      "Quote migration produced a duplicate non-null point key.",
    );
  }
  if (existing) {
    const matches =
      existing.userId === userId &&
      existing.episodeId === episodeId &&
      existing.seasonId === seasonId &&
      existing.quoteText === row.quoteText &&
      existing.sourceTitle === row.sourceTitle &&
      existing.sourceType === row.sourceType &&
      existing.clipUrl === row.clipUrl &&
      existing.clipStartSeconds === row.clipStartSeconds &&
      existing.listenerNotes === row.listenerNotes &&
      existing.status === row.status &&
      existing.bracketOrder === row.bracketOrder &&
      existing.placement === row.placement &&
      existing.adminNotes === row.adminNotes &&
      existing.pointId === pointId &&
      existing.createdAt === row.createdAt &&
      existing.updatedAt === row.updatedAt;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated quote submission conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("quoteSubmissions", {
    legacyId,
    userId,
    episodeId,
    seasonId,
    quoteText: row.quoteText,
    sourceTitle: row.sourceTitle,
    sourceType: row.sourceType,
    ...(row.clipUrl === undefined ? {} : { clipUrl: row.clipUrl }),
    ...(row.clipStartSeconds === undefined
      ? {}
      : { clipStartSeconds: row.clipStartSeconds }),
    ...(row.listenerNotes === undefined
      ? {}
      : { listenerNotes: row.listenerNotes }),
    status: row.status,
    ...(row.bracketOrder === undefined
      ? {}
      : { bracketOrder: row.bracketOrder }),
    ...(row.placement === undefined
      ? {}
      : { placement: row.placement }),
    ...(row.adminNotes === undefined
      ? {}
      : { adminNotes: row.adminNotes }),
    ...(pointId === undefined ? {} : { pointId }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  return "inserted";
}

async function transformUuidBatch<Row extends { legacyId: string }>(
  ctx: DatabaseContext & Parameters<typeof writeMigrationBatchAudit>[0],
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

type UuidRawTable =
  | "migrationRawGamblingEntries"
  | "migrationRawGamblingTypes"
  | "migrationRawGuesses"
  | "migrationRawQuoteSubmissions"
  | "migrationRawTagVotes";
interface UuidRawRowByTable {
  migrationRawGamblingEntries: Doc<"migrationRawGamblingEntries">;
  migrationRawGamblingTypes: Doc<"migrationRawGamblingTypes">;
  migrationRawGuesses: Doc<"migrationRawGuesses">;
  migrationRawQuoteSubmissions: Doc<"migrationRawQuoteSubmissions">;
  migrationRawTagVotes: Doc<"migrationRawTagVotes">;
}

function uuidBatchDefinition<RowTable extends UuidRawTable>(
  operation: string,
  prerequisites: string[],
  readRows: (
    ctx: DatabaseContext,
    runId: string,
    previousLegacyId: string | undefined,
    limit: number,
  ) => Promise<Array<UuidRawRowByTable[RowTable]>>,
  upsert: (
    ctx: DatabaseContext,
    row: UuidRawRowByTable[RowTable],
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
      for (const prerequisite of prerequisites) {
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
      return await transformUuidBatch(ctx, {
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

export const transformGuessesBatch = internalMigrationMutation(
  uuidBatchDefinition<"migrationRawGuesses">(
    GAME_OPERATIONS.guesses,
    [GAME_OPERATIONS.points],
    async (ctx, runId, previousLegacyId, limit) =>
      await ctx.db
        .query("migrationRawGuesses")
        .withIndex("by_runId_and_legacyId", (query) =>
          previousLegacyId === undefined
            ? query.eq("runId", runId)
            : query
                .eq("runId", runId)
                .gt("legacyId", previousLegacyId),
        )
        .take(limit),
    upsertGuess,
  ),
);

export const transformGamblingTypesBatch =
  internalMigrationMutation(
    uuidBatchDefinition<"migrationRawGamblingTypes">(
      GAME_OPERATIONS.gamblingTypes,
      [],
      async (ctx, runId, previousLegacyId, limit) =>
        await ctx.db
          .query("migrationRawGamblingTypes")
          .withIndex("by_runId_and_legacyId", (query) =>
            previousLegacyId === undefined
              ? query.eq("runId", runId)
              : query
                  .eq("runId", runId)
                  .gt("legacyId", previousLegacyId),
          )
          .take(limit),
      upsertGamblingType,
    ),
  );

export const transformGamblingEntriesBatch =
  internalMigrationMutation(
    uuidBatchDefinition<"migrationRawGamblingEntries">(
      GAME_OPERATIONS.gamblingEntries,
      [
        GAME_OPERATIONS.points,
        GAME_OPERATIONS.gamblingTypes,
        ASSIGNMENT_OPERATIONS.assignments,
      ],
      async (ctx, runId, previousLegacyId, limit) =>
        await ctx.db
          .query("migrationRawGamblingEntries")
          .withIndex("by_runId_and_legacyId", (query) =>
            previousLegacyId === undefined
              ? query.eq("runId", runId)
              : query
                  .eq("runId", runId)
                  .gt("legacyId", previousLegacyId),
          )
          .take(limit),
      upsertGamblingEntry,
    ),
  );

export const transformTagVotesBatch = internalMigrationMutation(
  uuidBatchDefinition<"migrationRawTagVotes">(
    GAME_OPERATIONS.tagVotes,
    [GAME_OPERATIONS.points],
    async (ctx, runId, previousLegacyId, limit) =>
      await ctx.db
        .query("migrationRawTagVotes")
        .withIndex("by_runId_and_legacyId", (query) =>
          previousLegacyId === undefined
            ? query.eq("runId", runId)
            : query
                .eq("runId", runId)
                .gt("legacyId", previousLegacyId),
        )
        .take(limit),
    upsertTagVote,
  ),
);

export const transformQuoteSubmissionsBatch =
  internalMigrationMutation(
    uuidBatchDefinition<"migrationRawQuoteSubmissions">(
      GAME_OPERATIONS.quoteSubmissions,
      [GAME_OPERATIONS.points],
      async (ctx, runId, previousLegacyId, limit) =>
        await ctx.db
          .query("migrationRawQuoteSubmissions")
          .withIndex("by_runId_and_legacyId", (query) =>
            previousLegacyId === undefined
              ? query.eq("runId", runId)
              : query
                  .eq("runId", runId)
                  .gt("legacyId", previousLegacyId),
          )
          .take(limit),
      upsertQuoteSubmission,
    ),
  );

export const finishGameRun = internalMigrationMutation({
  args: {},
  returns: v.object({
    runId: v.string(),
    status: v.literal("transformed"),
    counts: v.record(v.string(), v.number()),
  }),
  handler: async (ctx) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      GAME_OPERATIONS.finish,
    );
    const runId = ctx.systemState.cutoverRunId;
    const { domainRun } = await getActiveDomainRun(ctx, {
      runId,
      domain: DOMAIN,
    });
    const operations = {
      gameTypes: GAME_OPERATIONS.gameTypes,
      gamePointTypes: GAME_OPERATIONS.gamePointTypes,
      seasons: GAME_OPERATIONS.seasons,
      points: GAME_OPERATIONS.points,
      guesses: GAME_OPERATIONS.guesses,
      gamblingTypes: GAME_OPERATIONS.gamblingTypes,
      gamblingEntries: GAME_OPERATIONS.gamblingEntries,
      tagVotes: GAME_OPERATIONS.tagVotes,
      quoteSubmissions: GAME_OPERATIONS.quoteSubmissions,
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
        "Game transform counts do not match source expectations.",
        { details: counts },
      );
    }
    await ctx.db.patch("migrationDomainRuns", domainRun._id, {
      status: "transformed",
      updatedAt: Date.now(),
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "migration.games.transformed",
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
