import { v } from "convex/values";

import { anonymousQuery } from "../functions.js";
import { domainError } from "../lib/errors.js";
import { MAX_PUBLIC_YEAR_REVIEWS } from "./limits.js";
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
    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_reviewedAt", (index) =>
        index
          .gte("reviewedAt", startedAt)
          .lt("reviewedAt", endedAt),
      )
      .order("desc")
      .take(MAX_PUBLIC_YEAR_REVIEWS + 1);
    if (reviews.length > MAX_PUBLIC_YEAR_REVIEWS) {
      domainError(
        "CONFLICT",
        "Year reviews exceed the public read limit.",
        { details: { limit: MAX_PUBLIC_YEAR_REVIEWS } },
      );
    }

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
