import { v } from "convex/values";

import { anonymousQuery } from "../functions.js";
import { domainError } from "../lib/errors.js";
import { isPublishedStatus } from "../lib/transcriptVisibility.js";
import {
  MAX_PUBLIC_YEAR_MOVIES,
  MAX_PUBLIC_YEAR_REVIEWS,
} from "./limits.js";
import { hydrateReviewDetail } from "./readModel.js";
import { yearMovieReviewValidator } from "./validators.js";

function validateReviewYear(year: number) {
  if (!Number.isSafeInteger(year) || year < 1900 || year > 2200) {
    domainError(
      "VALIDATION_FAILED",
      "Review year must be an integer from 1900 through 2200.",
    );
  }
  return year;
}

export const listMovieReviewsForYear = anonymousQuery({
  args: { year: v.number() },
  returns: v.array(yearMovieReviewValidator),
  handler: async (ctx, args) => {
    const year = validateReviewYear(args.year);
    const startedAt = Date.UTC(year, 0, 1);
    const endedAt = Date.UTC(year + 1, 0, 1);
    // Start from the movies released this year: most reviews written in a
    // year are of older movies, so scanning reviews by date first would read
    // far more rows than the archive shows.
    const movies = await ctx.db
      .query("movies")
      .withIndex("by_year", (index) => index.eq("year", year))
      .take(MAX_PUBLIC_YEAR_MOVIES + 1);
    if (movies.length > MAX_PUBLIC_YEAR_MOVIES) {
      domainError(
        "CONFLICT",
        "Year movies exceed the public read limit.",
        { details: { limit: MAX_PUBLIC_YEAR_MOVIES } },
      );
    }

    const reviewsByMovie = await Promise.all(
      movies.map((movie) =>
        ctx.db
          .query("reviews")
          .withIndex("by_movieId_and_reviewedAt", (index) =>
            index
              .eq("movieId", movie._id)
              .gte("reviewedAt", startedAt)
              .lt("reviewedAt", endedAt),
          )
          .take(MAX_PUBLIC_YEAR_REVIEWS + 1),
      ),
    );
    const reviews = reviewsByMovie.flat();
    if (reviews.length > MAX_PUBLIC_YEAR_REVIEWS) {
      domainError(
        "CONFLICT",
        "Year reviews exceed the public read limit.",
        { details: { limit: MAX_PUBLIC_YEAR_REVIEWS } },
      );
    }
    // Newest first, with the same creation-time tiebreak an index gives.
    reviews.sort(
      (left, right) =>
        (right.reviewedAt ?? 0) - (left.reviewedAt ?? 0) ||
        right._creationTime - left._creationTime,
    );

    const hydrated = await Promise.all(
      reviews.map((review) => hydrateReviewDetail(ctx, review)),
    );
    return hydrated.flatMap((review) => {
      if (
        review.movie?.year !== year ||
        review.reviewedAt === null
      ) {
        return [];
      }
      const extraRelationship = review.extraReviews.at(0);
      const assignmentRelationship =
        review.assignmentReviews.at(0);
      const episode =
        extraRelationship !== undefined
          ? extraRelationship.episode
          : assignmentRelationship !== undefined
            ? assignmentRelationship.assignment.episode
            : null;
      // A host's rating is the answer to the round, so it waits until every
      // episode the review belongs to is published, not only the one it is
      // listed under.
      const linkedEpisodes = [
        ...review.extraReviews.map((link) => link.episode),
        ...review.assignmentReviews.map((link) => link.assignment.episode),
      ];
      if (linkedEpisodes.some((linked) => !isPublishedStatus(linked.status))) {
        return [];
      }
      return [
        {
          id: review.id,
          movie: review.movie,
          user:
            review.user === null
              ? null
              : {
                  id: review.user.id,
                  name: review.user.name,
                  image: review.user.image,
                },
          rating: review.rating,
          episode,
          reviewedAt: review.reviewedAt,
        },
      ];
    });
  },
});
