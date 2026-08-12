import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import { normalizeLookupKey } from "../lib/normalize.js";

const MAX_CATALOG_TITLE_LENGTH = 1000;
const MAX_CATALOG_URL_LENGTH = 2048;
const MIN_SQL_SMALLINT = -32_768;
const MAX_SQL_SMALLINT = 32_767;
const MAX_SQL_INT = 2_147_483_647;

function validateHttpUrl(
  rawValue: string,
  label: string,
  allowBlank: boolean,
): string {
  const value = rawValue.trim();
  if (
    value.length > MAX_CATALOG_URL_LENGTH ||
    (!allowBlank && value.length === 0)
  ) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must contain ${allowBlank ? "0" : "1"} through ${String(MAX_CATALOG_URL_LENGTH)} characters.`,
    );
  }
  if (value.length === 0) {
    return value;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    domainError(
      "VALIDATION_FAILED",
      `${label} must be a valid HTTP or HTTPS URL.`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    domainError(
      "VALIDATION_FAILED",
      `${label} must be a valid HTTP or HTTPS URL.`,
    );
  }
  return value;
}

export function validateCatalogTitle(rawTitle: string): {
  title: string;
  normalizedTitle: string;
} {
  const title = rawTitle.trim().normalize("NFKC");
  if (
    title.length < 1 ||
    title.length > MAX_CATALOG_TITLE_LENGTH
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Catalog title must contain 1 through ${String(MAX_CATALOG_TITLE_LENGTH)} characters.`,
    );
  }
  return {
    title,
    normalizedTitle: normalizeLookupKey(title, "Catalog title"),
  };
}

export function validateCatalogYear(year: number): number {
  if (
    !Number.isSafeInteger(year) ||
    year < MIN_SQL_SMALLINT ||
    year > MAX_SQL_SMALLINT
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Catalog year must be an integer in the SQL SMALLINT range.",
    );
  }
  return year;
}

export function validateCatalogUrl(url: string): string {
  return validateHttpUrl(url, "Catalog URL", false);
}

export function validateCatalogPoster(poster: string): string {
  return validateHttpUrl(poster, "Catalog poster", true);
}

export function validateTmdbId(
  tmdbId: number | undefined,
): number | undefined {
  if (tmdbId === undefined) {
    return undefined;
  }
  if (
    !Number.isSafeInteger(tmdbId) ||
    tmdbId < 1 ||
    tmdbId > MAX_SQL_INT
  ) {
    domainError(
      "VALIDATION_FAILED",
      "TMDB ID must be a positive integer in the SQL INT range.",
    );
  }
  return tmdbId;
}

export async function requireMovie(
  ctx: MutationCtx,
  id: Id<"movies">,
): Promise<Doc<"movies">> {
  const movie = await ctx.db.get("movies", id);
  if (movie === null) {
    domainError("NOT_FOUND", "The movie is unavailable.");
  }
  return movie;
}

export async function requireShow(
  ctx: MutationCtx,
  id: Id<"shows">,
): Promise<Doc<"shows">> {
  const show = await ctx.db.get("shows", id);
  if (show === null) {
    domainError("NOT_FOUND", "The show is unavailable.");
  }
  return show;
}

export async function assertMovieUnreferenced(
  ctx: MutationCtx,
  movieId: Id<"movies">,
): Promise<void> {
  const references = await Promise.all([
    ctx.db
      .query("assignments")
      .withIndex("by_movieId", (index) =>
        index.eq("movieId", movieId),
      )
      .first(),
    ctx.db
      .query("syllabusEntries")
      .withIndex("by_movieId", (index) =>
        index.eq("movieId", movieId),
      )
      .first(),
    ctx.db
      .query("reviews")
      .withIndex("by_movieId", (index) =>
        index.eq("movieId", movieId),
      )
      .first(),
    ctx.db
      .query("rankedItems")
      .withIndex("by_movieId", (index) =>
        index.eq("movieId", movieId),
      )
      .first(),
  ]);
  const relationship = [
    "assignment",
    "syllabus entry",
    "review",
    "ranked item",
  ].find((_, index) => references[index] !== null);
  if (relationship !== undefined) {
    domainError(
      "CONFLICT",
      "The movie cannot be deleted while it is referenced.",
      { details: { relationship } },
    );
  }
}

export async function assertShowUnreferenced(
  ctx: MutationCtx,
  showId: Id<"shows">,
): Promise<void> {
  const [review, rankedItem] = await Promise.all([
    ctx.db
      .query("reviews")
      .withIndex("by_showId", (index) =>
        index.eq("showId", showId),
      )
      .first(),
    ctx.db
      .query("rankedItems")
      .withIndex("by_showId", (index) =>
        index.eq("showId", showId),
      )
      .first(),
  ]);
  const relationship =
    review !== null
      ? "review"
      : rankedItem !== null
        ? "ranked item"
        : undefined;
  if (relationship !== undefined) {
    domainError(
      "CONFLICT",
      "The show cannot be deleted while it is referenced.",
      { details: { relationship } },
    );
  }
}
