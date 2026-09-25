import type { Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import { MAX_POINTS_FOR_AGGREGATE } from "./limits.js";
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
 * Reads a whole season's points and totals them per player. The public
 * standings and the member season page share this; both are bounded by the
 * same aggregate limit.
 */
export async function loadSeasonPerformance(
  ctx: SeasonReadContext,
  seasonId: Id<"seasons">,
  label: string,
): Promise<SeasonPerformance> {
  const points = await ctx.db
    .query("points")
    .withIndex("by_seasonId_and_earnedAt", (index) =>
      index.eq("seasonId", seasonId),
    )
    .order("asc")
    .take(MAX_POINTS_FOR_AGGREGATE + 1);
  if (points.length > MAX_POINTS_FOR_AGGREGATE) {
    domainError(
      "CONFLICT",
      `${label} exceeds the supported point limit.`,
      { details: { limit: MAX_POINTS_FOR_AGGREGATE } },
    );
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
 * Where a player sits among everyone who has scored this season. Equal
 * totals share a rank. A player without a season point has no standing.
 */
export function findSeasonStanding(
  userSummary: PerformanceUser[],
  userId: Id<"users">,
): SeasonStanding | null {
  const mine = userSummary.find((entry) => entry.user.id === userId);
  if (mine === undefined) {
    return null;
  }
  let ahead = 0;
  for (const entry of userSummary) {
    if (entry.total > mine.total) {
      ahead += 1;
    }
  }
  return { rank: ahead + 1, playerCount: userSummary.length };
}
