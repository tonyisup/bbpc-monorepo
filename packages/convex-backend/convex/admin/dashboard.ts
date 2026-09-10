import type { Doc } from "../_generated/dataModel.js";
import { adminQuery } from "../functions.js";
import { toCatalogMovie } from "../catalog/readModel.js";
import { hydrateEpisode } from "../episodes/readModel.js";
import { domainError } from "../lib/errors.js";
import {
  DASHBOARD_GUESS_EPISODE_COUNT,
  DASHBOARD_RECENT_SYLLABUS_SIZE,
} from "./limits.js";
import {
  MAX_ASSIGNMENTS_PER_EPISODE,
  MAX_ASSIGNMENT_WORKBENCH_REVIEWS,
} from "../assignments/limits.js";
import {
  dashboardCount,
  dashboardSources,
} from "../lib/dashboardProjection.js";
import { dashboardOverviewValidator } from "./validators.js";

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
    const states = await Promise.all(
      dashboardSources.map((source) =>
        ctx.db
          .query("dashboardBackfills")
          .withIndex("by_source", (q) => q.eq("source", source))
          .unique(),
      ),
    );
    const countsReady = states.every((state) => state?.complete === true);
    const [statusEpisodes, recent, latestSyllabusEntries] = await Promise.all([
      Promise.all(
        ["published", "next", "recording"].map((status) =>
          ctx.db
            .query("dashboardEpisodes")
            .withIndex("by_status_and_date_and_number_and_createdAt", (q) =>
              q.eq("status", status),
            )
            .order("desc")
            .first(),
        ),
      ),
      ctx.db
        .query("dashboardEpisodes")
        .withIndex("by_hasRecording_and_number", (q) =>
          q.eq("hasRecording", true),
        )
        .order("desc")
        .take(DASHBOARD_GUESS_EPISODE_COUNT),
      ctx.db
        .query("syllabusEntries")
        .withIndex("by_createdAt")
        .order("desc")
        .take(DASHBOARD_RECENT_SYLLABUS_SIZE),
    ] as const);
    const [published, next, recording] = statusEpisodes;
    const latestEpisodeDocument = published
      ? await ctx.db.get("episodes", published.episodeId)
      : null;
    const upcomingDocuments = await Promise.all(
      [next, recording].map(async (row) =>
        row ? await ctx.db.get("episodes", row.episodeId) : null,
      ),
    );
    const upcomingEpisodeDocument = newestByDateThenNumber(
      upcomingDocuments.filter((row): row is Doc<"episodes"> => row !== null),
    );
    const guessStats = countsReady
      ? await Promise.all(
          recent.map(async (row) => {
            const episode = await ctx.db.get("episodes", row.episodeId);
            if (episode === null)
              domainError("CONFLICT", "Dashboard episode is missing.");
            const assignments = await ctx.db
              .query("assignments")
              .withIndex("by_episodeId", (q) => q.eq("episodeId", episode._id))
              .take(MAX_ASSIGNMENTS_PER_EPISODE + 1);
            if (assignments.length > MAX_ASSIGNMENTS_PER_EPISODE)
              domainError("CONFLICT", "Episode exceeds its assignment limit.");
            let guesses = 0;
            for (const assignment of assignments) {
              const reviews = await ctx.db
                .query("assignmentReviews")
                .withIndex("by_assignmentId", (q) =>
                  q.eq("assignmentId", assignment._id),
                )
                .take(MAX_ASSIGNMENT_WORKBENCH_REVIEWS + 1);
              if (reviews.length > MAX_ASSIGNMENT_WORKBENCH_REVIEWS)
                domainError("CONFLICT", "Assignment exceeds its review limit.");
              for (const review of reviews)
                guesses += await dashboardCount(ctx, `guesses:${review._id}`);
            }
            return {
              id: episode._id,
              slug: nullable(episode.slug),
              name: `Ep ${String(episode.number)}`,
              fullTitle: `Episode ${String(episode.number)}: ${episode.title}`,
              guesses,
            };
          }),
        )
      : [];
    guessStats.reverse();

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
      countsReady,
      counts: countsReady
        ? {
            episodes: await dashboardCount(ctx, "episodes"),
            users: await dashboardCount(ctx, "users"),
            movies: await dashboardCount(ctx, "movies"),
            reviews: await dashboardCount(ctx, "reviews"),
          }
        : null,
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
