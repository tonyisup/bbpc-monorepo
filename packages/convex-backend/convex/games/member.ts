import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import { authenticatedQuery } from "../functions.js";
import { domainError } from "../lib/errors.js";
import { calculateAvailablePointsForUser } from "./gamblingReadModel.js";
import {
  LATEST_POINT_CHANGE_WINDOW_MS,
  MAX_POINTS_FOR_LATEST_CHANGE,
  validatePointPageSize,
} from "./limits.js";
import { hydratePointCore, pointValue } from "./pointReadModel.js";
import { resolvePointSeason } from "./pointWriteModel.js";
import { findCurrentSeason } from "./readModel.js";
import {
  latestPointChangeValidator,
  pointCoreValidator,
  pointSeasonTargetValidator,
} from "./validators.js";
import { validatePlainDate } from "./writeModel.js";

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
    const season = await findCurrentSeason(
      ctx,
      validatePlainDate(args.today, "Current season date"),
    );
    if (season === null) {
      return null;
    }
    const latest = await ctx.db
      .query("points")
      .withIndex("by_seasonId_and_earnedAt", (index) =>
        index.eq("seasonId", season._id),
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
