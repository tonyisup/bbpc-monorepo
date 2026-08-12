import type { Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import {
  assertPointRelationshipCapacity,
  deletePointAndClearRelationships,
  insertPoint,
  requirePoint,
  requirePointAssignment,
  requirePointUser,
  resolvePointSeason,
  validateEarnedAt,
  validatePointAdjustment,
  validatePointReason,
} from "./pointWriteModel.js";
import {
  calculateAvailablePointsForUser,
  requireGamblingEntry,
  requireGamblingType,
} from "./gamblingReadModel.js";
import {
  findHostAssignmentReview,
  requireOpenPredictionAssignment,
} from "./guessWriteModel.js";
import type {
  gamblingStatusValidator,
  pointSeasonTargetValidator,
} from "./validators.js";
import {
  validateGameLookupId,
  validateGameTitle,
  validateOptionalGameText,
} from "./writeModel.js";

const MAX_SQL_INT = 2_147_483_647;
const TARGETED_GAMBLING_TYPE_SUFFIX = "-1x";

type GamblingStatus = Infer<typeof gamblingStatusValidator>;
type PointSeasonTarget = Infer<typeof pointSeasonTargetValidator>;
type GamblingReadContext = Pick<QueryCtx, "db">;
type GamblingWriteContext = Pick<MutationCtx, "db">;

export function validateGamblingPoints(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_SQL_INT
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Gambling points must be a non-negative integer in the SQL INT range.",
    );
  }
  return value;
}

export function validateGamblingMultiplier(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    domainError(
      "VALIDATION_FAILED",
      "Gambling multiplier must be a finite non-negative number.",
    );
  }
  return value;
}

export function validateGamblingCreatedAt(value: number): number {
  if (!Number.isSafeInteger(value)) {
    domainError(
      "VALIDATION_FAILED",
      "Gambling creation time must be an integer epoch-millisecond value.",
    );
  }
  return value;
}

export function validateGamblingTitle(value: string): string {
  return validateGameTitle(value, "Gambling type title");
}

export function validateGamblingDescription(
  value: string | null,
): string | undefined {
  return validateOptionalGameText(
    value,
    "Gambling type description",
  );
}

export function validateGamblingNotes(
  value: string | null,
): string | undefined {
  return validateOptionalGameText(value, "Gambling notes");
}

export function validateGamblingLookupId(value: string) {
  return validateGameLookupId(value, "Gambling type lookup ID");
}

export async function assertUniqueGamblingTypeLookup(
  ctx: GamblingReadContext,
  normalizedLookupId: string,
  excludeId?: Id<"gamblingTypes">,
): Promise<void> {
  const matches = await ctx.db
    .query("gamblingTypes")
    .withIndex("by_normalizedLookupId", (index) =>
      index.eq("normalizedLookupId", normalizedLookupId),
    )
    .take(2);
  if (matches.some((type) => type._id !== excludeId)) {
    domainError(
      "CONFLICT",
      "The gambling type lookup ID is in use.",
    );
  }
}

export async function assertGamblingTypeUnreferenced(
  ctx: GamblingReadContext,
  gamblingTypeId: Id<"gamblingTypes">,
): Promise<void> {
  const entry = await ctx.db
    .query("gamblingEntries")
    .withIndex("by_gamblingTypeId", (index) =>
      index.eq("gamblingTypeId", gamblingTypeId),
    )
    .first();
  if (entry !== null) {
    domainError(
      "CONFLICT",
      "The gambling type cannot be deleted while entries reference it.",
    );
  }
}

export async function resolveActiveGamblingType(
  ctx: GamblingReadContext,
  id: Id<"gamblingTypes"> | undefined,
): Promise<Doc<"gamblingTypes">> {
  const gamblingType =
    id === undefined
      ? await ctx.db
          .query("gamblingTypes")
          .withIndex("by_normalizedLookupId", (index) =>
            index.eq("normalizedLookupId", "default"),
          )
          .unique()
      : await requireGamblingType(ctx, id);
  if (gamblingType === null) {
    domainError(
      "NOT_FOUND",
      "The default gambling type is unavailable.",
    );
  }
  if (!gamblingType.isActive) {
    domainError(
      "CONFLICT",
      "The gambling type is unavailable for new wagers.",
      { details: { reason: "WAGER_TYPE_UNAVAILABLE" } },
    );
  }
  return gamblingType;
}

export async function validateGamblingTarget(
  ctx: GamblingReadContext,
  input: {
    gamblingType: Doc<"gamblingTypes">;
    assignmentId: Id<"assignments"> | undefined;
    targetUserId: Id<"users"> | undefined;
  },
): Promise<Doc<"assignments"> | null> {
  const requiresTarget =
    input.gamblingType.normalizedLookupId.endsWith(
      TARGETED_GAMBLING_TYPE_SUFFIX,
    );
  if (requiresTarget !== (input.targetUserId !== undefined)) {
    domainError("VALIDATION_FAILED", "The wager target is invalid.", {
      details: { reason: "INVALID_HOST" },
    });
  }
  if (input.assignmentId === undefined) {
    if (requiresTarget) {
      domainError("VALIDATION_FAILED", "The wager target is invalid.", {
        details: { reason: "INVALID_HOST" },
      });
    }
    return null;
  }
  const assignment = await requireOpenPredictionAssignment(
    ctx,
    input.assignmentId,
  );
  if (input.targetUserId !== undefined) {
    await findHostAssignmentReview(
      ctx,
      assignment,
      input.targetUserId,
    );
  }
  return assignment;
}

export async function findCanonicalGamblingEntry(
  ctx: GamblingReadContext,
  input: {
    userId: Id<"users">;
    seasonId: Id<"seasons">;
    gamblingTypeId: Id<"gamblingTypes">;
    assignmentId: Id<"assignments"> | undefined;
    targetUserId: Id<"users"> | undefined;
  },
): Promise<Doc<"gamblingEntries"> | null> {
  const matches = await ctx.db
    .query("gamblingEntries")
    .withIndex(
      "by_canonicalWagerKey",
      (index) =>
        index
          .eq("userId", input.userId)
          .eq("seasonId", input.seasonId)
          .eq("gamblingTypeId", input.gamblingTypeId)
          .eq("assignmentId", input.assignmentId)
          .eq("targetUserId", input.targetUserId),
    )
    .take(2);
  if (matches.length > 1) {
    domainError(
      "CONFLICT",
      "The canonical wager key has duplicate entries.",
    );
  }
  return matches.at(0) ?? null;
}

export async function assertGamblingBudget(
  ctx: QueryCtx,
  input: {
    userId: Id<"users">;
    seasonId: Id<"seasons">;
    points: number;
    excludeEntryId?: Id<"gamblingEntries">;
  },
): Promise<void> {
  const available = await calculateAvailablePointsForUser(
    ctx,
    input.userId,
    input.seasonId,
    input.excludeEntryId,
  );
  if (input.points > available) {
    domainError(
      "CONFLICT",
      "The wager exceeds the user's available point balance.",
      {
        details: {
          reason: "INSUFFICIENT_POINTS",
          available,
        },
      },
    );
  }
}

export async function validateGamblingAwardPoint(
  ctx: GamblingReadContext,
  entry: Doc<"gamblingEntries">,
  pointId: Id<"points">,
): Promise<Doc<"points">> {
  const point = await requirePoint(ctx, pointId);
  if (
    point.userId !== entry.userId ||
    (entry.seasonId !== undefined &&
      point.seasonId !== entry.seasonId)
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Gambling award point must belong to the same user and season.",
    );
  }
  return point;
}

async function deleteOwnedGamblingAwardPoint(
  ctx: GamblingWriteContext,
  entry: Doc<"gamblingEntries">,
): Promise<void> {
  if (entry.awardPointId === undefined) {
    return;
  }
  const point = await requirePoint(ctx, entry.awardPointId);
  const relationships = await assertPointRelationshipCapacity(
    ctx,
    point._id,
  );
  const ownedEntry =
    relationships.gamblingEntries.length === 1 &&
    relationships.gamblingEntries[0]?._id === entry._id;
  if (
    !ownedEntry ||
    relationships.assignmentLinks.length > 0 ||
    relationships.guesses.length > 0 ||
    relationships.tagVotes.length > 0 ||
    relationships.quoteSubmissions.length > 0
  ) {
    domainError(
      "CONFLICT",
      "The gambling award point is shared by another relationship.",
    );
  }
  await deletePointAndClearRelationships(ctx, point);
}

function resolvedAdjustment(
  entry: Doc<"gamblingEntries">,
  gamblingType: Doc<"gamblingTypes">,
  status: "won" | "lost",
): number {
  const adjustment =
    status === "won"
      ? Math.floor(entry.points * gamblingType.multiplier)
      : -entry.points;
  const validated = validatePointAdjustment(adjustment);
  if (validated === null) {
    domainError(
      "CONFLICT",
      "Resolved gambling adjustment cannot be null.",
    );
  }
  return validated;
}

function resolvedReason(
  gamblingType: Doc<"gamblingTypes">,
  status: "won" | "lost",
): string {
  const reason = validatePointReason(
    status === "won"
      ? `Gamble win: ${gamblingType.title}`
      : `Gamble loss: ${gamblingType.title}`,
  );
  if (reason === undefined) {
    domainError(
      "CONFLICT",
      "Resolved gambling reason cannot be empty.",
    );
  }
  return reason;
}

export async function transitionGamblingStatus(
  ctx: GamblingWriteContext,
  input: {
    entry: Doc<"gamblingEntries">;
    status: GamblingStatus;
    season?: PointSeasonTarget;
    earnedAt: number;
  },
): Promise<Doc<"gamblingEntries">> {
  const resolvedStatus =
    input.status === "won" || input.status === "lost";
  if (
    input.status === input.entry.status &&
    (!resolvedStatus || input.entry.awardPointId !== undefined)
  ) {
    return input.entry;
  }
  const gamblingType = await requireGamblingType(
    ctx,
    input.entry.gamblingTypeId,
  );
  await deleteOwnedGamblingAwardPoint(ctx, input.entry);

  let seasonId = input.entry.seasonId;
  let awardPointId: Id<"points"> | undefined;
  if (input.status === "won" || input.status === "lost") {
    if (seasonId === undefined) {
      if (input.season === undefined) {
        domainError(
          "VALIDATION_FAILED",
          "A season is required to resolve this gambling entry.",
        );
      }
      seasonId = (await resolvePointSeason(ctx, input.season))._id;
    }
    const point = await insertPoint(ctx, {
      userId: input.entry.userId,
      seasonId,
      adjustment: resolvedAdjustment(
        input.entry,
        gamblingType,
        input.status,
      ),
      reason: resolvedReason(gamblingType, input.status),
      gamePointTypeId: undefined,
      earnedAt: validateEarnedAt(input.earnedAt),
    });
    awardPointId = point._id;
  }
  await ctx.db.patch("gamblingEntries", input.entry._id, {
    status: input.status,
    awardPointId,
    ...(seasonId === undefined ? {} : { seasonId }),
  });
  return await requireGamblingEntry(ctx, input.entry._id);
}

export async function updateResolvedGamblingAward(
  ctx: GamblingWriteContext,
  entry: Doc<"gamblingEntries">,
): Promise<void> {
  if (entry.status !== "won" && entry.status !== "lost") {
    return;
  }
  if (entry.awardPointId === undefined) {
    domainError(
      "CONFLICT",
      "Resolved gambling entry has no award point.",
    );
  }
  const [gamblingType, point] = await Promise.all([
    requireGamblingType(ctx, entry.gamblingTypeId),
    validateGamblingAwardPoint(ctx, entry, entry.awardPointId),
  ]);
  await ctx.db.patch("points", point._id, {
    adjustment: resolvedAdjustment(
      entry,
      gamblingType,
      entry.status,
    ),
  });
}

export async function validateGamblingParents(
  ctx: GamblingReadContext,
  input: {
    userId: Id<"users">;
    season: PointSeasonTarget;
    gamblingTypeId: Id<"gamblingTypes"> | undefined;
    assignmentId: Id<"assignments"> | undefined;
    targetUserId: Id<"users"> | undefined;
  },
) {
  const [user, season, gamblingType] = await Promise.all([
    requirePointUser(ctx, input.userId),
    resolvePointSeason(ctx, input.season),
    resolveActiveGamblingType(ctx, input.gamblingTypeId),
  ]);
  if (input.assignmentId !== undefined) {
    await requirePointAssignment(ctx, input.assignmentId);
  }
  if (input.targetUserId !== undefined) {
    await requirePointUser(ctx, input.targetUserId);
  }
  await validateGamblingTarget(ctx, {
    gamblingType,
    assignmentId: input.assignmentId,
    targetUserId: input.targetUserId,
  });
  return { user, season, gamblingType };
}
