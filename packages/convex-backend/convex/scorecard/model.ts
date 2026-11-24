import type { Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import { toCatalogMovie } from "../catalog/readModel.js";
import { domainError } from "../lib/errors.js";
import {
  entryAverage,
  isComplete,
  rankEntries,
  type LeaderboardPlacement,
  type ScorecardScores,
} from "./leaderboard.js";
import {
  MAX_SCORECARD_ENTRIES_PER_YEAR,
  SCORECARD_CRITERIA,
  validateScorecardMovieYear,
} from "./limits.js";
import type { scorecardEntryValidator } from "./validators.js";

type ScorecardReadContext = Pick<QueryCtx, "db">;
type ScorecardWriteContext = Pick<MutationCtx, "db">;

export type ScorecardEntry = Infer<typeof scorecardEntryValidator>;

export interface ScorecardYearRow {
  doc: Doc<"scorecardEntries">;
  movie: Doc<"movies">;
}

/** The 9 criterion fields of a stored entry, as one object. */
export function scoresOf(doc: Doc<"scorecardEntries">): ScorecardScores {
  const scores: ScorecardScores = {};
  for (const criterion of SCORECARD_CRITERIA) {
    const value = doc[criterion];
    if (value !== undefined) {
      scores[criterion] = value;
    }
  }
  return scores;
}

interface LeaderboardRow {
  id: string;
  title: string;
  scores: ScorecardScores;
  unseen: boolean;
  tieOrder?: number;
  row: ScorecardYearRow;
}

export interface ScorecardYearView {
  rows: ScorecardYearRow[];
  placements: Array<LeaderboardPlacement<LeaderboardRow>>;
}

export async function findScorecardEntry(
  ctx: ScorecardReadContext,
  userId: Id<"users">,
  year: number,
  movieId: Id<"movies">,
): Promise<Doc<"scorecardEntries"> | null> {
  return await ctx.db
    .query("scorecardEntries")
    .withIndex("by_userId_and_year_and_movieId", (index) =>
      index.eq("userId", userId).eq("year", year).eq("movieId", movieId),
    )
    .unique();
}

async function listYearDocuments(
  ctx: ScorecardReadContext,
  userId: Id<"users">,
  year: number,
): Promise<Array<Doc<"scorecardEntries">>> {
  const entries = await ctx.db
    .query("scorecardEntries")
    .withIndex("by_userId_and_year", (index) =>
      index.eq("userId", userId).eq("year", year),
    )
    .take(MAX_SCORECARD_ENTRIES_PER_YEAR + 1);
  if (entries.length > MAX_SCORECARD_ENTRIES_PER_YEAR) {
    domainError(
      "CONFLICT",
      "This scorecard year exceeds the supported entry limit.",
      { details: { limit: MAX_SCORECARD_ENTRIES_PER_YEAR } },
    );
  }
  return entries;
}

export async function loadScorecardYear(
  ctx: ScorecardReadContext,
  userId: Id<"users">,
  year: number,
): Promise<ScorecardYearView> {
  const documents = await listYearDocuments(ctx, userId, year);
  const rows = await Promise.all(
    documents.map(async (doc) => {
      const movie = await ctx.db.get("movies", doc.movieId);
      if (movie === null) {
        domainError(
          "CONFLICT",
          "Scorecard read model found a missing movie relationship.",
        );
      }
      return { doc, movie };
    }),
  );
  const placements = rankEntries(
    rows.map(
      (row): LeaderboardRow => ({
        id: row.doc._id,
        title: row.movie.title,
        scores: scoresOf(row.doc),
        unseen: row.doc.unseen,
        ...(row.doc.tieOrder === undefined
          ? {}
          : { tieOrder: row.doc.tieOrder }),
        row,
      }),
    ),
  );
  return { rows, placements };
}

async function findMyRating(
  ctx: ScorecardReadContext,
  userId: Id<"users">,
  movieId: Id<"movies">,
): Promise<ScorecardEntry["myRating"]> {
  const review = await ctx.db
    .query("reviews")
    .withIndex("by_userId_and_movieId", (index) =>
      index.eq("userId", userId).eq("movieId", movieId),
    )
    .order("desc")
    .first();
  if (review?.ratingId === undefined) {
    return null;
  }
  const rating = await ctx.db.get("ratings", review.ratingId);
  if (rating === null) {
    return null;
  }
  return { name: rating.name, value: rating.value, icon: rating.icon ?? null };
}

export async function hydrateScorecardRow(
  ctx: ScorecardReadContext,
  view: ScorecardYearView,
  row: ScorecardYearRow,
): Promise<ScorecardEntry> {
  const placement = view.placements.find(
    (candidate) => candidate.entry.id === row.doc._id,
  );
  const scores = scoresOf(row.doc);
  return {
    id: row.doc._id,
    year: row.doc.year,
    movie: toCatalogMovie(row.movie),
    scores,
    unseen: row.doc.unseen,
    complete: isComplete(scores),
    average: entryAverage(scores),
    position: placement?.position ?? null,
    tied: placement?.tied ?? false,
    myRating: await findMyRating(ctx, row.doc.userId, row.doc.movieId),
    createdAt: row.doc.createdAt,
    updatedAt: row.doc.updatedAt,
  };
}

/** Reloads the year (positions can move) and hydrates one entry. */
export async function hydrateScorecardEntry(
  ctx: ScorecardReadContext,
  userId: Id<"users">,
  year: number,
  entryId: Id<"scorecardEntries">,
): Promise<ScorecardEntry> {
  const view = await loadScorecardYear(ctx, userId, year);
  const row = view.rows.find((candidate) => candidate.doc._id === entryId);
  if (row === undefined) {
    domainError("NOT_FOUND", "The scorecard entry is unavailable.");
  }
  return await hydrateScorecardRow(ctx, view, row);
}

/**
 * The one path that creates entries. Idempotent per (user, year, movie);
 * enforces the movie-year window and the per-year capacity.
 */
export async function createEntryIfMissing(
  ctx: ScorecardWriteContext,
  input: {
    userId: Id<"users">;
    year: number;
    movieId: Id<"movies">;
    now: number;
  },
): Promise<Doc<"scorecardEntries">> {
  const existing = await findScorecardEntry(
    ctx,
    input.userId,
    input.year,
    input.movieId,
  );
  if (existing !== null) {
    return existing;
  }
  const movie = await ctx.db.get("movies", input.movieId);
  if (movie === null) {
    domainError("NOT_FOUND", "The movie is unavailable.");
  }
  validateScorecardMovieYear(input.year, movie.year);
  const current = await listYearDocuments(ctx, input.userId, input.year);
  if (current.length >= MAX_SCORECARD_ENTRIES_PER_YEAR) {
    domainError(
      "CONFLICT",
      "This scorecard year is full.",
      { details: { limit: MAX_SCORECARD_ENTRIES_PER_YEAR } },
    );
  }
  const id = await ctx.db.insert("scorecardEntries", {
    userId: input.userId,
    year: input.year,
    movieId: input.movieId,
    unseen: false,
    createdAt: input.now,
    updatedAt: input.now,
  });
  const created = await ctx.db.get("scorecardEntries", id);
  if (created === null) {
    domainError("INTERNAL_ERROR", "The scorecard entry was not created.");
  }
  return created;
}
