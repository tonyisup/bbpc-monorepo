import { domainError } from "../lib/errors.js";

export const MAX_REVIEW_RELATIONSHIPS = 50;
export const MAX_GUESSES_PER_REVIEW_DELETE = 200;
export const MAX_REVIEW_PAGE_SIZE = 100;
// The public year archive reads the movies released in a year, then the
// reviews of those movies written that year. Each review hydrates with about
// seven database calls, so these bounds keep the query well inside Convex's
// per-transaction limits.
export const MAX_PUBLIC_YEAR_MOVIES = 250;
export const MAX_PUBLIC_YEAR_REVIEWS = 300;

export function validateReviewPageSize(numItems: number): void {
  if (
    !Number.isSafeInteger(numItems) ||
    numItems < 1 ||
    numItems > MAX_REVIEW_PAGE_SIZE
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Review page size must be an integer from 1 through ${String(MAX_REVIEW_PAGE_SIZE)}.`,
    );
  }
}
