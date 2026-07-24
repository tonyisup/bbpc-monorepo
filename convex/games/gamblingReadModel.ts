import type { Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { hydrateAssignment } from "../assignments/readModel.js";
import { domainError } from "../lib/errors.js";
import {
  MAX_ACTIVE_WAGERS_FOR_TOTAL,
  MAX_GAMBLING_ENTRIES_PER_READ,
  MAX_POINTS_FOR_AGGREGATE,
} from "./limits.js";
import {
  calculatePointTotal,
  hydratePointCore,
} from "./pointReadModel.js";
import { hydrateSeason } from "./readModel.js";
import type {
  gamblingEntryValidator,
  gamblingStatusValidator,
  gamblingTypeValidator,
} from "./validators.js";

type GamblingEntryDetail = Infer<typeof gamblingEntryValidator>;
type GamblingStatus = Infer<typeof gamblingStatusValidator>;
type GamblingTypeDetail = Infer<typeof gamblingTypeValidator>;
type GamblingReadContext = Pick<QueryCtx, "db">;

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

function toPointUser(user: Doc<"users">) {
  return {
    id: user._id,
    name: nullable(user.name),
    image: nullable(user.image),
  };
}

export function toGamblingType(
  gamblingType: Doc<"gamblingTypes">,
): GamblingTypeDetail {
  return {
    id: gamblingType._id,
    lookupId: gamblingType.lookupId,
    title: gamblingType.title,
    description: nullable(gamblingType.description),
    multiplier: gamblingType.multiplier,
    isActive: gamblingType.isActive,
    createdAt: gamblingType.createdAt,
  };
}

export function toGamblingStatus(value: string): GamblingStatus {
  switch (value) {
    case "pending":
    case "locked":
    case "won":
    case "lost":
    case "rejected":
      return value;
    default:
      domainError(
        "CONFLICT",
        "Gambling entry has an unsupported canonical status.",
      );
  }
}

export async function requireGamblingType(
  ctx: GamblingReadContext,
  id: Id<"gamblingTypes">,
): Promise<Doc<"gamblingTypes">> {
  const gamblingType = await ctx.db.get("gamblingTypes", id);
  if (gamblingType === null) {
    domainError("NOT_FOUND", "The gambling type is unavailable.");
  }
  return gamblingType;
}

export async function requireGamblingEntry(
  ctx: GamblingReadContext,
  id: Id<"gamblingEntries">,
): Promise<Doc<"gamblingEntries">> {
  const entry = await ctx.db.get("gamblingEntries", id);
  if (entry === null) {
    domainError("NOT_FOUND", "The gambling entry is unavailable.");
  }
  return entry;
}

export async function hydrateGamblingEntry(
  ctx: QueryCtx,
  entry: Doc<"gamblingEntries">,
): Promise<GamblingEntryDetail> {
  const [
    user,
    assignment,
    gamblingType,
    targetUser,
    season,
    awardPoint,
  ] = await Promise.all([
    ctx.db.get("users", entry.userId),
    entry.assignmentId === undefined
      ? null
      : ctx.db.get("assignments", entry.assignmentId),
    ctx.db.get("gamblingTypes", entry.gamblingTypeId),
    entry.targetUserId === undefined
      ? null
      : ctx.db.get("users", entry.targetUserId),
    entry.seasonId === undefined
      ? null
      : ctx.db.get("seasons", entry.seasonId),
    entry.awardPointId === undefined
      ? null
      : ctx.db.get("points", entry.awardPointId),
  ]);
  if (user === null || gamblingType === null) {
    domainError(
      "CONFLICT",
      "Gambling entry has a missing required relationship.",
      { details: { gamblingEntryId: entry._id } },
    );
  }
  if (
    (entry.assignmentId !== undefined && assignment === null) ||
    (entry.targetUserId !== undefined && targetUser === null) ||
    (entry.seasonId !== undefined && season === null) ||
    (entry.awardPointId !== undefined && awardPoint === null)
  ) {
    domainError(
      "CONFLICT",
      "Gambling entry has a missing optional relationship.",
      { details: { gamblingEntryId: entry._id } },
    );
  }
  return {
    id: entry._id,
    points: entry.points,
    createdAt: entry.createdAt,
    notes: nullable(entry.notes),
    status: toGamblingStatus(entry.status),
    user: toPointUser(user),
    assignment:
      assignment === null
        ? null
        : await hydrateAssignment(ctx, assignment),
    gamblingType: toGamblingType(gamblingType),
    targetUser:
      targetUser === null ? null : toPointUser(targetUser),
    season:
      season === null ? null : await hydrateSeason(ctx, season),
    awardPoint:
      awardPoint === null
        ? null
        : await hydratePointCore(ctx, awardPoint),
  };
}

export async function hydrateGamblingEntries(
  ctx: QueryCtx,
  entries: Array<Doc<"gamblingEntries">>,
): Promise<GamblingEntryDetail[]> {
  return await Promise.all(
    entries.map((entry) => hydrateGamblingEntry(ctx, entry)),
  );
}

export function assertGamblingReadLimit(
  entries: Array<Doc<"gamblingEntries">>,
  label: string,
): void {
  if (entries.length > MAX_GAMBLING_ENTRIES_PER_READ) {
    domainError(
      "CONFLICT",
      `${label} exceed the supported gambling read limit.`,
      { details: { limit: MAX_GAMBLING_ENTRIES_PER_READ } },
    );
  }
}

export async function calculateAvailablePointsForUser(
  ctx: QueryCtx,
  userId: Id<"users">,
  seasonId: Id<"seasons">,
  excludeEntryId?: Id<"gamblingEntries">,
): Promise<number> {
  const [points, pending, locked] = await Promise.all([
    ctx.db
      .query("points")
      .withIndex("by_userId_and_seasonId", (index) =>
        index.eq("userId", userId).eq("seasonId", seasonId),
      )
      .take(MAX_POINTS_FOR_AGGREGATE + 1),
    ctx.db
      .query("gamblingEntries")
      .withIndex(
        "by_userId_and_seasonId_and_status",
        (index) =>
          index
            .eq("userId", userId)
            .eq("seasonId", seasonId)
            .eq("status", "pending"),
      )
      .take(MAX_ACTIVE_WAGERS_FOR_TOTAL + 1),
    ctx.db
      .query("gamblingEntries")
      .withIndex(
        "by_userId_and_seasonId_and_status",
        (index) =>
          index
            .eq("userId", userId)
            .eq("seasonId", seasonId)
            .eq("status", "locked"),
      )
      .take(MAX_ACTIVE_WAGERS_FOR_TOTAL + 1),
  ]);
  if (pending.length + locked.length > MAX_ACTIVE_WAGERS_FOR_TOTAL) {
    domainError(
      "CONFLICT",
      "Active wagers exceed the supported point-total limit.",
      { details: { limit: MAX_ACTIVE_WAGERS_FOR_TOTAL } },
    );
  }
  let wageredPoints = 0;
  for (const entry of [...pending, ...locked]) {
    if (entry._id !== excludeEntryId) {
      wageredPoints += entry.points;
    }
  }
  return (await calculatePointTotal(ctx, points)) - wageredPoints;
}
