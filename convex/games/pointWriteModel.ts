import type { Doc, Id } from "../_generated/dataModel.js";
import type {
  MutationCtx,
  QueryCtx,
} from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import { normalizeLookupKey } from "../lib/normalize.js";
import { MAX_POINT_RELATIONSHIPS } from "./limits.js";
import { findCurrentSeason } from "./readModel.js";
import type {
  pointSeasonTargetValidator,
} from "./validators.js";
import type { Infer } from "convex/values";
import {
  requireGamePointType,
  requireSeason,
  validatePlainDate,
} from "./writeModel.js";

const MIN_SQL_INT = -2_147_483_648;
const MAX_SQL_INT = 2_147_483_647;
const MAX_POINT_REASON_LENGTH = 1000;

type PointReadContext = Pick<QueryCtx, "db">;
type PointWriteContext = Pick<MutationCtx, "db">;
type PointSeasonTarget = Infer<typeof pointSeasonTargetValidator>;

export function validatePointAdjustment(
  value: number | null,
): number | null {
  if (
    value !== null &&
    (!Number.isSafeInteger(value) ||
      value < MIN_SQL_INT ||
      value > MAX_SQL_INT)
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Point adjustment must be null or an integer in the SQL INT range.",
    );
  }
  return value;
}

export function validatePointReason(
  value: string | null,
): string | undefined {
  if (value === null) {
    return undefined;
  }
  const reason = value.trim().normalize("NFKC");
  if (reason.length > MAX_POINT_REASON_LENGTH) {
    domainError(
      "VALIDATION_FAILED",
      `Point reason cannot exceed ${String(MAX_POINT_REASON_LENGTH)} characters.`,
    );
  }
  return reason.length === 0 ? undefined : reason;
}

export function validateEarnedAt(value: number): number {
  if (!Number.isSafeInteger(value)) {
    domainError(
      "VALIDATION_FAILED",
      "Point earned time must be an integer epoch-millisecond value.",
    );
  }
  return value;
}

export async function requirePoint(
  ctx: PointReadContext,
  id: Id<"points">,
): Promise<Doc<"points">> {
  const point = await ctx.db.get("points", id);
  if (point === null) {
    domainError("NOT_FOUND", "The point is unavailable.");
  }
  return point;
}

export async function requirePointUser(
  ctx: PointReadContext,
  id: Id<"users">,
): Promise<Doc<"users">> {
  const user = await ctx.db.get("users", id);
  if (user === null) {
    domainError("NOT_FOUND", "The point user is unavailable.");
  }
  return user;
}

export async function requirePointAssignment(
  ctx: PointReadContext,
  id: Id<"assignments">,
): Promise<Doc<"assignments">> {
  const assignment = await ctx.db.get("assignments", id);
  if (assignment === null) {
    domainError("NOT_FOUND", "The assignment is unavailable.");
  }
  return assignment;
}

export async function resolvePointSeason(
  ctx: PointReadContext,
  target: PointSeasonTarget,
): Promise<Doc<"seasons">> {
  if (target.kind === "season") {
    return await requireSeason(ctx, target.seasonId);
  }
  const today = validatePlainDate(
    target.today,
    "Current season date",
  );
  const season = await findCurrentSeason(ctx, today);
  if (season === null) {
    domainError(
      "NOT_FOUND",
      "No active season is available for the point event.",
    );
  }
  return season;
}

export async function resolveGamePointTypeByLookup(
  ctx: PointReadContext,
  lookupId: string,
): Promise<Doc<"gamePointTypes">> {
  const normalizedLookupId = normalizeLookupKey(
    lookupId,
    "Game point type lookup ID",
  );
  const pointType = await ctx.db
    .query("gamePointTypes")
    .withIndex("by_normalizedLookupId", (index) =>
      index.eq("normalizedLookupId", normalizedLookupId),
    )
    .unique();
  if (pointType === null) {
    domainError(
      "NOT_FOUND",
      "The game point type lookup ID is unavailable.",
    );
  }
  return pointType;
}

export async function insertPoint(
  ctx: PointWriteContext,
  input: {
    userId: Id<"users">;
    seasonId: Id<"seasons">;
    reason: string | undefined;
    earnedAt: number;
    adjustment: number | null;
    gamePointTypeId: Id<"gamePointTypes"> | undefined;
  },
): Promise<Doc<"points">> {
  const pointId = await ctx.db.insert("points", {
    userId: input.userId,
    seasonId: input.seasonId,
    earnedAt: input.earnedAt,
    adjustment: input.adjustment,
    ...(input.reason === undefined
      ? {}
      : { reason: input.reason }),
    ...(input.gamePointTypeId === undefined
      ? {}
      : { gamePointTypeId: input.gamePointTypeId }),
  });
  return await requirePoint(ctx, pointId);
}

export async function requireOptionalGamePointType(
  ctx: PointReadContext,
  id: Id<"gamePointTypes"> | undefined,
): Promise<Doc<"gamePointTypes"> | null> {
  return id === undefined
    ? null
    : await requireGamePointType(ctx, id);
}

export async function assertPointRelationshipCapacity(
  ctx: PointReadContext,
  pointId: Id<"points">,
): Promise<{
  assignmentLinks: Array<Doc<"assignmentPointLinks">>;
  guesses: Array<Doc<"guesses">>;
  gamblingEntries: Array<Doc<"gamblingEntries">>;
  tagVotes: Array<Doc<"tagVotes">>;
  quoteSubmissions: Array<Doc<"quoteSubmissions">>;
}> {
  const [
    assignmentLinks,
    guesses,
    gamblingEntries,
    tagVotes,
    quoteSubmissions,
  ] = await Promise.all([
    ctx.db
      .query("assignmentPointLinks")
      .withIndex("by_pointId", (index) =>
        index.eq("pointId", pointId),
      )
      .take(MAX_POINT_RELATIONSHIPS + 1),
    ctx.db
      .query("guesses")
      .withIndex("by_pointId", (index) =>
        index.eq("pointId", pointId),
      )
      .take(MAX_POINT_RELATIONSHIPS + 1),
    ctx.db
      .query("gamblingEntries")
      .withIndex("by_awardPointId", (index) =>
        index.eq("awardPointId", pointId),
      )
      .take(MAX_POINT_RELATIONSHIPS + 1),
    ctx.db
      .query("tagVotes")
      .withIndex("by_awardKind_and_awardPointId", (index) =>
        index
          .eq("award.kind", "point")
          .eq("award.pointId", pointId),
      )
      .take(MAX_POINT_RELATIONSHIPS + 1),
    ctx.db
      .query("quoteSubmissions")
      .withIndex("by_pointId", (index) =>
        index.eq("pointId", pointId),
      )
      .take(MAX_POINT_RELATIONSHIPS + 1),
  ]);
  const relationships = {
    assignmentLinks,
    guesses,
    gamblingEntries,
    tagVotes,
    quoteSubmissions,
  };
  for (const [relationship, rows] of Object.entries(relationships)) {
    if (rows.length > MAX_POINT_RELATIONSHIPS) {
      domainError(
        "CONFLICT",
        "Point deletion exceeds the supported relationship limit.",
        {
          details: {
            relationship,
            limit: MAX_POINT_RELATIONSHIPS,
          },
        },
      );
    }
  }
  return relationships;
}

export async function deletePointAndClearRelationships(
  ctx: PointWriteContext,
  point: Doc<"points">,
): Promise<{
  assignmentLinkCount: number;
  guessCount: number;
  gamblingEntryCount: number;
  tagVoteCount: number;
  quoteSubmissionCount: number;
}> {
  const relationships = await assertPointRelationshipCapacity(
    ctx,
    point._id,
  );
  for (const link of relationships.assignmentLinks) {
    await ctx.db.delete("assignmentPointLinks", link._id);
  }
  for (const guess of relationships.guesses) {
    await ctx.db.patch("guesses", guess._id, {
      pointId: undefined,
    });
  }
  for (const entry of relationships.gamblingEntries) {
    await ctx.db.patch("gamblingEntries", entry._id, {
      awardPointId: undefined,
    });
  }
  for (const vote of relationships.tagVotes) {
    await ctx.db.patch("tagVotes", vote._id, {
      award: { kind: "unawarded" },
    });
  }
  for (const submission of relationships.quoteSubmissions) {
    await ctx.db.patch("quoteSubmissions", submission._id, {
      pointId: undefined,
    });
  }
  await ctx.db.delete("points", point._id);
  return {
    assignmentLinkCount: relationships.assignmentLinks.length,
    guessCount: relationships.guesses.length,
    gamblingEntryCount: relationships.gamblingEntries.length,
    tagVoteCount: relationships.tagVotes.length,
    quoteSubmissionCount: relationships.quoteSubmissions.length,
  };
}
