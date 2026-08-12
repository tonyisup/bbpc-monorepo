import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import {
  MAX_GUESSES_PER_REVIEW_DELETE,
  MAX_REVIEW_RELATIONSHIPS,
} from "./limits.js";

type ReviewWriteContext = Pick<MutationCtx, "db">;
type ReviewReadContext = Pick<QueryCtx, "db">;

interface ReviewCascadeImpact {
  assignmentReviewCount: number;
  extraReviewCount: number;
  guessCount: number;
}

async function loadReviewCascade(
  ctx: ReviewReadContext,
  review: Doc<"reviews">,
) {
  const [assignmentReviews, extraReviews] = await Promise.all([
    ctx.db
      .query("assignmentReviews")
      .withIndex("by_reviewId", (index) =>
        index.eq("reviewId", review._id),
      )
      .take(MAX_REVIEW_RELATIONSHIPS + 1),
    ctx.db
      .query("extraReviews")
      .withIndex("by_reviewId", (index) =>
        index.eq("reviewId", review._id),
      )
      .take(MAX_REVIEW_RELATIONSHIPS + 1),
  ]);
  if (
    assignmentReviews.length > MAX_REVIEW_RELATIONSHIPS ||
    extraReviews.length > MAX_REVIEW_RELATIONSHIPS
  ) {
    domainError(
      "CONFLICT",
      "Review relationships exceed the bounded deletion limit.",
      { details: { limit: MAX_REVIEW_RELATIONSHIPS } },
    );
  }
  const guesses: Array<Doc<"guesses">> = [];
  for (const link of assignmentReviews) {
    const remaining = MAX_GUESSES_PER_REVIEW_DELETE - guesses.length;
    const linkGuesses = await ctx.db
      .query("guesses")
      .withIndex("by_assignmentReviewId", (index) =>
        index.eq("assignmentReviewId", link._id),
      )
      .take(remaining + 1);
    if (linkGuesses.length > remaining) {
      domainError(
        "CONFLICT",
        "Review guesses exceed the bounded deletion limit.",
        { details: { limit: MAX_GUESSES_PER_REVIEW_DELETE } },
      );
    }
    guesses.push(...linkGuesses);
  }
  return { assignmentReviews, extraReviews, guesses };
}

export async function readReviewCascadeImpact(
  ctx: ReviewReadContext,
  review: Doc<"reviews">,
): Promise<ReviewCascadeImpact> {
  const { assignmentReviews, extraReviews, guesses } =
    await loadReviewCascade(ctx, review);
  return {
    assignmentReviewCount: assignmentReviews.length,
    extraReviewCount: extraReviews.length,
    guessCount: guesses.length,
  };
}

export async function requireReview(
  ctx: ReviewReadContext,
  id: Id<"reviews">,
): Promise<Doc<"reviews">> {
  const review = await ctx.db.get("reviews", id);
  if (review === null) {
    domainError("NOT_FOUND", "The review is unavailable.");
  }
  return review;
}

export async function requireAssignmentReview(
  ctx: ReviewWriteContext,
  id: Id<"assignmentReviews">,
): Promise<Doc<"assignmentReviews">> {
  const link = await ctx.db.get("assignmentReviews", id);
  if (link === null) {
    domainError(
      "NOT_FOUND",
      "The assignment review is unavailable.",
    );
  }
  return link;
}

export async function createReview(
  ctx: ReviewWriteContext,
  input: {
    userId: Id<"users">;
    movieId?: Id<"movies">;
    showId?: Id<"shows">;
    ratingId?: Id<"ratings">;
  },
): Promise<Doc<"reviews">> {
  if ((input.movieId === undefined) === (input.showId === undefined)) {
    domainError(
      "VALIDATION_FAILED",
      "Review must reference exactly one movie or show.",
    );
  }
  const [user, movie, show, rating] = await Promise.all([
    ctx.db.get("users", input.userId),
    input.movieId === undefined
      ? null
      : ctx.db.get("movies", input.movieId),
    input.showId === undefined
      ? null
      : ctx.db.get("shows", input.showId),
    input.ratingId === undefined
      ? null
      : ctx.db.get("ratings", input.ratingId),
  ]);
  if (user === null) {
    domainError("NOT_FOUND", "The review user is unavailable.");
  }
  if (input.movieId !== undefined && movie === null) {
    domainError("NOT_FOUND", "The review movie is unavailable.");
  }
  if (input.showId !== undefined && show === null) {
    domainError("NOT_FOUND", "The review show is unavailable.");
  }
  if (input.ratingId !== undefined && rating === null) {
    domainError("NOT_FOUND", "The review rating is unavailable.");
  }
  const reviewId = await ctx.db.insert("reviews", {
    userId: user._id,
    ...(movie === null ? {} : { movieId: movie._id }),
    ...(show === null ? {} : { showId: show._id }),
    ...(rating === null ? {} : { ratingId: rating._id }),
    reviewedAt: Date.now(),
  });
  return await requireReview(ctx, reviewId);
}

export async function requireEpisode(
  ctx: ReviewWriteContext,
  id: Id<"episodes">,
): Promise<Doc<"episodes">> {
  const episode = await ctx.db.get("episodes", id);
  if (episode === null) {
    domainError("NOT_FOUND", "The review episode is unavailable.");
  }
  return episode;
}

export async function requireAssignment(
  ctx: ReviewWriteContext,
  id: Id<"assignments">,
): Promise<Doc<"assignments">> {
  const assignment = await ctx.db.get("assignments", id);
  if (assignment === null) {
    domainError("NOT_FOUND", "The review assignment is unavailable.");
  }
  return assignment;
}

export async function deleteReviewCascade(
  ctx: ReviewWriteContext,
  review: Doc<"reviews">,
): Promise<{
  assignmentReviewCount: number;
  extraReviewCount: number;
  guessCount: number;
}> {
  const { assignmentReviews, extraReviews, guesses } =
    await loadReviewCascade(ctx, review);
  for (const guess of guesses) {
    await ctx.db.delete("guesses", guess._id);
  }
  for (const link of assignmentReviews) {
    await ctx.db.delete("assignmentReviews", link._id);
  }
  for (const link of extraReviews) {
    await ctx.db.delete("extraReviews", link._id);
  }
  await ctx.db.delete("reviews", review._id);
  return {
    assignmentReviewCount: assignmentReviews.length,
    extraReviewCount: extraReviews.length,
    guessCount: guesses.length,
  };
}
