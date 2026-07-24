import type { Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { hydrateAssignment } from "../assignments/readModel.js";
import { domainError } from "../lib/errors.js";
import {
  MAX_POINT_RELATIONSHIPS,
  MAX_POINTS_FOR_AGGREGATE,
} from "./limits.js";
import {
  hydrateGamePointType,
  hydrateSeason,
} from "./readModel.js";
import type {
  pointCoreValidator,
  pointDetailValidator,
} from "./validators.js";

type PointReadContext = QueryCtx;
type PointCore = Infer<typeof pointCoreValidator>;
type PointDetail = Infer<typeof pointDetailValidator>;

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

export function pointValue(
  point: Doc<"points">,
  pointType: Doc<"gamePointTypes"> | null,
): number {
  return (point.adjustment ?? 0) + (pointType?.points ?? 0);
}

export async function hydratePointCore(
  ctx: PointReadContext,
  point: Doc<"points">,
): Promise<PointCore> {
  const [user, season, pointType] = await Promise.all([
    ctx.db.get("users", point.userId),
    ctx.db.get("seasons", point.seasonId),
    point.gamePointTypeId === undefined
      ? null
      : ctx.db.get("gamePointTypes", point.gamePointTypeId),
  ]);
  if (user === null || season === null) {
    domainError(
      "CONFLICT",
      "Point has a missing user or season relationship.",
      { details: { pointId: point._id } },
    );
  }
  if (point.gamePointTypeId !== undefined && pointType === null) {
    domainError(
      "CONFLICT",
      "Point has a missing game point type relationship.",
      { details: { pointId: point._id } },
    );
  }
  return {
    id: point._id,
    user: {
      id: user._id,
      name: nullable(user.name),
      image: nullable(user.image),
    },
    season: await hydrateSeason(ctx, season),
    reason: nullable(point.reason),
    earnedAt: point.earnedAt,
    adjustment: point.adjustment,
    gamePointType:
      pointType === null
        ? null
        : await hydrateGamePointType(ctx, pointType),
    total: pointValue(point, pointType),
  };
}

function assertPointRelationshipLimit(
  rows: unknown[],
  relationship: string,
): void {
  if (rows.length > MAX_POINT_RELATIONSHIPS) {
    domainError(
      "CONFLICT",
      `Point ${relationship} exceed the supported limit.`,
      {
        details: {
          relationship,
          limit: MAX_POINT_RELATIONSHIPS,
        },
      },
    );
  }
}

export async function hydratePointDetail(
  ctx: PointReadContext,
  point: Doc<"points">,
): Promise<PointDetail> {
  const [
    core,
    assignmentLinks,
    guesses,
    gamblingEntries,
    tagVotes,
    quoteSubmissions,
  ] = await Promise.all([
    hydratePointCore(ctx, point),
    ctx.db
      .query("assignmentPointLinks")
      .withIndex("by_pointId", (index) =>
        index.eq("pointId", point._id),
      )
      .take(MAX_POINT_RELATIONSHIPS + 1),
    ctx.db
      .query("guesses")
      .withIndex("by_pointId", (index) =>
        index.eq("pointId", point._id),
      )
      .take(MAX_POINT_RELATIONSHIPS + 1),
    ctx.db
      .query("gamblingEntries")
      .withIndex("by_awardPointId", (index) =>
        index.eq("awardPointId", point._id),
      )
      .take(MAX_POINT_RELATIONSHIPS + 1),
    ctx.db
      .query("tagVotes")
      .withIndex("by_awardKind_and_awardPointId", (index) =>
        index
          .eq("award.kind", "point")
          .eq("award.pointId", point._id),
      )
      .take(MAX_POINT_RELATIONSHIPS + 1),
    ctx.db
      .query("quoteSubmissions")
      .withIndex("by_pointId", (index) =>
        index.eq("pointId", point._id),
      )
      .take(MAX_POINT_RELATIONSHIPS + 1),
  ]);
  const relationships = [
    [assignmentLinks, "assignment relationships"],
    [guesses, "guess relationships"],
    [gamblingEntries, "gambling relationships"],
    [tagVotes, "tag-vote relationships"],
    [quoteSubmissions, "quote relationships"],
  ] as const;
  for (const [rows, label] of relationships) {
    assertPointRelationshipLimit(rows, label);
  }
  return {
    ...core,
    assignmentLinks: await Promise.all(
      assignmentLinks.map(async (link) => {
        const assignment = await ctx.db.get(
          "assignments",
          link.assignmentId,
        );
        if (assignment === null) {
          domainError(
            "CONFLICT",
            "Point has a missing assignment relationship.",
            { details: { assignmentPointLinkId: link._id } },
          );
        }
        return {
          id: link._id,
          assignment: await hydrateAssignment(ctx, assignment),
        };
      }),
    ),
    guesses: guesses.map((guess) => ({
      id: guess._id,
      assignmentReviewId: guess.assignmentReviewId,
    })),
    gamblingEntries: gamblingEntries.map((entry) => ({
      id: entry._id,
    })),
    tagVotes: tagVotes.map((vote) => ({
      id: vote._id,
      tag: vote.tag,
    })),
    quoteSubmissions: quoteSubmissions.map((submission) => ({
      id: submission._id,
    })),
  };
}

export async function calculatePointTotal(
  ctx: PointReadContext,
  points: Array<Doc<"points">>,
): Promise<number> {
  if (points.length > MAX_POINTS_FOR_AGGREGATE) {
    domainError(
      "CONFLICT",
      "Point total exceeds the supported aggregate limit.",
      { details: { limit: MAX_POINTS_FOR_AGGREGATE } },
    );
  }
  const pointTypeIds = new Map<
    Id<"gamePointTypes">,
    Id<"gamePointTypes">
  >();
  for (const point of points) {
    if (point.gamePointTypeId !== undefined) {
      pointTypeIds.set(
        point.gamePointTypeId,
        point.gamePointTypeId,
      );
    }
  }
  const pointTypes = new Map<
    Id<"gamePointTypes">,
    Doc<"gamePointTypes">
  >();
  await Promise.all(
    [...pointTypeIds.values()].map(async (id) => {
      const pointType = await ctx.db.get("gamePointTypes", id);
      if (pointType === null) {
        domainError(
          "CONFLICT",
          "Point aggregate found a missing game point type.",
          { details: { gamePointTypeId: id } },
        );
      }
      pointTypes.set(id, pointType);
    }),
  );
  let total = 0;
  for (const point of points) {
    const pointType =
      point.gamePointTypeId === undefined
        ? null
        : (pointTypes.get(point.gamePointTypeId) ?? null);
    total += pointValue(point, pointType);
  }
  return total;
}
