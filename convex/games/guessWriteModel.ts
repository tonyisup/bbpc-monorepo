import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import { MAX_ROLES_PER_USER } from "../identity/limits.js";
import { domainError } from "../lib/errors.js";
import { MAX_HOST_GUESSES_PER_BATCH } from "./limits.js";
import { requireGuess } from "./guessReadModel.js";
import {
  requirePoint,
  requirePointAssignment,
  requirePointUser,
  resolvePointSeason,
} from "./pointWriteModel.js";

type GuessReadContext = Pick<QueryCtx, "db">;
type GuessWriteContext = Pick<MutationCtx, "db">;

export function validateGuessCreatedAt(value: number): number {
  if (!Number.isSafeInteger(value)) {
    domainError(
      "VALIDATION_FAILED",
      "Guess creation time must be an integer epoch-millisecond value.",
    );
  }
  return value;
}

export async function requireGuessRating(
  ctx: GuessReadContext,
  id: Id<"ratings">,
): Promise<Doc<"ratings">> {
  const rating = await ctx.db.get("ratings", id);
  if (rating === null) {
    domainError("NOT_FOUND", "The guess rating is unavailable.");
  }
  return rating;
}

export async function requireAssignmentReview(
  ctx: GuessReadContext,
  id: Id<"assignmentReviews">,
): Promise<Doc<"assignmentReviews">> {
  const assignmentReview = await ctx.db.get(
    "assignmentReviews",
    id,
  );
  if (assignmentReview === null) {
    domainError(
      "NOT_FOUND",
      "The assignment review is unavailable.",
    );
  }
  return assignmentReview;
}

export async function requireOpenPredictionAssignment(
  ctx: GuessReadContext,
  id: Id<"assignments">,
): Promise<Doc<"assignments">> {
  const assignment = await requirePointAssignment(ctx, id);
  const episode = await ctx.db.get(
    "episodes",
    assignment.episodeId,
  );
  if (episode === null) {
    domainError(
      "CONFLICT",
      "Prediction assignment has a missing episode.",
      { details: { assignmentId: assignment._id } },
    );
  }
  if (!assignment.playable || episode.status !== "next") {
    domainError(
      "CONFLICT",
      "Prediction round is not open.",
      { details: { reason: "ROUND_LOCKED" } },
    );
  }
  return assignment;
}

async function requireActiveHost(
  ctx: GuessReadContext,
  hostId: Id<"users">,
): Promise<void> {
  const user = await requirePointUser(ctx, hostId);
  const memberships = await ctx.db
    .query("userRoles")
    .withIndex("by_userId", (index) => index.eq("userId", hostId))
    .take(MAX_ROLES_PER_USER + 1);
  if (memberships.length > MAX_ROLES_PER_USER) {
    domainError(
      "CONFLICT",
      "Host role memberships exceed the supported lookup limit.",
      { details: { limit: MAX_ROLES_PER_USER } },
    );
  }
  let isHost = false;
  for (const membership of memberships) {
    const role = await ctx.db.get("roles", membership.roleId);
    if (role === null) {
      domainError(
        "CONFLICT",
        "A host role membership references a missing role.",
      );
    }
    isHost ||= role.admin;
  }
  if (user.status !== "active" || !isHost) {
    domainError("VALIDATION_FAILED", "Host is invalid for this round.", {
      details: { reason: "INVALID_HOST" },
    });
  }
}

async function findExistingHostAssignmentReview(
  ctx: GuessReadContext,
  assignment: Doc<"assignments">,
  hostId: Id<"users">,
): Promise<Doc<"assignmentReviews"> | null> {
  const reviews = await ctx.db
    .query("reviews")
    .withIndex("by_userId_and_movieId", (index) =>
      index
        .eq("userId", hostId)
        .eq("movieId", assignment.movieId),
    )
    .take(MAX_HOST_GUESSES_PER_BATCH + 1);
  if (reviews.length > MAX_HOST_GUESSES_PER_BATCH) {
    domainError(
      "CONFLICT",
      "Host reviews exceed the supported lookup limit.",
      { details: { limit: MAX_HOST_GUESSES_PER_BATCH } },
    );
  }
  let match: Doc<"assignmentReviews"> | null = null;
  for (const review of reviews) {
    const assignmentReview = await ctx.db
      .query("assignmentReviews")
      .withIndex("by_assignmentId_and_reviewId", (index) =>
        index
          .eq("assignmentId", assignment._id)
          .eq("reviewId", review._id),
      )
      .first();
    if (assignmentReview !== null) {
      if (match !== null) {
        domainError(
          "CONFLICT",
          "Host has multiple reviews linked to the assignment.",
          { details: { reason: "INVALID_HOST" } },
        );
      }
      match = assignmentReview;
    }
  }
  return match;
}

export async function findHostAssignmentReview(
  ctx: GuessReadContext,
  assignment: Doc<"assignments">,
  hostId: Id<"users">,
): Promise<Doc<"assignmentReviews">> {
  await requireActiveHost(ctx, hostId);
  const match = await findExistingHostAssignmentReview(
    ctx,
    assignment,
    hostId,
  );
  if (match === null) {
    domainError("VALIDATION_FAILED", "Host is invalid for this round.", {
      details: { reason: "INVALID_HOST" },
    });
  }
  return match;
}

export async function getOrCreateHostAssignmentReview(
  ctx: GuessWriteContext,
  assignment: Doc<"assignments">,
  hostId: Id<"users">,
): Promise<Doc<"assignmentReviews">> {
  await requireActiveHost(ctx, hostId);
  const match = await findExistingHostAssignmentReview(
    ctx,
    assignment,
    hostId,
  );
  if (match === null) {
    const reviewId = await ctx.db.insert("reviews", {
      userId: hostId,
      movieId: assignment.movieId,
    });
    const assignmentReviewId = await ctx.db.insert(
      "assignmentReviews",
      {
        assignmentId: assignment._id,
        reviewId,
      },
    );
    const created = await ctx.db.get(
      "assignmentReviews",
      assignmentReviewId,
    );
    if (created === null) {
      domainError(
        "INTERNAL_ERROR",
        "The host assignment review could not be created.",
      );
    }
    return created;
  }
  return match;
}

export async function upsertGuess(
  ctx: GuessWriteContext,
  input: {
    userId: Id<"users">;
    assignmentReviewId: Id<"assignmentReviews">;
    ratingId: Id<"ratings">;
    seasonId: Id<"seasons">;
    createdAt: number;
  },
): Promise<{ guess: Doc<"guesses">; created: boolean }> {
  const existing = await ctx.db
    .query("guesses")
    .withIndex("by_userId_and_assignmentReviewId", (index) =>
      index
        .eq("userId", input.userId)
        .eq("assignmentReviewId", input.assignmentReviewId),
    )
    .take(2);
  if (existing.length > 1) {
    domainError(
      "CONFLICT",
      "User has duplicate guesses for an assignment review.",
      { details: { assignmentReviewId: input.assignmentReviewId } },
    );
  }
  const existingGuess = existing.at(0);
  if (existingGuess !== undefined) {
    await ctx.db.patch("guesses", existingGuess._id, {
      ratingId: input.ratingId,
      createdAt: input.createdAt,
    });
    return {
      guess: await requireGuess(ctx, existingGuess._id),
      created: false,
    };
  }
  const guessId = await ctx.db.insert("guesses", {
    userId: input.userId,
    assignmentReviewId: input.assignmentReviewId,
    ratingId: input.ratingId,
    seasonId: input.seasonId,
    createdAt: input.createdAt,
  });
  return {
    guess: await requireGuess(ctx, guessId),
    created: true,
  };
}

export async function validateGuessPoint(
  ctx: GuessReadContext,
  guess: Doc<"guesses">,
  pointId: Id<"points">,
): Promise<Doc<"points">> {
  const point = await requirePoint(ctx, pointId);
  if (
    point.userId !== guess.userId ||
    point.seasonId !== guess.seasonId
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Guess award point must belong to the same user and season.",
    );
  }
  return point;
}

export async function resolveGuessSeason(
  ctx: GuessReadContext,
  today: string,
): Promise<Doc<"seasons">> {
  return await resolvePointSeason(ctx, {
    kind: "current",
    today,
  });
}
