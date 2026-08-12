import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import { anonymousQuery } from "../functions.js";
import {
  findCurrentSeason,
  hydrateSeason,
} from "./readModel.js";
import {
  MAX_POINTS_FOR_AGGREGATE,
} from "./limits.js";
import { pointValue } from "./pointReadModel.js";
import {
  currentPerformanceValidator,
  predictionScoringValidator,
  seasonValidator,
} from "./validators.js";
import { domainError } from "../lib/errors.js";
import { validatePlainDate } from "./writeModel.js";

export const currentSeason = anonymousQuery({
  args: { today: v.string() },
  returns: v.union(seasonValidator, v.null()),
  handler: async (ctx, args) => {
    const today = validatePlainDate(args.today, "Current date");
    const season = await findCurrentSeason(ctx, today);
    return season === null ? null : await hydrateSeason(ctx, season);
  },
});

export const hasActiveSeason = anonymousQuery({
  args: { today: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const today = validatePlainDate(args.today, "Current date");
    return (await findCurrentSeason(ctx, today)) !== null;
  },
});

export const predictionScoring = anonymousQuery({
  args: {},
  returns: predictionScoringValidator,
  handler: async (ctx) => {
    const gameType = await ctx.db
      .query("gameTypes")
      .withIndex("by_normalizedLookupId", (index) =>
        index.eq("normalizedLookupId", "wtfir"),
      )
      .first();
    if (gameType === null) {
      return {
        correctHost: null,
        allCorrectBonus: null,
        allIncorrect: null,
      };
    }
    const pointTypes = await Promise.all(
      ["guess", "allcorrect", "all-incorrect"].map(
        async (normalizedLookupId) => {
          const pointType = await ctx.db
            .query("gamePointTypes")
            .withIndex("by_normalizedLookupId", (index) =>
              index.eq(
                "normalizedLookupId",
                normalizedLookupId,
              ),
            )
            .first();
          return pointType?.gameTypeId === gameType._id
            ? pointType.points
            : null;
        },
      ),
    );
    return {
      correctHost: pointTypes[0] ?? null,
      allCorrectBonus: pointTypes[1] ?? null,
      allIncorrect: pointTypes[2] ?? null,
    };
  },
});

export const currentPerformance = anonymousQuery({
  args: { today: v.string() },
  returns: v.union(currentPerformanceValidator, v.null()),
  handler: async (ctx, args) => {
    const today = validatePlainDate(args.today, "Current date");
    const season = await findCurrentSeason(ctx, today);
    if (season === null) {
      return null;
    }
    const points = await ctx.db
      .query("points")
      .withIndex("by_seasonId_and_earnedAt", (index) =>
        index.eq("seasonId", season._id),
      )
      .order("asc")
      .take(MAX_POINTS_FOR_AGGREGATE + 1);
    if (points.length > MAX_POINTS_FOR_AGGREGATE) {
      domainError(
        "CONFLICT",
        "Current performance exceeds the supported point limit.",
        { details: { limit: MAX_POINTS_FOR_AGGREGATE } },
      );
    }
    const userIds = new Map<Id<"users">, Id<"users">>();
    const pointTypeIds = new Map<
      Id<"gamePointTypes">,
      Id<"gamePointTypes">
    >();
    for (const point of points) {
      userIds.set(point.userId, point.userId);
      if (point.gamePointTypeId !== undefined) {
        pointTypeIds.set(
          point.gamePointTypeId,
          point.gamePointTypeId,
        );
      }
    }
    const users = new Map<Id<"users">, Doc<"users">>();
    const pointTypes = new Map<
      Id<"gamePointTypes">,
      Doc<"gamePointTypes">
    >();
    await Promise.all([
      ...[...userIds.values()].map(async (userId) => {
        const user = await ctx.db.get("users", userId);
        if (user === null) {
          domainError(
            "CONFLICT",
            "Performance point has a missing user.",
            { details: { userId } },
          );
        }
        users.set(userId, user);
      }),
      ...[...pointTypeIds.values()].map(async (pointTypeId) => {
        const pointType = await ctx.db.get(
          "gamePointTypes",
          pointTypeId,
        );
        if (pointType === null) {
          domainError(
            "CONFLICT",
            "Performance point has a missing point type.",
            { details: { gamePointTypeId: pointTypeId } },
          );
        }
        pointTypes.set(pointTypeId, pointType);
      }),
    ]);
    const totals = new Map<Id<"users">, number>();
    const flattenedPoints = points.map((point) => {
      const pointType =
        point.gamePointTypeId === undefined
          ? null
          : (pointTypes.get(point.gamePointTypeId) ?? null);
      const value = pointValue(point, pointType);
      totals.set(point.userId, (totals.get(point.userId) ?? 0) + value);
      return {
        userId: point.userId,
        earnedAt: point.earnedAt,
        pointValue: value,
      };
    });
    const userSummary = [...totals.entries()]
      .map(([userId, total]) => {
        const user = users.get(userId);
        if (user === undefined) {
          domainError(
            "CONFLICT",
            "Performance total has a missing user.",
            { details: { userId } },
          );
        }
        return {
          user: {
            id: user._id,
            name: user.name ?? null,
            image: user.image ?? null,
          },
          total,
        };
      })
      .sort((left, right) => right.total - left.total);
    return {
      season: await hydrateSeason(ctx, season),
      userSummary,
      points: flattenedPoints,
    };
  },
});
