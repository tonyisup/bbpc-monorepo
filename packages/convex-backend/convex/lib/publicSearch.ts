import { domainError } from "./errors.js";

export const MAX_PUBLIC_SEARCH_RESULTS = 20;

export function requirePublicSearchLimit(limit: number): number {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_PUBLIC_SEARCH_RESULTS
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Search limit must be an integer from 1 through ${String(MAX_PUBLIC_SEARCH_RESULTS)}.`,
    );
  }
  return limit;
}

export function preparePublicSearchQuery(
  query: string,
): string | null {
  const prepared = query.trim().normalize("NFKC");
  return prepared.length === 0 ? null : prepared;
}
