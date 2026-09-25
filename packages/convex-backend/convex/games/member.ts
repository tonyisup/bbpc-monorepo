import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import { authenticatedQuery } from "../functions.js";
import { domainError } from "../lib/errors.js";
import {
  assertGamblingReadLimit,
  calculateAvailablePointsForUser,
  hydrateGamblingEntries,
} from "./gamblingReadModel.js";
import {
  LATEST_POINT_CHANGE_WINDOW_MS,
  MAX_GAMBLING_ENTRIES_PER_READ,
  MAX_POINTS_FOR_LATEST_CHANGE,
  MAX_SEASONS_TO_INSPECT,
  PACIFIC_DAY_END_OFFSET_MS,
  validatePointPageSize,
} from "./limits.js";
import {
  findSeasonStanding,
  loadPointTypes,
  loadSeasonStanding,
  readMemberSeasonPoints,
  tryLoadSeasonPerformance,
  valueOf,
} from "./memberSeasonReadModel.js";
import {
  hydratePointCore,
  hydratePointMemberActivity,
  pointValue,
} from "./pointReadModel.js";
import { resolvePointSeason } from "./pointWriteModel.js";
import {
  countSeasonEpisodesThrough,
  findCurrentSeason,
  hydrateSeason,
} from "./readModel.js";
import {
  gamblingEntryValidator,
  latestPointChangeValidator,
  memberSeasonOverviewValidator,
  memberSeasonSummaryValidator,
  pointCoreValidator,
  pointMemberActivityValidator,
  pointSeasonTargetValidator,
  seasonStandingValidator,
} from "./validators.js";
import { requireSeason, validatePlainDate } from "./writeModel.js";

export const myPointsPage = authenticatedQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(pointCoreValidator),
  handler: async (ctx, args) => {
    validatePointPageSize(args.paginationOpts.numItems);
    const result = await ctx.db
      .query("points")
      .withIndex("by_userId_and_earnedAt", (index) =>
        index.eq("userId", ctx.actor.user._id),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map((point) => hydratePointCore(ctx, point)),
      ),
    };
  },
});

export const myAvailablePoints = authenticatedQuery({
  args: { season: pointSeasonTargetValidator },
  returns: v.number(),
  handler: async (ctx, args) => {
    const season =
      args.season.kind === "season"
        ? await resolvePointSeason(ctx, args.season)
        : await findCurrentSeason(
            ctx,
            validatePlainDate(
              args.season.today,
              "Current season date",
            ),
          );
    if (season === null) {
      return 0;
    }
    return await calculateAvailablePointsForUser(
      ctx,
      ctx.actor.user._id,
      season._id,
    );
  },
});

/**
 * Returns the member's points near the current season's latest point. Clients
 * treat the latest point's Pacific day as the last episode and sum this
 * member's points from that day. Resolving each point's episode would cost
 * several reads per point on a query every signed-in page subscribes to, and
 * manual adjustments have no episode anyway.
 */
export const myLatestPointChange = authenticatedQuery({
  args: { today: v.string() },
  returns: v.union(latestPointChangeValidator, v.null()),
  handler: async (ctx, args) => {
    const today = validatePlainDate(args.today, "Current season date");
    const season = await findCurrentSeason(ctx, today);
    if (season === null) {
      return null;
    }
    // A point dated after today (for example, a typo in its date) must not
    // pin every member's last episode to that future day.
    const endOfToday =
      Date.parse(`${today}T00:00:00Z`) + PACIFIC_DAY_END_OFFSET_MS;
    const latest = await ctx.db
      .query("points")
      .withIndex("by_seasonId_and_earnedAt", (index) =>
        index.eq("seasonId", season._id).lt("earnedAt", endOfToday),
      )
      .order("desc")
      .first();
    if (latest === null) {
      return null;
    }
    const points = await ctx.db
      .query("points")
      .withIndex("by_userId_and_seasonId_and_earnedAt", (index) =>
        index
          .eq("userId", ctx.actor.user._id)
          .eq("seasonId", season._id)
          .gt("earnedAt", latest.earnedAt - LATEST_POINT_CHANGE_WINDOW_MS)
          .lte("earnedAt", latest.earnedAt),
      )
      .take(MAX_POINTS_FOR_LATEST_CHANGE + 1);
    if (points.length > MAX_POINTS_FOR_LATEST_CHANGE) {
      domainError(
        "CONFLICT",
        "Latest point change exceeds the supported point limit.",
        { details: { limit: MAX_POINTS_FOR_LATEST_CHANGE } },
      );
    }
    const pointTypeIds = new Set<Id<"gamePointTypes">>();
    for (const point of points) {
      if (point.gamePointTypeId !== undefined) {
        pointTypeIds.add(point.gamePointTypeId);
      }
    }
    const pointTypes = new Map<
      Id<"gamePointTypes">,
      Doc<"gamePointTypes"> | null
    >(
      await Promise.all(
        [...pointTypeIds].map(
          async (id) => [id, await ctx.db.get("gamePointTypes", id)] as const,
        ),
      ),
    );
    return {
      seasonId: season._id,
      lastScoredAt: latest.earnedAt,
      points: points.map((point) => ({
        earnedAt: point.earnedAt,
        pointValue: pointValue(
          point,
          point.gamePointTypeId === undefined
            ? null
            : (pointTypes.get(point.gamePointTypeId) ?? null),
        ),
      })),
    };
  },
});

interface SeasonOrder {
  isCurrent: boolean;
  season: { startedOn: string | null; title: string };
}

/** Current season first, then newest start date, undated seasons last. */
function compareSeasons(left: SeasonOrder, right: SeasonOrder): number {
  if (left.isCurrent !== right.isCurrent) {
    return left.isCurrent ? -1 : 1;
  }
  if (left.season.startedOn !== right.season.startedOn) {
    if (left.season.startedOn === null) {
      return 1;
    }
    if (right.season.startedOn === null) {
      return -1;
    }
    return right.season.startedOn.localeCompare(left.season.startedOn);
  }
  return left.season.title.localeCompare(right.season.title);
}

/**
 * The seasons the member has scored in, plus the current season even before
 * their first point. Newest first, current season at the top. Each season is
 * its own bounded read, so a long playing history never hits one ceiling.
 * Standing, available points, and episode progress are resolved for the
 * current season only; the season page resolves them for any one season, and
 * a season too large to rank simply has no standing.
 */
export const mySeasons = authenticatedQuery({
  args: { today: v.string() },
  returns: v.array(memberSeasonSummaryValidator),
  handler: async (ctx, args) => {
    const today = validatePlainDate(args.today, "Current season date");
    const userId = ctx.actor.user._id;
    const [current, seasons] = await Promise.all([
      findCurrentSeason(ctx, today),
      ctx.db
        .query("seasons")
        .withIndex("by_startedOn")
        .order("desc")
        .take(MAX_SEASONS_TO_INSPECT + 1),
    ]);
    if (seasons.length > MAX_SEASONS_TO_INSPECT) {
      domainError(
        "CONFLICT",
        "Season list exceeds its bounded inspection limit.",
        { details: { limit: MAX_SEASONS_TO_INSPECT } },
      );
    }
    const played = (
      await Promise.all(
        seasons.map(async (season) => ({
          season,
          isCurrent: current !== null && current._id === season._id,
          seasonPoints: await readMemberSeasonPoints(ctx, userId, season._id),
        })),
      )
    ).filter((entry) => entry.isCurrent || entry.seasonPoints.length > 0);
    // Point types are global, so read them once for every season's points.
    const pointTypes = await loadPointTypes(
      ctx,
      played.flatMap((entry) => entry.seasonPoints),
    );
    const summaries = await Promise.all(
      played.map(async ({ season, isCurrent, seasonPoints }) => {
        let total = 0;
        for (const point of seasonPoints) {
          total += valueOf(point, pointTypes);
        }
        const [hydrated, available, recordedEpisodeCount, standing] =
          await Promise.all([
            hydrateSeason(ctx, season),
            isCurrent
              ? calculateAvailablePointsForUser(ctx, userId, season._id)
              : null,
            isCurrent ? countSeasonEpisodesThrough(ctx, season, today) : null,
            isCurrent ? loadSeasonStanding(ctx, season._id, userId) : null,
          ]);
        return {
          season: hydrated,
          isCurrent,
          total,
          pointCount: seasonPoints.length,
          available,
          recordedEpisodeCount,
          standing,
        };
      }),
    );
    return summaries.sort(compareSeasons);
  },
});

/**
 * Everything the member's season page header and chart need for one season:
 * their totals and standing, plus every player's season points, the same
 * shape the public standings use.
 */
export const mySeasonOverview = authenticatedQuery({
  args: { seasonId: v.id("seasons"), today: v.string() },
  returns: memberSeasonOverviewValidator,
  handler: async (ctx, args) => {
    const today = validatePlainDate(args.today, "Current season date");
    const season = await requireSeason(ctx, args.seasonId);
    const userId = ctx.actor.user._id;
    const [
      current,
      seasonPoints,
      performance,
      available,
      recordedEpisodeCount,
      hydrated,
    ] = await Promise.all([
      findCurrentSeason(ctx, today),
      readMemberSeasonPoints(ctx, userId, season._id),
      // A season too large to total still shows the member's own numbers;
      // only the standing and the chart go blank.
      tryLoadSeasonPerformance(ctx, season._id),
      calculateAvailablePointsForUser(ctx, userId, season._id),
      countSeasonEpisodesThrough(ctx, season, today),
      hydrateSeason(ctx, season),
    ]);
    const pointTypes = await loadPointTypes(ctx, seasonPoints);
    let total = 0;
    for (const point of seasonPoints) {
      total += valueOf(point, pointTypes);
    }
    return {
      season: hydrated,
      isCurrent: current !== null && current._id === season._id,
      total,
      pointCount: seasonPoints.length,
      available,
      recordedEpisodeCount,
      standing:
        performance === null
          ? null
          : findSeasonStanding(performance.userSummary, userId),
      rankingAvailable: performance !== null,
      userSummary: performance?.userSummary ?? [],
      points: performance?.points ?? [],
    };
  },
});

/**
 * The member's points in one season, newest first, each with the assignment
 * and episode it was earned for so the page can group by episode.
 */
export const mySeasonPointsPage = authenticatedQuery({
  args: {
    seasonId: v.id("seasons"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(pointMemberActivityValidator),
  handler: async (ctx, args) => {
    validatePointPageSize(args.paginationOpts.numItems);
    await requireSeason(ctx, args.seasonId);
    const result = await ctx.db
      .query("points")
      .withIndex("by_userId_and_seasonId_and_earnedAt", (index) =>
        index.eq("userId", ctx.actor.user._id).eq("seasonId", args.seasonId),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map((point) => hydratePointMemberActivity(ctx, point)),
      ),
    };
  },
});

/**
 * The member's standing in any one season. The profile asks this for each
 * past season separately, since every answer is its own season-wide read.
 */
export const mySeasonStanding = authenticatedQuery({
  args: { seasonId: v.id("seasons") },
  returns: v.union(seasonStandingValidator, v.null()),
  handler: async (ctx, args) => {
    await requireSeason(ctx, args.seasonId);
    return await loadSeasonStanding(ctx, args.seasonId, ctx.actor.user._id);
  },
});

/** The member's wagers in one season, newest first. */
export const mySeasonWagers = authenticatedQuery({
  args: { seasonId: v.id("seasons") },
  returns: v.array(gamblingEntryValidator),
  handler: async (ctx, args) => {
    await requireSeason(ctx, args.seasonId);
    const entries = await ctx.db
      .query("gamblingEntries")
      .withIndex("by_userId_and_seasonId_and_createdAt", (index) =>
        index.eq("userId", ctx.actor.user._id).eq("seasonId", args.seasonId),
      )
      .order("desc")
      .take(MAX_GAMBLING_ENTRIES_PER_READ + 1);
    assertGamblingReadLimit(entries, "Season wagers");
    return await hydrateGamblingEntries(ctx, entries);
  },
});
