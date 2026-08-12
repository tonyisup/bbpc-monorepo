import { domainError } from "../lib/errors.js";

export const MAX_REVIEW_RELATIONSHIPS = 50;
export const MAX_GUESSES_PER_REVIEW_DELETE = 200;
export const MAX_REVIEW_PAGE_SIZE = 100;
export const MAX_PUBLIC_YEAR_REVIEWS = 100;

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
