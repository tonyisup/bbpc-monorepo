import { domainError } from "../lib/errors.js";

export function parseMovieYearSearchQuery(
  normalizedQuery: string,
): { query: string | null; year: number | null } {
  const yearFilters = [
    ...normalizedQuery.matchAll(/(?:^|\s)y:(\d{4})(?=\s|$)/giu),
  ].map((match) => Number(match[1]));
  const distinctYears = new Set(yearFilters);
  if (
    yearFilters.some((year) => year < 1_000 || year > 9_999) ||
    distinctYears.size > 1
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Movie year filters must specify one year from 1000 through 9999.",
    );
  }
  const query = normalizedQuery
    .replace(/(?:^|\s)y:\d{4}(?=\s|$)/giu, " ")
    .trim()
    .replace(/\s+/gu, " ");
  return {
    query: query.length === 0 ? null : query,
    year: yearFilters[0] ?? null,
  };
}
