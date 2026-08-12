import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import { adminMutation, adminQuery } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  hydrateAdminSeason,
  requireGameTypeDocument,
} from "./readModel.js";
import {
  seasonAdminValidator,
  seasonAdminPerformanceValidator,
} from "./validators.js";
import {
  MAX_SEASON_PERFORMANCE_ACTIVITY,
  validateSeasonPageSize,
} from "./limits.js";
import { pointValue } from "./pointReadModel.js";
import {
  assertSeasonUnreferenced,
  requireSeason,
  validateGameTitle,
  validateOptionalGameText,
  validatePlainDate,
  validateSeasonRange,
} from "./writeModel.js";

export const getById = adminQuery({
  args: { id: v.id("seasons") },
  returns: v.union(seasonAdminValidator, v.null()),
  handler: async (ctx, args) => {
    const season = await ctx.db.get("seasons", args.id);
    return season === null
      ? null
      : await hydrateAdminSeason(ctx, season);
  },
});

export const listPage = adminQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(seasonAdminValidator),
  handler: async (ctx, args) => {
    validateSeasonPageSize(args.paginationOpts.numItems);
    const result = await ctx.db
      .query("seasons")
      .withIndex("by_startedOn")
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map((season) =>
          hydrateAdminSeason(ctx, season),
        ),
      ),
    };
  },
});

export const getPerformance = adminQuery({
  args: { seasonId: v.id("seasons") },
  returns: seasonAdminPerformanceValidator,
  handler: async (ctx, args) => {
    await requireSeason(ctx, args.seasonId);
    const [points, guesses, gamblingEntries] = await Promise.all([
      ctx.db
        .query("points")
        .withIndex("by_seasonId_and_earnedAt", (index) =>
          index.eq("seasonId", args.seasonId),
        )
        .order("asc")
        .take(MAX_SEASON_PERFORMANCE_ACTIVITY + 1),
      ctx.db
        .query("guesses")
        .withIndex("by_seasonId", (index) =>
          index.eq("seasonId", args.seasonId),
        )
        .take(MAX_SEASON_PERFORMANCE_ACTIVITY + 1),
      ctx.db
        .query("gamblingEntries")
        .withIndex("by_seasonId", (index) =>
          index.eq("seasonId", args.seasonId),
        )
        .take(MAX_SEASON_PERFORMANCE_ACTIVITY + 1),
    ]);
    for (const [rows, label] of [
      [points, "points"],
      [guesses, "guesses"],
      [gamblingEntries, "gambling entries"],
    ] as const) {
      if (rows.length > MAX_SEASON_PERFORMANCE_ACTIVITY) {
        domainError(
          "CONFLICT",
          `Season ${label} exceed the supported performance limit.`,
          {
            details: {
              relationship: label,
              limit: MAX_SEASON_PERFORMANCE_ACTIVITY,
            },
          },
        );
      }
    }

    const userIds = new Map<Id<"users">, Id<"users">>();
    const pointTypeIds = new Map<
      Id<"gamePointTypes">,
      Id<"gamePointTypes">
    >();
    for (const point of points) {
      userIds.set(point.userId, point.userId);
      if (point.gamePointTypeId !== undefined) {
        pointTypeIds.set(point.gamePointTypeId, point.gamePointTypeId);
      }
    }
    for (const guess of guesses) {
      userIds.set(guess.userId, guess.userId);
    }
    for (const entry of gamblingEntries) {
      userIds.set(entry.userId, entry.userId);
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
            "Season activity has a missing user relationship.",
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
            "Season point has a missing point type relationship.",
            { details: { gamePointTypeId: pointTypeId } },
          );
        }
        pointTypes.set(pointTypeId, pointType);
      }),
    ]);

    const totals = new Map<Id<"users">, number>();
    const guessCounts = new Map<Id<"users">, number>();
    const gamblingCounts = new Map<Id<"users">, number>();
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
    for (const guess of guesses) {
      guessCounts.set(
        guess.userId,
        (guessCounts.get(guess.userId) ?? 0) + 1,
      );
    }
    for (const entry of gamblingEntries) {
      gamblingCounts.set(
        entry.userId,
        (gamblingCounts.get(entry.userId) ?? 0) + 1,
      );
    }

    const userSummary = [...userIds.values()]
      .map((userId) => {
        const user = users.get(userId);
        if (user === undefined) {
          domainError(
            "CONFLICT",
            "Season performance has a missing user.",
            { details: { userId } },
          );
        }
        return {
          user: {
            id: user._id,
            name: user.name ?? null,
            image: user.image ?? null,
          },
          total: totals.get(userId) ?? 0,
          guessCount: guessCounts.get(userId) ?? 0,
          gamblingCount: gamblingCounts.get(userId) ?? 0,
        };
      })
      .sort(
        (left, right) =>
          right.total - left.total ||
          (left.user.name ?? "").localeCompare(right.user.name ?? ""),
      );
    return {
      userSummary,
      points: flattenedPoints,
    };
  },
});

export const create = adminMutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    gameTypeId: v.id("gameTypes"),
    startedOn: v.string(),
    endedOn: v.optional(v.union(v.string(), v.null())),
  },
  returns: seasonAdminValidator,
  handler: async (ctx, args) => {
    const gameType = await requireGameTypeDocument(
      ctx,
      args.gameTypeId,
    );
    const title = validateGameTitle(args.title, "Season title");
    const description =
      args.description === undefined
        ? undefined
        : validateOptionalGameText(
            args.description,
            "Season description",
          );
    const startedOn = validatePlainDate(
      args.startedOn,
      "Season start date",
    );
    const endedOn =
      args.endedOn === undefined || args.endedOn === null
        ? undefined
        : validatePlainDate(args.endedOn, "Season end date");
    validateSeasonRange(startedOn, endedOn);
    const seasonId = await ctx.db.insert("seasons", {
      title,
      gameTypeId: gameType._id,
      startedOn,
      ...(description === undefined ? {} : { description }),
      ...(endedOn === undefined ? {} : { endedOn }),
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.seasonCreated",
      targetType: "season",
      targetId: seasonId,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return await hydrateAdminSeason(
      ctx,
      await requireSeason(ctx, seasonId),
    );
  },
});

export const update = adminMutation({
  args: {
    id: v.id("seasons"),
    title: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    gameTypeId: v.optional(v.id("gameTypes")),
    startedOn: v.optional(v.string()),
    endedOn: v.optional(v.union(v.string(), v.null())),
  },
  returns: seasonAdminValidator,
  handler: async (ctx, args) => {
    const season = await requireSeason(ctx, args.id);
    const patch: {
      title?: string;
      description?: string | undefined;
      gameTypeId?: typeof season.gameTypeId;
      startedOn?: string;
      endedOn?: string | undefined;
    } = {};
    if (args.title !== undefined) {
      patch.title = validateGameTitle(args.title, "Season title");
    }
    if (args.description !== undefined) {
      patch.description = validateOptionalGameText(
        args.description,
        "Season description",
      );
    }
    if (args.gameTypeId !== undefined) {
      patch.gameTypeId = (
        await requireGameTypeDocument(ctx, args.gameTypeId)
      )._id;
    }
    if (args.startedOn !== undefined) {
      patch.startedOn = validatePlainDate(
        args.startedOn,
        "Season start date",
      );
    }
    if (args.endedOn !== undefined) {
      patch.endedOn =
        args.endedOn === null
          ? undefined
          : validatePlainDate(args.endedOn, "Season end date");
    }
    const startedOn = patch.startedOn ?? season.startedOn;
    if (startedOn === undefined) {
      throw new Error("Writable season is missing a start date.");
    }
    validateSeasonRange(
      startedOn,
      Object.prototype.hasOwnProperty.call(patch, "endedOn")
        ? patch.endedOn
        : season.endedOn,
    );
    const fieldCount = Object.keys(patch).length;
    if (fieldCount === 0) {
      return await hydrateAdminSeason(ctx, season);
    }
    await ctx.db.patch("seasons", season._id, patch);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.seasonUpdated",
      targetType: "season",
      targetId: season._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { fieldCount },
    });
    return await hydrateAdminSeason(
      ctx,
      await requireSeason(ctx, season._id),
    );
  },
});

export const removeIfUnreferenced = adminMutation({
  args: { id: v.id("seasons") },
  returns: v.object({ id: v.id("seasons") }),
  handler: async (ctx, args) => {
    const season = await requireSeason(ctx, args.id);
    await assertSeasonUnreferenced(ctx, season._id);
    await ctx.db.delete("seasons", season._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.seasonDeleted",
      targetType: "season",
      targetId: season._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return { id: season._id };
  },
});
