import type { Doc } from "../_generated/dataModel.js";
import { adminQuery } from "../functions.js";
import { toCatalogMovie } from "../catalog/readModel.js";
import { hydrateEpisode } from "../episodes/readModel.js";
import { domainError } from "../lib/errors.js";
import {
  DASHBOARD_GUESS_EPISODE_COUNT,
  DASHBOARD_RECENT_SYLLABUS_SIZE,
  MAX_DASHBOARD_ASSIGNMENT_REVIEWS,
  MAX_DASHBOARD_ASSIGNMENTS,
  MAX_DASHBOARD_EPISODES,
  MAX_DASHBOARD_GUESSES,
  MAX_DASHBOARD_MOVIES,
  MAX_DASHBOARD_REVIEWS,
  MAX_DASHBOARD_USERS,
} from "./limits.js";
import { dashboardOverviewValidator } from "./validators.js";

function assertWithinLimit(
  rows: readonly unknown[],
  limit: number,
  collection: string,
): void {
  if (rows.length > limit) {
    domainError(
      "CONFLICT",
      `Admin dashboard ${collection} count exceeds its bounded read limit.`,
      { details: { collection, limit } },
    );
  }
}

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

function newestByDateThenNumber(
  episodes: Array<Doc<"episodes">>,
): Doc<"episodes"> | null {
  return (
    episodes.sort(
      (left, right) =>
        (right.date ?? "").localeCompare(left.date ?? "") ||
        right.number - left.number ||
        right._creationTime - left._creationTime,
    )[0] ?? null
  );
}

export const overview = adminQuery({
  args: {},
  returns: dashboardOverviewValidator,
  handler: async (ctx) => {
    const [
      episodes,
      users,
      movies,
      reviews,
      assignments,
      assignmentReviews,
      guesses,
      latestSyllabusEntries,
    ] = await Promise.all([
      ctx.db
        .query("episodes")
        .withIndex("by_number")
        .order("desc")
        .take(MAX_DASHBOARD_EPISODES + 1),
      ctx.db.query("users").take(MAX_DASHBOARD_USERS + 1),
      ctx.db.query("movies").take(MAX_DASHBOARD_MOVIES + 1),
      ctx.db.query("reviews").take(MAX_DASHBOARD_REVIEWS + 1),
      ctx.db.query("assignments").take(MAX_DASHBOARD_ASSIGNMENTS + 1),
      ctx.db
        .query("assignmentReviews")
        .take(MAX_DASHBOARD_ASSIGNMENT_REVIEWS + 1),
      ctx.db.query("guesses").take(MAX_DASHBOARD_GUESSES + 1),
      ctx.db
        .query("syllabusEntries")
        .withIndex("by_createdAt")
        .order("desc")
        .take(DASHBOARD_RECENT_SYLLABUS_SIZE),
    ]);
    for (const [rows, limit, collection] of [
      [episodes, MAX_DASHBOARD_EPISODES, "episodes"],
      [users, MAX_DASHBOARD_USERS, "users"],
      [movies, MAX_DASHBOARD_MOVIES, "movies"],
      [reviews, MAX_DASHBOARD_REVIEWS, "reviews"],
      [assignments, MAX_DASHBOARD_ASSIGNMENTS, "assignments"],
      [
        assignmentReviews,
        MAX_DASHBOARD_ASSIGNMENT_REVIEWS,
        "assignment reviews",
      ],
      [guesses, MAX_DASHBOARD_GUESSES, "guesses"],
    ] as const) {
      assertWithinLimit(rows, limit, collection);
    }

    // convex-query-audit: allow-filter filters an already hard-capped in-memory episode array
    const published = episodes.filter(
      (episode) => episode.status?.toLowerCase() === "published",
    );
    // convex-query-audit: allow-filter filters an already hard-capped in-memory episode array
    const upcoming = episodes.filter((episode) => {
      const status = episode.status?.toLowerCase();
      return status === "next" || status === "recording";
    });
    const latestEpisodeDocument = newestByDateThenNumber(published);
    const upcomingEpisodeDocument = newestByDateThenNumber(upcoming);

    const assignmentIdsByEpisode = new Map<string, Set<string>>();
    for (const assignment of assignments) {
      const ids =
        assignmentIdsByEpisode.get(assignment.episodeId) ?? new Set<string>();
      ids.add(assignment._id);
      assignmentIdsByEpisode.set(assignment.episodeId, ids);
    }
    const assignmentReviewIdsByAssignment = new Map<string, Set<string>>();
    for (const assignmentReview of assignmentReviews) {
      const ids =
        assignmentReviewIdsByAssignment.get(assignmentReview.assignmentId) ??
        new Set<string>();
      ids.add(assignmentReview._id);
      assignmentReviewIdsByAssignment.set(assignmentReview.assignmentId, ids);
    }
    const guessCountByAssignmentReview = new Map<string, number>();
    for (const guess of guesses) {
      guessCountByAssignmentReview.set(
        guess.assignmentReviewId,
        (guessCountByAssignmentReview.get(guess.assignmentReviewId) ?? 0) + 1,
      );
    }

    const guessStats = episodes
      // convex-query-audit: allow-filter filters an already hard-capped in-memory episode array
      .filter((episode) => episode.recording !== undefined)
      .slice(0, DASHBOARD_GUESS_EPISODE_COUNT)
      .map((episode) => {
        let guessCount = 0;
        for (const assignmentId of assignmentIdsByEpisode.get(episode._id) ??
          []) {
          for (const assignmentReviewId of assignmentReviewIdsByAssignment.get(
            assignmentId,
          ) ?? []) {
            guessCount +=
              guessCountByAssignmentReview.get(assignmentReviewId) ?? 0;
          }
        }
        return {
          id: episode._id,
          slug: nullable(episode.slug),
          name: `Ep ${String(episode.number)}`,
          fullTitle: `Episode ${String(episode.number)}: ${episode.title}`,
          guesses: guessCount,
        };
      })
      .reverse();

    const latestSyllabus = await Promise.all(
      latestSyllabusEntries.map(async (entry) => {
        const [user, movie] = await Promise.all([
          ctx.db.get("users", entry.userId),
          ctx.db.get("movies", entry.movieId),
        ]);
        if (user === null || movie === null) {
          domainError(
            "CONFLICT",
            "Admin dashboard found a broken recent syllabus relationship.",
            { details: { syllabusEntryId: entry._id } },
          );
        }
        return {
          id: entry._id,
          createdAt: entry.createdAt,
          user: {
            id: user._id,
            name: nullable(user.name),
          },
          movie: toCatalogMovie(movie),
        };
      }),
    );

    return {
      counts: {
        episodes: episodes.length,
        users: users.length,
        movies: movies.length,
        reviews: reviews.length,
      },
      latestEpisode:
        latestEpisodeDocument === null
          ? null
          : await hydrateEpisode(ctx, latestEpisodeDocument),
      upcomingEpisode:
        upcomingEpisodeDocument === null
          ? null
          : await hydrateEpisode(ctx, upcomingEpisodeDocument),
      latestSyllabus,
      guessStats,
    };
  },
});
