import type { Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import { toRating } from "../ratings/readModel.js";
import { hydrateAssignmentReview } from "../reviews/readModel.js";
import {
  MAX_GUESSES_PER_ASSIGNMENT,
} from "./limits.js";
import { hydratePointCore } from "./pointReadModel.js";
import { hydrateSeason } from "./readModel.js";
import type { guessValidator } from "./validators.js";

type GuessDetail = Infer<typeof guessValidator>;

export async function requireGuess(
  ctx: Pick<QueryCtx, "db">,
  id: Id<"guesses">,
): Promise<Doc<"guesses">> {
  const guess = await ctx.db.get("guesses", id);
  if (guess === null) {
    domainError("NOT_FOUND", "The guess is unavailable.");
  }
  return guess;
}

export async function hydrateGuess(
  ctx: QueryCtx,
  guess: Doc<"guesses">,
): Promise<GuessDetail> {
  const [user, rating, assignmentReview, season, point] =
    await Promise.all([
      ctx.db.get("users", guess.userId),
      ctx.db.get("ratings", guess.ratingId),
      ctx.db.get(
        "assignmentReviews",
        guess.assignmentReviewId,
      ),
      ctx.db.get("seasons", guess.seasonId),
      guess.pointId === undefined
        ? null
        : ctx.db.get("points", guess.pointId),
    ]);
  if (
    user === null ||
    rating === null ||
    assignmentReview === null ||
    season === null
  ) {
    domainError(
      "CONFLICT",
      "Guess has a missing canonical relationship.",
      { details: { guessId: guess._id } },
    );
  }
  if (guess.pointId !== undefined && point === null) {
    domainError(
      "CONFLICT",
      "Guess has a missing point relationship.",
      { details: { guessId: guess._id } },
    );
  }
  return {
    id: guess._id,
    createdAt: guess.createdAt,
    user: {
      id: user._id,
      name: user.name ?? null,
      image: user.image ?? null,
    },
    rating: toRating(rating),
    assignmentReview: await hydrateAssignmentReview(
      ctx,
      assignmentReview,
    ),
    season: await hydrateSeason(ctx, season),
    point:
      point === null ? null : await hydratePointCore(ctx, point),
  };
}

export async function readGuessesForAssignmentUser(
  ctx: QueryCtx,
  assignmentId: Id<"assignments">,
  userId: Id<"users">,
): Promise<Array<Doc<"guesses">>> {
  const assignmentReviews = await ctx.db
    .query("assignmentReviews")
    .withIndex("by_assignmentId", (index) =>
      index.eq("assignmentId", assignmentId),
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
    const matches = await ctx.db
      .query("guesses")
      .withIndex("by_userId_and_assignmentReviewId", (index) =>
        index
          .eq("userId", userId)
          .eq("assignmentReviewId", assignmentReview._id),
      )
      .take(2);
    if (matches.length > 1) {
      domainError(
        "CONFLICT",
        "User has duplicate guesses for an assignment review.",
        { details: { assignmentReviewId: assignmentReview._id } },
      );
    }
    guesses.push(...matches);
  }
  return guesses;
}
