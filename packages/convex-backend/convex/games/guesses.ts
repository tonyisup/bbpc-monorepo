import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
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
  MAX_GUESSES_PER_ASSIGNMENT,
  MAX_HOST_GUESSES_PER_BATCH,
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
  guessValidator,
  pointSeasonSelectorValidator,
} from "./validators.js";

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
    await ctx.db.delete("guesses", guess._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.guessDeleted",
      targetType: "guess",
      targetId: guess._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
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
    const pointIds = new Map<Id<"points">, Id<"points">>();
    for (const guess of guesses) {
      if (guess.pointId !== undefined) {
        pointIds.set(guess.pointId, guess.pointId);
      }
      await ctx.db.delete("guesses", guess._id);
    }
    let deletedPoints = 0;
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
