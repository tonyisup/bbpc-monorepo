import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import { MAX_EPISODE_RESULT_RELATIONSHIPS } from "./limits.js";

type RelatedTable =
  "users" | "movies" | "reviews" | "ratings" | "gamblingTypes";

async function requireRelatedDocument<TableName extends RelatedTable>(
  ctx: QueryCtx,
  table: TableName,
  id: Id<TableName>,
): Promise<Doc<TableName>> {
  const document = await ctx.db.get(table, id);
  if (document === null) {
    domainError(
      "CONFLICT",
      `Episode results found a missing ${table} relationship.`,
      { details: { table, id } },
    );
  }
  return document;
}

function toUser(user: Doc<"users">) {
  return {
    id: user._id,
    name: user.name ?? null,
    image: user.image ?? null,
  };
}

function toMovie(movie: Doc<"movies">) {
  return {
    id: movie._id,
    title: movie.title,
    year: movie.year,
    poster: movie.poster ?? null,
    url: movie.url,
    tmdbId: movie.tmdbId ?? null,
  };
}

function assertWithinResultLimit(count: number, relationship: string): void {
  if (count > MAX_EPISODE_RESULT_RELATIONSHIPS) {
    domainError(
      "CONFLICT",
      `${relationship} exceeds the public episode-results limit.`,
      {
        details: {
          relationship,
          limit: MAX_EPISODE_RESULT_RELATIONSHIPS,
        },
      },
    );
  }
}

export async function readEpisodeResults(
  ctx: QueryCtx,
  episodeId: Id<"episodes">,
) {
  const episode = await ctx.db.get("episodes", episodeId);
  if (episode === null) {
    domainError("NOT_FOUND", "The episode is unavailable.");
  }

  const assignments = await ctx.db
    .query("assignments")
    .withIndex("by_episodeId", (query) => query.eq("episodeId", episodeId))
    .take(MAX_EPISODE_RESULT_RELATIONSHIPS + 1);
  assertWithinResultLimit(assignments.length, "assignments");

  const gamblingWinners = [];
  const guessWinners = [];
  let assignmentReviewCount = 0;
  let guessCount = 0;

  for (const assignment of assignments) {
    const movie = await requireRelatedDocument(
      ctx,
      "movies",
      assignment.movieId,
    );

    const remainingGambling =
      MAX_EPISODE_RESULT_RELATIONSHIPS - gamblingWinners.length;
    const gamblingEntries = await ctx.db
      .query("gamblingEntries")
      .withIndex("by_assignmentId_and_status", (query) =>
        query.eq("assignmentId", assignment._id).eq("status", "won"),
      )
      .take(remainingGambling + 1);
    assertWithinResultLimit(
      gamblingWinners.length + gamblingEntries.length,
      "winning gambling entries",
    );
    for (const entry of gamblingEntries) {
      const [user, gamblingType] = await Promise.all([
        requireRelatedDocument(ctx, "users", entry.userId),
        requireRelatedDocument(ctx, "gamblingTypes", entry.gamblingTypeId),
      ]);
      gamblingWinners.push({
        id: entry._id,
        user: toUser(user),
        points: entry.points,
        gamblingType: {
          title: gamblingType.title,
          multiplier: gamblingType.multiplier,
        },
        movie: toMovie(movie),
      });
    }

    const remainingAssignmentReviews =
      MAX_EPISODE_RESULT_RELATIONSHIPS - assignmentReviewCount;
    const assignmentReviews = await ctx.db
      .query("assignmentReviews")
      .withIndex("by_assignmentId", (query) =>
        query.eq("assignmentId", assignment._id),
      )
      .take(remainingAssignmentReviews + 1);
    assignmentReviewCount += assignmentReviews.length;
    assertWithinResultLimit(assignmentReviewCount, "assignment reviews");

    for (const assignmentReview of assignmentReviews) {
      const review = await requireRelatedDocument(
        ctx,
        "reviews",
        assignmentReview.reviewId,
      );
      if (review.ratingId === undefined || review.userId === undefined) {
        continue;
      }
      const [rating, host] = await Promise.all([
        requireRelatedDocument(ctx, "ratings", review.ratingId),
        requireRelatedDocument(ctx, "users", review.userId),
      ]);

      const remainingGuesses = MAX_EPISODE_RESULT_RELATIONSHIPS - guessCount;
      const guesses = await ctx.db
        .query("guesses")
        .withIndex("by_assignmentReviewId", (query) =>
          query.eq("assignmentReviewId", assignmentReview._id),
        )
        .take(remainingGuesses + 1);
      guessCount += guesses.length;
      assertWithinResultLimit(guessCount, "guesses");

      for (const guess of guesses) {
        if (guess.ratingId !== review.ratingId) {
          continue;
        }
        const user = await requireRelatedDocument(ctx, "users", guess.userId);
        guessWinners.push({
          id: guess._id,
          user: toUser(user),
          host: toUser(host),
          actualRating: rating.value,
          movie: toMovie(movie),
        });
      }
    }
  }

  return { gamblingWinners, guessWinners };
}
