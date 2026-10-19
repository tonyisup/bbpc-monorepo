import type { Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import {
  MAX_ASSIGNMENTS_PER_TIMELINE_EPISODE,
  MAX_POINT_LINKS_PER_TIMELINE_ASSIGNMENT,
  MAX_QUOTE_SUBMISSIONS_PER_SEASON,
  MAX_SEASON_PERFORMANCE_ACTIVITY,
  MAX_SEASON_TIMELINE_EPISODES,
} from "./limits.js";
import { pointValue } from "./pointReadModel.js";
import type { seasonAdminTimelineEpisodeValidator } from "./validators.js";

type TimelineReadContext = Pick<QueryCtx, "db">;
type TimelineEpisode = Infer<typeof seasonAdminTimelineEpisodeValidator>;

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

function assertWithin(
  rows: unknown[],
  limit: number,
  label: string,
): void {
  if (rows.length > limit) {
    domainError(
      "CONFLICT",
      `Season timeline ${label} exceed the supported limit.`,
      { details: { relationship: label, limit } },
    );
  }
}

/**
 * Episodes are not linked to seasons, so the timeline shows the dated
 * episodes from the season's start through `today` (or its end date), newest
 * first. Each one sums the season's activity that resolves to it, the same
 * way the points feed labels a point: through an assignment link, a guess, a
 * wager, or a quote, in that order of precedence.
 */
export async function loadSeasonEpisodeTimeline(
  ctx: TimelineReadContext,
  season: Doc<"seasons">,
  today: string,
): Promise<TimelineEpisode[]> {
  const { startedOn, endedOn } = season;
  if (startedOn === undefined) {
    return [];
  }
  const through = endedOn !== undefined && endedOn < today ? endedOn : today;
  if (through < startedOn) {
    return [];
  }
  const episodes = await ctx.db
    .query("episodes")
    .withIndex("by_date_and_status", (index) =>
      index.gte("date", startedOn).lte("date", through),
    )
    .take(MAX_SEASON_TIMELINE_EPISODES + 1);
  assertWithin(episodes, MAX_SEASON_TIMELINE_EPISODES, "episodes");
  if (episodes.length === 0) {
    return [];
  }

  const [points, guesses, wagers, quotes, episodeAssignments] =
    await Promise.all([
      ctx.db
        .query("points")
        .withIndex("by_seasonId", (index) =>
          index.eq("seasonId", season._id),
        )
        .take(MAX_SEASON_PERFORMANCE_ACTIVITY + 1),
      ctx.db
        .query("guesses")
        .withIndex("by_seasonId", (index) =>
          index.eq("seasonId", season._id),
        )
        .take(MAX_SEASON_PERFORMANCE_ACTIVITY + 1),
      ctx.db
        .query("gamblingEntries")
        .withIndex("by_seasonId", (index) =>
          index.eq("seasonId", season._id),
        )
        .take(MAX_SEASON_PERFORMANCE_ACTIVITY + 1),
      ctx.db
        .query("quoteSubmissions")
        .withIndex("by_seasonId", (index) =>
          index.eq("seasonId", season._id),
        )
        .take(MAX_QUOTE_SUBMISSIONS_PER_SEASON + 1),
      Promise.all(
        episodes.map((episode) =>
          ctx.db
            .query("assignments")
            .withIndex("by_episodeId", (index) =>
              index.eq("episodeId", episode._id),
            )
            .take(MAX_ASSIGNMENTS_PER_TIMELINE_EPISODE + 1),
        ),
      ),
    ]);
  assertWithin(points, MAX_SEASON_PERFORMANCE_ACTIVITY, "points");
  assertWithin(guesses, MAX_SEASON_PERFORMANCE_ACTIVITY, "guesses");
  assertWithin(wagers, MAX_SEASON_PERFORMANCE_ACTIVITY, "gambling entries");
  assertWithin(quotes, MAX_QUOTE_SUBMISSIONS_PER_SEASON, "quote submissions");

  const episodeIds = new Set<Id<"episodes">>(
    episodes.map((episode) => episode._id),
  );
  // Every assignment of a timeline episode is here, so an assignment missing
  // from this map belongs to an episode outside the timeline.
  const assignmentEpisodes = new Map<Id<"assignments">, Id<"episodes">>();
  for (const assignments of episodeAssignments) {
    assertWithin(
      assignments,
      MAX_ASSIGNMENTS_PER_TIMELINE_EPISODE,
      "episode assignments",
    );
    for (const assignment of assignments) {
      assignmentEpisodes.set(assignment._id, assignment.episodeId);
    }
  }

  const reviewIds = new Set<Id<"assignmentReviews">>(
    guesses.map((guess) => guess.assignmentReviewId),
  );
  const [reviews, assignmentLinks] = await Promise.all([
    Promise.all(
      [...reviewIds].map((reviewId) =>
        ctx.db.get("assignmentReviews", reviewId),
      ),
    ),
    Promise.all(
      [...assignmentEpisodes.keys()].map((assignmentId) =>
        ctx.db
          .query("assignmentPointLinks")
          .withIndex("by_assignmentId", (index) =>
            index.eq("assignmentId", assignmentId),
          )
          .take(MAX_POINT_LINKS_PER_TIMELINE_ASSIGNMENT + 1),
      ),
    ),
  ]);
  const reviewEpisodes = new Map<Id<"assignmentReviews">, Id<"episodes">>();
  for (const review of reviews) {
    const episodeId =
      review === null ? undefined : assignmentEpisodes.get(review.assignmentId);
    if (review !== null && episodeId !== undefined) {
      reviewEpisodes.set(review._id, episodeId);
    }
  }
  const wagerEpisode = (wager: Doc<"gamblingEntries">) =>
    wager.assignmentId === undefined
      ? undefined
      : assignmentEpisodes.get(wager.assignmentId);

  // Lower-precedence sources go first so higher ones overwrite them.
  const pointEpisodes = new Map<Id<"points">, Id<"episodes">>();
  for (const quote of quotes) {
    if (quote.pointId !== undefined && episodeIds.has(quote.episodeId)) {
      pointEpisodes.set(quote.pointId, quote.episodeId);
    }
  }
  for (const wager of wagers) {
    const episodeId = wagerEpisode(wager);
    if (wager.awardPointId !== undefined && episodeId !== undefined) {
      pointEpisodes.set(wager.awardPointId, episodeId);
    }
  }
  for (const guess of guesses) {
    const episodeId = reviewEpisodes.get(guess.assignmentReviewId);
    if (guess.pointId !== undefined && episodeId !== undefined) {
      pointEpisodes.set(guess.pointId, episodeId);
    }
  }
  for (const links of assignmentLinks) {
    assertWithin(
      links,
      MAX_POINT_LINKS_PER_TIMELINE_ASSIGNMENT,
      "assignment point links",
    );
    for (const link of links) {
      const episodeId = assignmentEpisodes.get(link.assignmentId);
      if (episodeId !== undefined) {
        pointEpisodes.set(link.pointId, episodeId);
      }
    }
  }

  const summaries = new Map(
    episodes.map((episode) => [
      episode._id,
      {
        points: { total: 0, count: 0 },
        guesses: { count: 0, scored: 0 },
        wagers: { count: 0, pointsWagered: 0, won: 0, lost: 0 },
        quotes: { count: 0 },
        players: new Map<Id<"users">, number>(),
      },
    ]),
  );
  const userIds = new Set<Id<"users">>();
  const join = (episodeId: Id<"episodes">, userId: Id<"users">) => {
    const summary = summaries.get(episodeId);
    if (summary === undefined) {
      return undefined;
    }
    userIds.add(userId);
    summary.players.set(userId, summary.players.get(userId) ?? 0);
    return summary;
  };

  const scoredPoints = points.filter((point) =>
    pointEpisodes.has(point._id),
  );
  const pointTypeIds = new Set<Id<"gamePointTypes">>();
  for (const point of scoredPoints) {
    if (point.gamePointTypeId !== undefined) {
      pointTypeIds.add(point.gamePointTypeId);
    }
  }
  const pointTypes = new Map<Id<"gamePointTypes">, Doc<"gamePointTypes">>();
  await Promise.all(
    [...pointTypeIds].map(async (pointTypeId) => {
      const pointType = await ctx.db.get("gamePointTypes", pointTypeId);
      if (pointType === null) {
        domainError(
          "CONFLICT",
          "Season point has a missing point type relationship.",
          { details: { gamePointTypeId: pointTypeId } },
        );
      }
      pointTypes.set(pointTypeId, pointType);
    }),
  );

  for (const point of scoredPoints) {
    const episodeId = pointEpisodes.get(point._id);
    const summary =
      episodeId === undefined ? undefined : join(episodeId, point.userId);
    if (summary === undefined) {
      continue;
    }
    const value = pointValue(
      point,
      point.gamePointTypeId === undefined
        ? null
        : (pointTypes.get(point.gamePointTypeId) ?? null),
    );
    summary.points.total += value;
    summary.points.count += 1;
    summary.players.set(
      point.userId,
      (summary.players.get(point.userId) ?? 0) + value,
    );
  }
  for (const guess of guesses) {
    const episodeId = reviewEpisodes.get(guess.assignmentReviewId);
    const summary =
      episodeId === undefined ? undefined : join(episodeId, guess.userId);
    if (summary !== undefined) {
      summary.guesses.count += 1;
      if (guess.pointId !== undefined) {
        summary.guesses.scored += 1;
      }
    }
  }
  for (const wager of wagers) {
    const episodeId = wagerEpisode(wager);
    const summary =
      episodeId === undefined ? undefined : join(episodeId, wager.userId);
    if (summary === undefined) {
      continue;
    }
    summary.wagers.count += 1;
    if (wager.status !== "rejected") {
      summary.wagers.pointsWagered += wager.points;
    }
    if (wager.status === "won") {
      summary.wagers.won += 1;
    } else if (wager.status === "lost") {
      summary.wagers.lost += 1;
    }
  }
  for (const quote of quotes) {
    const summary = join(quote.episodeId, quote.userId);
    if (summary !== undefined) {
      summary.quotes.count += 1;
    }
  }

  const users = new Map<Id<"users">, Doc<"users">>();
  await Promise.all(
    [...userIds].map(async (userId) => {
      const user = await ctx.db.get("users", userId);
      if (user === null) {
        domainError(
          "CONFLICT",
          "Season activity has a missing user relationship.",
          { details: { userId } },
        );
      }
      users.set(userId, user);
    }),
  );

  return episodes
    .map((episode): TimelineEpisode => {
      const summary = summaries.get(episode._id);
      if (summary === undefined) {
        domainError("CONFLICT", "Season timeline lost an episode summary.");
      }
      const players = [...summary.players]
        .map(([userId, total]) => {
          const user = users.get(userId);
          if (user === undefined) {
            domainError(
              "CONFLICT",
              "Season timeline has a missing user.",
              { details: { userId } },
            );
          }
          return {
            user: {
              id: user._id,
              name: nullable(user.name),
              image: nullable(user.image),
            },
            total,
          };
        })
        .sort(
          (left, right) =>
            right.total - left.total ||
            (left.user.name ?? "").localeCompare(right.user.name ?? ""),
        );
      return {
        episode: {
          id: episode._id,
          number: episode.number,
          title: episode.title,
          // The date range above only matches dated episodes.
          date: episode.date ?? through,
          status: nullable(episode.status),
          slug: nullable(episode.slug),
        },
        points: summary.points,
        guesses: summary.guesses,
        wagers: summary.wagers,
        quotes: summary.quotes,
        players,
      };
    })
    .sort(
      (left, right) =>
        right.episode.date.localeCompare(left.episode.date) ||
        right.episode.number - left.episode.number,
    );
}
