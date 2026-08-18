import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import {
  adminMutation,
  adminQuery,
  authenticatedMutation,
  authenticatedQuery,
} from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  MAX_ASSIGNMENTS_FOR_GUESS_READ,
  MAX_GUESS_SETTLEMENTS_PER_ASSIGNMENT,
  MAX_GUESSES_PER_ASSIGNMENT,
  MAX_HOST_GUESSES_PER_BATCH,
  MAX_POINT_RELATIONSHIPS,
  validateGuessPageSize,
} from "./limits.js";
import {
  hydrateGuess,
  readGuessesForAssignmentUser,
  requireGuess,
} from "./guessReadModel.js";
import {
  getOrCreateHostAssignmentReview,
  requireAssignmentReview,
  requireGuessRating,
  requireOpenPredictionAssignment,
  resolveGuessSeason,
  upsertGuess,
  validateGuessCreatedAt,
  validateGuessPoint,
} from "./guessWriteModel.js";
import {
  deletePointAndClearRelationships,
  insertPoint,
  requireOptionalGamePointType,
  requirePoint,
  requirePointAssignment,
  requirePointUser,
  resolveGamePointTypeByLookup,
  resolvePointSeason,
  validateEarnedAt,
  validatePointAdjustment,
  validatePointReason,
} from "./pointWriteModel.js";
import {
  assignmentGuessGroupValidator,
  guessSettlementResultValidator,
  guessSettlementValidator,
  guessValidator,
  pointSeasonSelectorValidator,
} from "./validators.js";

const SETTLEMENT_GUESS_COUNT = 3;
const GROUP_POINT_LOOKUPS = new Set([
  "allcorrect",
  "all-incorrect",
]);

type GuessWriteContext = Pick<MutationCtx, "db">;
type GuessSettlementOutcome =
  | "allcorrect"
  | "all-incorrect"
  | "mixed";

interface GroupAwardPoint {
  point: Doc<"points">;
  lookupId: "allcorrect" | "all-incorrect";
}

function validateAssignmentIds(
  assignmentIds: Array<Id<"assignments">>,
): void {
  if (
    assignmentIds.length < 1 ||
    assignmentIds.length > MAX_ASSIGNMENTS_FOR_GUESS_READ ||
    new Set(assignmentIds).size !== assignmentIds.length
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Assignment IDs must contain 1 through ${String(MAX_ASSIGNMENTS_FOR_GUESS_READ)} distinct values.`,
    );
  }
}

async function hydrateGuesses(
  ctx: Parameters<typeof hydrateGuess>[0],
  guesses: Array<Doc<"guesses">>,
) {
  return await Promise.all(
    guesses.map((guess) => hydrateGuess(ctx, guess)),
  );
}

async function resolveSelectedSeasonId(
  ctx: Parameters<typeof resolvePointSeason>[0],
  selector:
    | { kind: "all" }
    | { kind: "current"; today: string }
    | { kind: "season"; seasonId: Id<"seasons"> },
): Promise<Id<"seasons"> | null> {
  return selector.kind === "all"
    ? null
    : (await resolvePointSeason(ctx, selector))._id;
}

async function readGroupAwardPoints(
  ctx: GuessWriteContext,
  assignmentId: Id<"assignments">,
  userId: Id<"users">,
): Promise<GroupAwardPoint[]> {
  const links = await ctx.db
    .query("assignmentPointLinks")
    .withIndex("by_assignmentId_and_userId", (index) =>
      index
        .eq("assignmentId", assignmentId)
        .eq("userId", userId),
    )
    .take(MAX_POINT_RELATIONSHIPS + 1);
  if (links.length > MAX_POINT_RELATIONSHIPS) {
    domainError(
      "CONFLICT",
      "Assignment points exceed the supported settlement limit.",
      { details: { limit: MAX_POINT_RELATIONSHIPS } },
    );
  }

  const seenPointIds = new Set<Id<"points">>();
  const groupPoints: GroupAwardPoint[] = [];
  for (const link of links) {
    if (seenPointIds.has(link.pointId)) {
      domainError(
        "CONFLICT",
        "A settlement point is linked to the assignment more than once.",
      );
    }
    seenPointIds.add(link.pointId);
    const point = await requirePoint(ctx, link.pointId);
    if (point.userId !== userId) {
      domainError(
        "CONFLICT",
        "Assignment settlement point user does not match its link.",
      );
    }
    if (point.gamePointTypeId === undefined) {
      continue;
    }
    const pointType = await ctx.db.get(
      "gamePointTypes",
      point.gamePointTypeId,
    );
    if (pointType === null) {
      domainError(
        "CONFLICT",
        "Assignment settlement point has a missing point type.",
      );
    }
    if (!GROUP_POINT_LOOKUPS.has(pointType.normalizedLookupId)) {
      continue;
    }
    const pointLinks = await ctx.db
      .query("assignmentPointLinks")
      .withIndex("by_pointId", (index) =>
        index.eq("pointId", point._id),
      )
      .take(2);
    if (pointLinks.length !== 1) {
      domainError(
        "CONFLICT",
        "A settlement point must belong to exactly one assignment.",
      );
    }
    groupPoints.push({
      point,
      lookupId: pointType.normalizedLookupId as GroupAwardPoint["lookupId"],
    });
  }
  for (const lookupId of GROUP_POINT_LOOKUPS) {
    let matchingCount = 0;
    for (const candidate of groupPoints) {
      if (candidate.lookupId === lookupId) {
        matchingCount += 1;
      }
    }
    if (matchingCount > 1) {
      domainError(
        "CONFLICT",
        `The listener has duplicate ${lookupId} assignment points.`,
      );
    }
  }
  return groupPoints;
}

async function requireCanonicalGuessPoint(
  ctx: GuessWriteContext,
  guess: Doc<"guesses">,
  pointTypeId: Id<"gamePointTypes">,
): Promise<Doc<"points">> {
  if (guess.pointId === undefined) {
    domainError("CONFLICT", "The guess has no award point.");
  }
  const point = await requirePoint(ctx, guess.pointId);
  if (
    point.userId !== guess.userId ||
    point.seasonId !== guess.seasonId ||
    point.gamePointTypeId !== pointTypeId
  ) {
    domainError(
      "CONFLICT",
      "The guess has a non-standard award point that must be reviewed manually.",
      { details: { guessId: guess._id } },
    );
  }
  return point;
}

async function clearGuessSettlements(
  ctx: GuessWriteContext,
  assignmentId: Id<"assignments">,
  userId: Id<"users">,
): Promise<number> {
  const settlements = await ctx.db
    .query("guessSettlements")
    .withIndex(
      "by_assignmentId_and_userId_and_seasonId",
      (index) =>
        index
          .eq("assignmentId", assignmentId)
          .eq("userId", userId),
    )
    .take(MAX_GUESS_SETTLEMENTS_PER_ASSIGNMENT + 1);
  if (
    settlements.length > MAX_GUESS_SETTLEMENTS_PER_ASSIGNMENT
  ) {
    domainError(
      "CONFLICT",
      "Guess settlements exceed the supported cleanup limit.",
      {
        details: {
          limit: MAX_GUESS_SETTLEMENTS_PER_ASSIGNMENT,
        },
      },
    );
  }
  if (settlements.length === 0) {
    return 0;
  }
  const groupPoints = await readGroupAwardPoints(
    ctx,
    assignmentId,
    userId,
  );
  for (const candidate of groupPoints) {
    await deletePointAndClearRelationships(ctx, candidate.point);
  }
  for (const settlement of settlements) {
    await ctx.db.delete("guessSettlements", settlement._id);
  }
  return groupPoints.length;
}

export const mineForAssignment = authenticatedQuery({
  args: { assignmentId: v.id("assignments") },
  returns: v.array(guessValidator),
  handler: async (ctx, args) => {
    await requirePointAssignment(ctx, args.assignmentId);
    return await hydrateGuesses(
      ctx,
      await readGuessesForAssignmentUser(
        ctx,
        args.assignmentId,
        ctx.actor.user._id,
      ),
    );
  },
});

export const mineForAssignments = authenticatedQuery({
  args: { assignmentIds: v.array(v.id("assignments")) },
  returns: v.array(assignmentGuessGroupValidator),
  handler: async (ctx, args) => {
    validateAssignmentIds(args.assignmentIds);
    const groups = [];
    for (const assignmentId of args.assignmentIds) {
      await requirePointAssignment(ctx, assignmentId);
      groups.push({
        assignmentId,
        guesses: await hydrateGuesses(
          ctx,
          await readGuessesForAssignmentUser(
            ctx,
            assignmentId,
            ctx.actor.user._id,
          ),
        ),
      });
    }
    return groups;
  },
});

export const submit = authenticatedMutation({
  args: {
    assignmentId: v.id("assignments"),
    hostId: v.id("users"),
    ratingId: v.id("ratings"),
    today: v.string(),
    createdAt: v.optional(v.number()),
  },
  returns: guessValidator,
  handler: async (ctx, args) => {
    const [assignment, rating, season] = await Promise.all([
      requireOpenPredictionAssignment(ctx, args.assignmentId),
      requireGuessRating(ctx, args.ratingId),
      resolveGuessSeason(ctx, args.today),
    ]);
    const assignmentReview = await getOrCreateHostAssignmentReview(
      ctx,
      assignment,
      args.hostId,
    );
    const result = await upsertGuess(ctx, {
      userId: ctx.actor.user._id,
      assignmentReviewId: assignmentReview._id,
      ratingId: rating._id,
      seasonId: season._id,
      createdAt: validateGuessCreatedAt(
        args.createdAt ?? Date.now(),
      ),
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: result.created
        ? "games.member.guessCreated"
        : "games.member.guessUpdated",
      targetType: "guess",
      targetId: result.guess._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return await hydrateGuess(ctx, result.guess);
  },
});

export const getById = adminQuery({
  args: { id: v.id("guesses") },
  returns: v.union(guessValidator, v.null()),
  handler: async (ctx, args) => {
    const guess = await ctx.db.get("guesses", args.id);
    return guess === null ? null : await hydrateGuess(ctx, guess);
  },
});

export const listForUserPage = adminQuery({
  args: {
    userId: v.id("users"),
    season: pointSeasonSelectorValidator,
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(guessValidator),
  handler: async (ctx, args) => {
    validateGuessPageSize(args.paginationOpts.numItems);
    await requirePointUser(ctx, args.userId);
    const seasonId = await resolveSelectedSeasonId(
      ctx,
      args.season,
    );
    const result =
      seasonId === null
        ? await ctx.db
            .query("guesses")
            .withIndex("by_userId", (index) =>
              index.eq("userId", args.userId),
            )
            .paginate(args.paginationOpts)
        : await ctx.db
            .query("guesses")
            .withIndex(
              "by_userId_and_seasonId_and_createdAt",
              (index) =>
                index
                  .eq("userId", args.userId)
                  .eq("seasonId", seasonId),
            )
            .order("desc")
            .paginate(args.paginationOpts);
    return {
      ...result,
      page: await hydrateGuesses(ctx, result.page),
    };
  },
});

export const listForSeasonPage = adminQuery({
  args: {
    seasonId: v.id("seasons"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(guessValidator),
  handler: async (ctx, args) => {
    validateGuessPageSize(args.paginationOpts.numItems);
    await resolvePointSeason(ctx, {
      kind: "season",
      seasonId: args.seasonId,
    });
    const result = await ctx.db
      .query("guesses")
      .withIndex("by_seasonId_and_createdAt", (index) =>
        index.eq("seasonId", args.seasonId),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await hydrateGuesses(ctx, result.page),
    };
  },
});

export const listForAssignment = adminQuery({
  args: { assignmentId: v.id("assignments") },
  returns: v.array(guessValidator),
  handler: async (ctx, args) => {
    await requirePointAssignment(ctx, args.assignmentId);
    const assignmentReviews = await ctx.db
      .query("assignmentReviews")
      .withIndex("by_assignmentId", (index) =>
        index.eq("assignmentId", args.assignmentId),
      )
      .take(MAX_GUESSES_PER_ASSIGNMENT + 1);
    if (assignmentReviews.length > MAX_GUESSES_PER_ASSIGNMENT) {
      domainError(
        "CONFLICT",
        "Assignment reviews exceed the supported guess limit.",
        { details: { limit: MAX_GUESSES_PER_ASSIGNMENT } },
      );
    }
    const guesses: Array<Doc<"guesses">> = [];
    for (const assignmentReview of assignmentReviews) {
      const reviewGuesses = await ctx.db
        .query("guesses")
        .withIndex("by_assignmentReviewId", (index) =>
          index.eq("assignmentReviewId", assignmentReview._id),
        )
        .take(MAX_GUESSES_PER_ASSIGNMENT + 1);
      if (reviewGuesses.length > MAX_GUESSES_PER_ASSIGNMENT) {
        domainError(
          "CONFLICT",
          "Guesses exceed the per-review read limit.",
          { details: { limit: MAX_GUESSES_PER_ASSIGNMENT } },
        );
      }
      guesses.push(...reviewGuesses);
      if (guesses.length > MAX_GUESSES_PER_ASSIGNMENT) {
        domainError(
          "CONFLICT",
          "Guesses exceed the assignment read limit.",
          { details: { limit: MAX_GUESSES_PER_ASSIGNMENT } },
        );
      }
    }
    return await hydrateGuesses(ctx, guesses);
  },
});

export const listSettlementsForAssignment = adminQuery({
  args: { assignmentId: v.id("assignments") },
  returns: v.array(guessSettlementValidator),
  handler: async (ctx, args) => {
    await requirePointAssignment(ctx, args.assignmentId);
    const settlements = await ctx.db
      .query("guessSettlements")
      .withIndex("by_assignmentId", (index) =>
        index.eq("assignmentId", args.assignmentId),
      )
      .take(MAX_GUESS_SETTLEMENTS_PER_ASSIGNMENT + 1);
    if (
      settlements.length > MAX_GUESS_SETTLEMENTS_PER_ASSIGNMENT
    ) {
      domainError(
        "CONFLICT",
        "Guess settlements exceed the supported assignment limit.",
        {
          details: {
            limit: MAX_GUESS_SETTLEMENTS_PER_ASSIGNMENT,
          },
        },
      );
    }
    return settlements.map((settlement) => ({
      id: settlement._id,
      assignmentId: settlement.assignmentId,
      userId: settlement.userId,
      seasonId: settlement.seasonId,
      outcome: settlement.outcome,
      correctCount: settlement.correctCount,
      settledAt: settlement.settledAt,
    }));
  },
});

export const settleForAssignmentUser = adminMutation({
  args: {
    assignmentId: v.id("assignments"),
    userId: v.id("users"),
    earnedAt: v.optional(v.number()),
  },
  returns: guessSettlementResultValidator,
  handler: async (ctx, args) => {
    await Promise.all([
      requirePointAssignment(ctx, args.assignmentId),
      requirePointUser(ctx, args.userId),
    ]);
    const guesses = await readGuessesForAssignmentUser(
      ctx,
      args.assignmentId,
      args.userId,
    );
    if (guesses.length !== SETTLEMENT_GUESS_COUNT) {
      domainError(
        "VALIDATION_FAILED",
        `A listener settlement requires exactly ${String(SETTLEMENT_GUESS_COUNT)} guesses.`,
        { details: { guessCount: guesses.length } },
      );
    }
    const seasonIds = new Set(guesses.map((guess) => guess.seasonId));
    if (seasonIds.size !== 1) {
      domainError(
        "CONFLICT",
        "A listener's three guesses must belong to the same season.",
      );
    }
    const firstGuess = guesses.at(0);
    if (firstGuess === undefined) {
      domainError("CONFLICT", "The settlement has no guesses.");
    }
    const seasonId = firstGuess.seasonId;
    const season = await ctx.db.get("seasons", seasonId);
    if (season === null) {
      domainError("CONFLICT", "The settlement season is unavailable.");
    }

    const hostIds = new Set<Id<"users">>();
    let correctCount = 0;
    for (const guess of guesses) {
      const assignmentReview = await ctx.db.get(
        "assignmentReviews",
        guess.assignmentReviewId,
      );
      if (assignmentReview?.assignmentId !== args.assignmentId) {
        domainError(
          "CONFLICT",
          "A settlement guess has an invalid assignment review.",
          { details: { guessId: guess._id } },
        );
      }
      const review = await ctx.db.get(
        "reviews",
        assignmentReview.reviewId,
      );
      if (review?.userId === undefined) {
        domainError(
          "CONFLICT",
          "A settlement guess does not target a host review.",
          { details: { guessId: guess._id } },
        );
      }
      hostIds.add(review.userId);
      if (review.ratingId === undefined) {
        domainError(
          "CONFLICT",
          "All three hosts must rate before guesses can be settled.",
        );
      }
      if (review.ratingId === guess.ratingId) {
        correctCount += 1;
      }
    }
    if (hostIds.size !== SETTLEMENT_GUESS_COUNT) {
      domainError(
        "VALIDATION_FAILED",
        "A listener settlement requires guesses for three distinct hosts.",
      );
    }

    const outcome: GuessSettlementOutcome =
      correctCount === SETTLEMENT_GUESS_COUNT
        ? "allcorrect"
        : correctCount === 0
          ? "all-incorrect"
          : "mixed";
    const earnedAt = validateEarnedAt(args.earnedAt ?? Date.now());
    const guessPointType = await resolveGamePointTypeByLookup(
      ctx,
      "guess",
    );
    if (guessPointType.gameTypeId !== season.gameTypeId) {
      domainError(
        "CONFLICT",
        "The guess point type does not belong to the settlement season's game.",
      );
    }

    let individualPointsCreated = 0;
    let individualPointsRemoved = 0;
    for (const guess of guesses) {
      const assignmentReview = await ctx.db.get(
        "assignmentReviews",
        guess.assignmentReviewId,
      );
      if (assignmentReview === null) {
        domainError("CONFLICT", "A settlement review disappeared.");
      }
      const review = await ctx.db.get(
        "reviews",
        assignmentReview.reviewId,
      );
      if (review?.ratingId === undefined) {
        domainError("CONFLICT", "A settlement host rating disappeared.");
      }
      const correct = review.ratingId === guess.ratingId;
      if (correct && guess.pointId === undefined) {
        const point = await insertPoint(ctx, {
          userId: guess.userId,
          seasonId: guess.seasonId,
          adjustment: 0,
          reason: "Correct prediction",
          gamePointTypeId: guessPointType._id,
          earnedAt,
        });
        await ctx.db.patch("guesses", guess._id, {
          pointId: point._id,
        });
        individualPointsCreated += 1;
      } else if (correct) {
        await requireCanonicalGuessPoint(
          ctx,
          guess,
          guessPointType._id,
        );
      } else if (guess.pointId !== undefined) {
        const point = await requireCanonicalGuessPoint(
          ctx,
          guess,
          guessPointType._id,
        );
        await deletePointAndClearRelationships(ctx, point);
        individualPointsRemoved += 1;
      }
    }

    const existingGroupPoints = await readGroupAwardPoints(
      ctx,
      args.assignmentId,
      args.userId,
    );
    for (const candidate of existingGroupPoints) {
      if (candidate.point.seasonId !== seasonId) {
        domainError(
          "CONFLICT",
          "A settlement point belongs to a different season.",
        );
      }
    }
    const desiredLookup = outcome === "mixed" ? null : outcome;
    const matchingGroupPoint =
      desiredLookup === null
        ? undefined
        : existingGroupPoints.find(
            (candidate) => candidate.lookupId === desiredLookup,
          );
    let groupPointChanged = false;
    for (const candidate of existingGroupPoints) {
      if (candidate !== matchingGroupPoint) {
        await deletePointAndClearRelationships(ctx, candidate.point);
        groupPointChanged = true;
      }
    }
    if (desiredLookup !== null) {
      const groupPointType = await resolveGamePointTypeByLookup(
        ctx,
        desiredLookup,
      );
      if (groupPointType.gameTypeId !== season.gameTypeId) {
        domainError(
          "CONFLICT",
          "The settlement point type does not belong to the settlement season's game.",
        );
      }
      const reason =
        desiredLookup === "allcorrect"
          ? "All three predictions correct"
          : "All three predictions incorrect";
      if (matchingGroupPoint === undefined) {
        const point = await insertPoint(ctx, {
          userId: args.userId,
          seasonId,
          adjustment: 0,
          reason,
          gamePointTypeId: groupPointType._id,
          earnedAt,
        });
        await ctx.db.insert("assignmentPointLinks", {
          assignmentId: args.assignmentId,
          userId: args.userId,
          pointId: point._id,
        });
        groupPointChanged = true;
      } else if (
        matchingGroupPoint.point.gamePointTypeId !==
          groupPointType._id ||
        matchingGroupPoint.point.adjustment !== 0 ||
        matchingGroupPoint.point.reason !== reason
      ) {
        await ctx.db.patch("points", matchingGroupPoint.point._id, {
          adjustment: 0,
          reason,
          gamePointTypeId: groupPointType._id,
        });
        groupPointChanged = true;
      }
    }

    const existingSettlement = await ctx.db
      .query("guessSettlements")
      .withIndex(
        "by_assignmentId_and_userId_and_seasonId",
        (index) =>
          index
            .eq("assignmentId", args.assignmentId)
            .eq("userId", args.userId)
            .eq("seasonId", seasonId),
      )
      .unique();
    const settlementId =
      existingSettlement === null
        ? await ctx.db.insert("guessSettlements", {
            assignmentId: args.assignmentId,
            userId: args.userId,
            seasonId,
            outcome,
            correctCount,
            settledAt: earnedAt,
          })
        : existingSettlement._id;
    if (existingSettlement !== null) {
      await ctx.db.patch("guessSettlements", settlementId, {
        outcome,
        correctCount,
        settledAt: earnedAt,
      });
    }
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.guessesSettled",
      targetType: "assignment",
      targetId: args.assignmentId,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: {
        userId: args.userId,
        outcome,
        correctCount,
        individualPointsCreated,
        individualPointsRemoved,
        groupPointChanged,
      },
    });
    return {
      id: settlementId,
      assignmentId: args.assignmentId,
      userId: args.userId,
      seasonId,
      outcome,
      correctCount,
      settledAt: earnedAt,
      guessCount: guesses.length,
      individualPointsCreated,
      individualPointsRemoved,
      groupPointChanged,
    };
  },
});

export const create = adminMutation({
  args: {
    userId: v.id("users"),
    assignmentReviewId: v.id("assignmentReviews"),
    ratingId: v.id("ratings"),
    seasonId: v.id("seasons"),
    createdAt: v.optional(v.number()),
  },
  returns: guessValidator,
  handler: async (ctx, args) => {
    const [user, assignmentReview, rating, season] =
      await Promise.all([
        requirePointUser(ctx, args.userId),
        requireAssignmentReview(ctx, args.assignmentReviewId),
        requireGuessRating(ctx, args.ratingId),
        resolvePointSeason(ctx, {
          kind: "season",
          seasonId: args.seasonId,
        }),
      ]);
    const result = await upsertGuess(ctx, {
      userId: user._id,
      assignmentReviewId: assignmentReview._id,
      ratingId: rating._id,
      seasonId: season._id,
      createdAt: validateGuessCreatedAt(
        args.createdAt ?? Date.now(),
      ),
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: result.created
        ? "games.admin.guessCreated"
        : "games.admin.guessUpdated",
      targetType: "guess",
      targetId: result.guess._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return await hydrateGuess(ctx, result.guess);
  },
});

export const upsertForUser = adminMutation({
  args: {
    assignmentId: v.id("assignments"),
    userId: v.id("users"),
    today: v.string(),
    guesses: v.array(
      v.object({
        hostId: v.id("users"),
        ratingId: v.id("ratings"),
      }),
    ),
    createdAt: v.optional(v.number()),
  },
  returns: v.array(guessValidator),
  handler: async (ctx, args) => {
    if (
      args.guesses.length < 1 ||
      args.guesses.length > MAX_HOST_GUESSES_PER_BATCH ||
      new Set(args.guesses.map((guess) => guess.hostId)).size !==
        args.guesses.length
    ) {
      domainError(
        "VALIDATION_FAILED",
        `Guess batch must contain 1 through ${String(MAX_HOST_GUESSES_PER_BATCH)} distinct hosts.`,
      );
    }
    const [user, assignment, season] = await Promise.all([
      requirePointUser(ctx, args.userId),
      requirePointAssignment(ctx, args.assignmentId),
      resolveGuessSeason(ctx, args.today),
    ]);
    const createdAt = validateGuessCreatedAt(
      args.createdAt ?? Date.now(),
    );
    const results = [];
    for (const input of args.guesses) {
      const [assignmentReview, rating] = await Promise.all([
        getOrCreateHostAssignmentReview(
          ctx,
          assignment,
          input.hostId,
        ),
        requireGuessRating(ctx, input.ratingId),
      ]);
      results.push(
        (
          await upsertGuess(ctx, {
            userId: user._id,
            assignmentReviewId: assignmentReview._id,
            ratingId: rating._id,
            seasonId: season._id,
            createdAt,
          })
        ).guess,
      );
    }
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.guessBatchUpserted",
      targetType: "assignment",
      targetId: assignment._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { guessCount: results.length },
    });
    return await hydrateGuesses(ctx, results);
  },
});

export const updateRating = adminMutation({
  args: {
    id: v.id("guesses"),
    ratingId: v.id("ratings"),
    expectedRatingId: v.optional(v.id("ratings")),
  },
  returns: guessValidator,
  handler: async (ctx, args) => {
    const [guess, rating] = await Promise.all([
      requireGuess(ctx, args.id),
      requireGuessRating(ctx, args.ratingId),
    ]);
    if (
      args.expectedRatingId !== undefined &&
      guess.ratingId !== args.expectedRatingId
    ) {
      domainError(
        "CONFLICT",
        "The guess rating changed after it was loaded.",
      );
    }
    await ctx.db.patch("guesses", guess._id, {
      ratingId: rating._id,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.guessRatingUpdated",
      targetType: "guess",
      targetId: guess._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return await hydrateGuess(ctx, await requireGuess(ctx, guess._id));
  },
});

export const setPoint = adminMutation({
  args: {
    id: v.id("guesses"),
    pointId: v.union(v.id("points"), v.null()),
  },
  returns: guessValidator,
  handler: async (ctx, args) => {
    const guess = await requireGuess(ctx, args.id);
    if (args.pointId !== null) {
      await validateGuessPoint(ctx, guess, args.pointId);
    }
    await ctx.db.patch("guesses", guess._id, {
      pointId: args.pointId ?? undefined,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action:
        args.pointId === null
          ? "games.admin.guessPointCleared"
          : "games.admin.guessPointSet",
      targetType: "guess",
      targetId: guess._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return await hydrateGuess(ctx, await requireGuess(ctx, guess._id));
  },
});

export const awardPoint = adminMutation({
  args: {
    id: v.id("guesses"),
    adjustment: v.number(),
    reason: v.string(),
    gamePointTypeId: v.optional(v.id("gamePointTypes")),
    earnedAt: v.optional(v.number()),
  },
  returns: guessValidator,
  handler: async (ctx, args) => {
    const guess = await requireGuess(ctx, args.id);
    if (guess.pointId !== undefined) {
      domainError("CONFLICT", "The guess already has an award point.");
    }
    const pointType =
      args.gamePointTypeId === undefined
        ? await resolveGamePointTypeByLookup(ctx, "guess")
        : await requireOptionalGamePointType(
            ctx,
            args.gamePointTypeId,
          );
    const point = await insertPoint(ctx, {
      userId: guess.userId,
      seasonId: guess.seasonId,
      adjustment: validatePointAdjustment(args.adjustment),
      reason: validatePointReason(args.reason),
      gamePointTypeId: pointType?._id,
      earnedAt: validateEarnedAt(args.earnedAt ?? Date.now()),
    });
    await ctx.db.patch("guesses", guess._id, {
      pointId: point._id,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.guessPointAwarded",
      targetType: "guess",
      targetId: guess._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { pointId: point._id },
    });
    return await hydrateGuess(ctx, await requireGuess(ctx, guess._id));
  },
});

export const remove = adminMutation({
  args: {
    id: v.id("guesses"),
    expected: v.optional(
      v.object({
        userId: v.id("users"),
        assignmentReviewId: v.id("assignmentReviews"),
        ratingId: v.id("ratings"),
        seasonId: v.id("seasons"),
        createdAt: v.number(),
        hasPoint: v.boolean(),
      }),
    ),
  },
  returns: v.object({ id: v.id("guesses") }),
  handler: async (ctx, args) => {
    const guess = await requireGuess(ctx, args.id);
    const assignmentReview = await ctx.db.get(
      "assignmentReviews",
      guess.assignmentReviewId,
    );
    if (assignmentReview === null) {
      domainError(
        "CONFLICT",
        "The guess has a missing assignment review.",
      );
    }
    if (
      args.expected !== undefined &&
      (guess.userId !== args.expected.userId ||
        guess.assignmentReviewId !==
          args.expected.assignmentReviewId ||
        guess.ratingId !== args.expected.ratingId ||
        guess.seasonId !== args.expected.seasonId ||
        guess.createdAt !== args.expected.createdAt ||
        (guess.pointId !== undefined) !== args.expected.hasPoint)
    ) {
      domainError(
        "CONFLICT",
        "The guess changed after deletion was requested.",
      );
    }
    const deletedSettlementPoints = await clearGuessSettlements(
      ctx,
      assignmentReview.assignmentId,
      guess.userId,
    );
    await ctx.db.delete("guesses", guess._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.guessDeleted",
      targetType: "guess",
      targetId: guess._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { deletedSettlementPoints },
    });
    return { id: guess._id };
  },
});

export const removeForAssignmentUser = adminMutation({
  args: {
    assignmentId: v.id("assignments"),
    userId: v.id("users"),
  },
  returns: v.object({
    deletedGuesses: v.number(),
    deletedPoints: v.number(),
  }),
  handler: async (ctx, args) => {
    await Promise.all([
      requirePointAssignment(ctx, args.assignmentId),
      requirePointUser(ctx, args.userId),
    ]);
    const guesses = await readGuessesForAssignmentUser(
      ctx,
      args.assignmentId,
      args.userId,
    );
    let deletedPoints = await clearGuessSettlements(
      ctx,
      args.assignmentId,
      args.userId,
    );
    const pointIds = new Map<Id<"points">, Id<"points">>();
    for (const guess of guesses) {
      if (guess.pointId !== undefined) {
        pointIds.set(guess.pointId, guess.pointId);
      }
      await ctx.db.delete("guesses", guess._id);
    }
    for (const pointId of pointIds.values()) {
      const remainingGuess = await ctx.db
        .query("guesses")
        .withIndex("by_pointId", (index) =>
          index.eq("pointId", pointId),
        )
        .first();
      if (remainingGuess === null) {
        const point = await requirePoint(ctx, pointId);
        await deletePointAndClearRelationships(ctx, point);
        deletedPoints += 1;
      }
    }
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.assignmentUserGuessesDeleted",
      targetType: "assignment",
      targetId: args.assignmentId,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: {
        deletedGuesses: guesses.length,
        deletedPoints,
      },
    });
    return {
      deletedGuesses: guesses.length,
      deletedPoints,
    };
  },
});
