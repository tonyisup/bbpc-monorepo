import type { Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import {
  MAX_POINTS_FOR_AGGREGATE,
  assertPointAggregateLimit,
} from "./limits.js";
import { pointValue } from "./pointReadModel.js";
import type {
  performancePointValidator,
  performanceUserValidator,
  seasonStandingValidator,
} from "./validators.js";

type SeasonReadContext = Pick<QueryCtx, "db">;
type PerformanceUser = Infer<typeof performanceUserValidator>;
type PerformancePoint = Infer<typeof performancePointValidator>;
type SeasonStanding = Infer<typeof seasonStandingValidator>;

export interface SeasonPerformance {
  /** Every scoring player, highest total first. */
  userSummary: PerformanceUser[];
  /** Every season point, oldest first. */
  points: PerformancePoint[];
}

export async function loadPointTypes(
  ctx: SeasonReadContext,
  points: Array<Doc<"points">>,
): Promise<Map<Id<"gamePointTypes">, Doc<"gamePointTypes">>> {
  const pointTypeIds = new Set<Id<"gamePointTypes">>();
  for (const point of points) {
    if (point.gamePointTypeId !== undefined) {
      pointTypeIds.add(point.gamePointTypeId);
    }
  }
  const pointTypes = new Map<
    Id<"gamePointTypes">,
    Doc<"gamePointTypes">
  >();
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
  return pointTypes;
}

export function valueOf(
  point: Doc<"points">,
  pointTypes: Map<Id<"gamePointTypes">, Doc<"gamePointTypes">>,
): number {
  return pointValue(
    point,
    point.gamePointTypeId === undefined
      ? null
      : (pointTypes.get(point.gamePointTypeId) ?? null),
  );
}

/**
 * Every point in a season, oldest first, or null once the season has more
 * than the aggregate limit. Callers decide whether that is an error (the
 * public standings) or a section to leave blank (a member's own pages).
 */
async function readSeasonPoints(
  ctx: SeasonReadContext,
  seasonId: Id<"seasons">,
): Promise<Array<Doc<"points">> | null> {
  const points = await ctx.db
    .query("points")
    .withIndex("by_seasonId_and_earnedAt", (index) =>
      index.eq("seasonId", seasonId),
    )
    .order("asc")
    .take(MAX_POINTS_FOR_AGGREGATE + 1);
  return points.length > MAX_POINTS_FOR_AGGREGATE ? null : points;
}

/**
 * Reads a whole season's points and totals them per player. The public
 * standings and the member season page share this; both are bounded by the
 * same aggregate limit.
 */
export async function loadSeasonPerformance(
  ctx: SeasonReadContext,
  seasonId: Id<"seasons">,
  label: string,
): Promise<SeasonPerformance> {
  const performance = await tryLoadSeasonPerformance(ctx, seasonId);
  if (performance === null) {
    domainError(
      "CONFLICT",
      `${label} exceeds the supported point limit.`,
      { details: { limit: MAX_POINTS_FOR_AGGREGATE } },
    );
  }
  return performance;
}

/** Like loadSeasonPerformance, but null when the season is too big to total. */
export async function tryLoadSeasonPerformance(
  ctx: SeasonReadContext,
  seasonId: Id<"seasons">,
): Promise<SeasonPerformance | null> {
  const points = await readSeasonPoints(ctx, seasonId);
  if (points === null) {
    return null;
  }
  const userIds = new Set<Id<"users">>();
  for (const point of points) {
    userIds.add(point.userId);
  }
  const users = new Map<Id<"users">, Doc<"users">>();
  const [pointTypes] = await Promise.all([
    loadPointTypes(ctx, points),
    ...[...userIds].map(async (userId) => {
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
  ]);
  const totals = new Map<Id<"users">, number>();
  const flattenedPoints = points.map((point) => {
    const value = valueOf(point, pointTypes);
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
  return { userSummary, points: flattenedPoints };
}

/**
 * One player's standing in a season without loading anyone's profile: the
 * season's points and their point types are the only reads. Null when the
 * player has no season point, or when the season is too big to rank.
 */
export async function loadSeasonStanding(
  ctx: SeasonReadContext,
  seasonId: Id<"seasons">,
  userId: Id<"users">,
): Promise<SeasonStanding | null> {
  const points = await readSeasonPoints(ctx, seasonId);
  if (points === null) {
    return null;
  }
  const pointTypes = await loadPointTypes(ctx, points);
  return standingFromTotals(totalsByUser(points, pointTypes), userId);
}

export function totalsByUser(
  points: ReadonlyArray<Doc<"points">>,
  pointTypes: Map<Id<"gamePointTypes">, Doc<"gamePointTypes">>,
): Map<Id<"users">, number> {
  const totals = new Map<Id<"users">, number>();
  for (const point of points) {
    totals.set(
      point.userId,
      (totals.get(point.userId) ?? 0) + valueOf(point, pointTypes),
    );
  }
  return totals;
}

/**
 * The member's own points in one season. A single member cannot realistically
 * exceed the aggregate limit in one season, so that is a conflict.
 */
export async function readMemberSeasonPoints(
  ctx: SeasonReadContext,
  userId: Id<"users">,
  seasonId: Id<"seasons">,
): Promise<Array<Doc<"points">>> {
  const points = await ctx.db
    .query("points")
    .withIndex("by_userId_and_seasonId", (index) =>
      index.eq("userId", userId).eq("seasonId", seasonId),
    )
    .take(MAX_POINTS_FOR_AGGREGATE + 1);
  assertPointAggregateLimit(points, "Member season points");
  return points;
}

/**
 * Where a player sits among everyone who has scored this season. Equal
 * totals share a rank. A player without a season point has no standing.
 */
export function standingFromTotals(
  totals: ReadonlyMap<Id<"users">, number>,
  userId: Id<"users">,
): SeasonStanding | null {
  const mine = totals.get(userId);
  if (mine === undefined) {
    return null;
  }
  let ahead = 0;
  for (const total of totals.values()) {
    if (total > mine) {
      ahead += 1;
    }
  }
  return { rank: ahead + 1, playerCount: totals.size };
}

export function findSeasonStanding(
  userSummary: ReadonlyArray<{ user: { id: Id<"users"> }; total: number }>,
  userId: Id<"users">,
): SeasonStanding | null {
  return standingFromTotals(
    new Map(userSummary.map((entry) => [entry.user.id, entry.total])),
    userId,
  );
}
