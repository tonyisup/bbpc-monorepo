import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import { hydrateAssignment } from "../assignments/readModel.js";
import { adminMutation, adminQuery } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  MAX_ASSIGNMENTS_FOR_POINT_TOTALS,
  MAX_ASSIGNMENT_POINT_LINKS_FOR_TOTALS,
  MAX_POINT_RELATIONSHIPS,
  MAX_POINTS_FOR_AGGREGATE,
  MAX_USERS_FOR_POINT_TOTALS,
  validatePointPageSize,
} from "./limits.js";
import {
  calculatePointTotal,
  hydratePointCore,
  hydratePointDetail,
  pointValue,
} from "./pointReadModel.js";
import {
  deletePointAndClearRelationships,
  insertPoint,
  requireOptionalGamePointType,
  requirePoint,
  requirePointAssignment,
  requirePointUser,
  resolveGamePointTypeByLookup,
  resolvePointSeason,
  validateEarnedAt,
  validatePointAdjustment,
  validatePointReason,
} from "./pointWriteModel.js";
import {
  assignmentPointLinkValidator,
  assignmentPointTotalValidator,
  pointCoreValidator,
  pointDetailValidator,
  pointSeasonSelectorValidator,
  pointSeasonTargetValidator,
} from "./validators.js";
import { requireSeason } from "./writeModel.js";

const assignmentPointWithPointValidator = v.object({
  id: v.id("assignmentPointLinks"),
  point: pointCoreValidator,
});

function validateDistinctIdList(
  ids: string[],
  label: string,
  limit: number,
): void {
  if (ids.length < 1 || ids.length > limit) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must contain 1 through ${String(limit)} IDs.`,
    );
  }
  if (new Set(ids).size !== ids.length) {
    domainError(
      "VALIDATION_FAILED",
      `${label} cannot contain duplicate IDs.`,
    );
  }
}

async function resolveSelectedSeasonId(
  ctx: Parameters<typeof requireSeason>[0],
  selector:
    | { kind: "all" }
    | { kind: "current"; today: string }
    | { kind: "season"; seasonId: Id<"seasons"> },
): Promise<Id<"seasons"> | null> {
  return selector.kind === "all"
    ? null
    : (await resolvePointSeason(ctx, selector))._id;
}

export const getById = adminQuery({
  args: { id: v.id("points") },
  returns: v.union(pointDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const point = await ctx.db.get("points", args.id);
    return point === null
      ? null
      : await hydratePointDetail(ctx, point);
  },
});

export const listForUserPage = adminQuery({
  args: {
    userId: v.id("users"),
    season: pointSeasonSelectorValidator,
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(pointCoreValidator),
  handler: async (ctx, args) => {
    validatePointPageSize(args.paginationOpts.numItems);
    await requirePointUser(ctx, args.userId);
    const seasonId = await resolveSelectedSeasonId(
      ctx,
      args.season,
    );
    const result =
      seasonId === null
        ? await ctx.db
            .query("points")
            .withIndex("by_userId_and_earnedAt", (index) =>
              index.eq("userId", args.userId),
            )
            .order("desc")
            .paginate(args.paginationOpts)
        : await ctx.db
            .query("points")
            .withIndex(
              "by_userId_and_seasonId_and_earnedAt",
              (index) =>
                index
                  .eq("userId", args.userId)
                  .eq("seasonId", seasonId),
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

export const listForSeasonPage = adminQuery({
  args: {
    seasonId: v.id("seasons"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(pointCoreValidator),
  handler: async (ctx, args) => {
    validatePointPageSize(args.paginationOpts.numItems);
    await requireSeason(ctx, args.seasonId);
    const result = await ctx.db
      .query("points")
      .withIndex("by_seasonId_and_earnedAt", (index) =>
        index.eq("seasonId", args.seasonId),
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

export const totalForUser = adminQuery({
  args: {
    userId: v.id("users"),
    season: pointSeasonSelectorValidator,
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    await requirePointUser(ctx, args.userId);
    const seasonId = await resolveSelectedSeasonId(
      ctx,
      args.season,
    );
    const points =
      seasonId === null
        ? await ctx.db
            .query("points")
            .withIndex("by_userId", (index) =>
              index.eq("userId", args.userId),
            )
            .take(MAX_POINTS_FOR_AGGREGATE + 1)
        : await ctx.db
            .query("points")
            .withIndex("by_userId_and_seasonId", (index) =>
              index
                .eq("userId", args.userId)
                .eq("seasonId", seasonId),
            )
            .take(MAX_POINTS_FOR_AGGREGATE + 1);
    return await calculatePointTotal(ctx, points);
  },
});

export const listForAssignmentAndUser = adminQuery({
  args: {
    userId: v.id("users"),
    assignmentId: v.id("assignments"),
  },
  returns: v.array(assignmentPointWithPointValidator),
  handler: async (ctx, args) => {
    await Promise.all([
      requirePointUser(ctx, args.userId),
      requirePointAssignment(ctx, args.assignmentId),
    ]);
    const links = await ctx.db
      .query("assignmentPointLinks")
      .withIndex("by_assignmentId_and_userId", (index) =>
        index
          .eq("assignmentId", args.assignmentId)
          .eq("userId", args.userId),
      )
      .take(MAX_POINT_RELATIONSHIPS + 1);
    if (links.length > MAX_POINT_RELATIONSHIPS) {
      domainError(
        "CONFLICT",
        "Assignment points exceed the supported read limit.",
        { details: { limit: MAX_POINT_RELATIONSHIPS } },
      );
    }
    return await Promise.all(
      links.map(async (link) => {
        const point = await requirePoint(ctx, link.pointId);
        if (point.userId !== link.userId) {
          domainError(
            "CONFLICT",
            "Assignment point link user does not match its point.",
            { details: { assignmentPointLinkId: link._id } },
          );
        }
        return {
          id: link._id,
          point: await hydratePointCore(ctx, point),
        };
      }),
    );
  },
});

export const totalsForAssignments = adminQuery({
  args: {
    userIds: v.array(v.id("users")),
    assignmentIds: v.array(v.id("assignments")),
  },
  returns: v.array(assignmentPointTotalValidator),
  handler: async (ctx, args) => {
    validateDistinctIdList(
      args.userIds,
      "User IDs",
      MAX_USERS_FOR_POINT_TOTALS,
    );
    validateDistinctIdList(
      args.assignmentIds,
      "Assignment IDs",
      MAX_ASSIGNMENTS_FOR_POINT_TOTALS,
    );
    await Promise.all([
      ...args.userIds.map((id) => requirePointUser(ctx, id)),
      ...args.assignmentIds.map((id) =>
        requirePointAssignment(ctx, id),
      ),
    ]);
    const userIds = new Set<Id<"users">>(args.userIds);
    const links: Array<Doc<"assignmentPointLinks">> = [];
    for (const assignmentId of args.assignmentIds) {
      const assignmentLinks = await ctx.db
        .query("assignmentPointLinks")
        .withIndex("by_assignmentId", (index) =>
          index.eq("assignmentId", assignmentId),
        )
        .take(MAX_ASSIGNMENT_POINT_LINKS_FOR_TOTALS + 1);
      if (
        assignmentLinks.length >
        MAX_ASSIGNMENT_POINT_LINKS_FOR_TOTALS
      ) {
        domainError(
          "CONFLICT",
          "Assignment point totals exceed the per-assignment limit.",
          {
            details: {
              limit: MAX_ASSIGNMENT_POINT_LINKS_FOR_TOTALS,
            },
          },
        );
      }
      for (const link of assignmentLinks) {
        if (userIds.has(link.userId)) {
          links.push(link);
        }
      }
    }
    if (links.length > MAX_ASSIGNMENT_POINT_LINKS_FOR_TOTALS) {
      domainError(
        "CONFLICT",
        "Assignment point totals exceed the aggregate limit.",
        {
          details: {
            limit: MAX_ASSIGNMENT_POINT_LINKS_FOR_TOTALS,
          },
        },
      );
    }
    const totals = new Map<
      string,
      {
        userId: Id<"users">;
        assignmentId: Id<"assignments">;
        total: number;
      }
    >();
    const pointTypes = new Map<
      Id<"gamePointTypes">,
      Doc<"gamePointTypes">
    >();
    for (const link of links) {
      const point = await requirePoint(ctx, link.pointId);
      if (point.userId !== link.userId) {
        domainError(
          "CONFLICT",
          "Assignment point link user does not match its point.",
          { details: { assignmentPointLinkId: link._id } },
        );
      }
      let pointType: Doc<"gamePointTypes"> | null = null;
      if (point.gamePointTypeId !== undefined) {
        pointType =
          pointTypes.get(point.gamePointTypeId) ??
          (await requireOptionalGamePointType(
            ctx,
            point.gamePointTypeId,
          ));
        if (pointType !== null) {
          pointTypes.set(point.gamePointTypeId, pointType);
        }
      }
      const key = `${link.userId}::${link.assignmentId}`;
      const current = totals.get(key) ?? {
        userId: link.userId,
        assignmentId: link.assignmentId,
        total: 0,
      };
      current.total += pointValue(point, pointType);
      totals.set(key, current);
    }
    return [...totals.values()];
  },
});

export const create = adminMutation({
  args: {
    userId: v.id("users"),
    season: pointSeasonTargetValidator,
    reason: v.optional(v.string()),
    adjustment: v.union(v.number(), v.null()),
    gamePointTypeId: v.optional(v.id("gamePointTypes")),
    earnedAt: v.optional(v.number()),
  },
  returns: pointCoreValidator,
  handler: async (ctx, args) => {
    const [user, season, pointType] = await Promise.all([
      requirePointUser(ctx, args.userId),
      resolvePointSeason(ctx, args.season),
      requireOptionalGamePointType(ctx, args.gamePointTypeId),
    ]);
    const point = await insertPoint(ctx, {
      userId: user._id,
      seasonId: season._id,
      reason:
        args.reason === undefined
          ? undefined
          : validatePointReason(args.reason),
      adjustment: validatePointAdjustment(args.adjustment),
      gamePointTypeId: pointType?._id,
      earnedAt: validateEarnedAt(args.earnedAt ?? Date.now()),
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.pointCreated",
      targetType: "point",
      targetId: point._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return await hydratePointCore(ctx, point);
  },
});

export const createByLookup = adminMutation({
  args: {
    userId: v.id("users"),
    season: pointSeasonTargetValidator,
    gamePointLookupId: v.string(),
    reason: v.string(),
    adjustment: v.optional(v.number()),
    earnedAt: v.optional(v.number()),
  },
  returns: pointCoreValidator,
  handler: async (ctx, args) => {
    const [user, season, pointType] = await Promise.all([
      requirePointUser(ctx, args.userId),
      resolvePointSeason(ctx, args.season),
      resolveGamePointTypeByLookup(ctx, args.gamePointLookupId),
    ]);
    const point = await insertPoint(ctx, {
      userId: user._id,
      seasonId: season._id,
      reason: validatePointReason(args.reason),
      adjustment: validatePointAdjustment(args.adjustment ?? 0),
      gamePointTypeId: pointType._id,
      earnedAt: validateEarnedAt(args.earnedAt ?? Date.now()),
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.pointCreatedByLookup",
      targetType: "point",
      targetId: point._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return await hydratePointCore(ctx, point);
  },
});

export const createForAssignmentByLookup = adminMutation({
  args: {
    userId: v.id("users"),
    assignmentId: v.id("assignments"),
    season: pointSeasonTargetValidator,
    gamePointLookupId: v.string(),
    reason: v.string(),
    adjustment: v.optional(v.number()),
    earnedAt: v.optional(v.number()),
  },
  returns: pointDetailValidator,
  handler: async (ctx, args) => {
    const [user, assignment, season, pointType] =
      await Promise.all([
        requirePointUser(ctx, args.userId),
        requirePointAssignment(ctx, args.assignmentId),
        resolvePointSeason(ctx, args.season),
        resolveGamePointTypeByLookup(
          ctx,
          args.gamePointLookupId,
        ),
      ]);
    const point = await insertPoint(ctx, {
      userId: user._id,
      seasonId: season._id,
      reason: validatePointReason(args.reason),
      adjustment: validatePointAdjustment(args.adjustment ?? 0),
      gamePointTypeId: pointType._id,
      earnedAt: validateEarnedAt(args.earnedAt ?? Date.now()),
    });
    const linkId = await ctx.db.insert("assignmentPointLinks", {
      assignmentId: assignment._id,
      userId: user._id,
      pointId: point._id,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.assignmentPointCreated",
      targetType: "point",
      targetId: point._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { assignmentPointLinkId: linkId },
    });
    return await hydratePointDetail(ctx, point);
  },
});

export const update = adminMutation({
  args: {
    id: v.id("points"),
    reason: v.optional(v.union(v.string(), v.null())),
    adjustment: v.optional(v.union(v.number(), v.null())),
    gamePointTypeId: v.optional(
      v.union(v.id("gamePointTypes"), v.null()),
    ),
    earnedAt: v.optional(v.number()),
  },
  returns: pointCoreValidator,
  handler: async (ctx, args) => {
    const point = await requirePoint(ctx, args.id);
    const patch: {
      reason?: string | undefined;
      adjustment?: number | null;
      gamePointTypeId?: Id<"gamePointTypes"> | undefined;
      earnedAt?: number;
    } = {};
    if (args.reason !== undefined) {
      patch.reason = validatePointReason(args.reason);
    }
    if (args.adjustment !== undefined) {
      patch.adjustment = validatePointAdjustment(args.adjustment);
    }
    if (args.gamePointTypeId !== undefined) {
      patch.gamePointTypeId =
        args.gamePointTypeId === null
          ? undefined
          : (
              await requireOptionalGamePointType(
                ctx,
                args.gamePointTypeId,
              )
            )?._id;
    }
    if (args.earnedAt !== undefined) {
      patch.earnedAt = validateEarnedAt(args.earnedAt);
    }
    const fieldCount = Object.keys(patch).length;
    if (fieldCount === 0) {
      return await hydratePointCore(ctx, point);
    }
    await ctx.db.patch("points", point._id, patch);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.pointUpdated",
      targetType: "point",
      targetId: point._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { fieldCount },
    });
    return await hydratePointCore(
      ctx,
      await requirePoint(ctx, point._id),
    );
  },
});

export const linkAssignment = adminMutation({
  args: {
    pointId: v.id("points"),
    assignmentId: v.id("assignments"),
  },
  returns: assignmentPointLinkValidator,
  handler: async (ctx, args) => {
    const [point, assignment] = await Promise.all([
      requirePoint(ctx, args.pointId),
      requirePointAssignment(ctx, args.assignmentId),
    ]);
    const existing = await ctx.db
      .query("assignmentPointLinks")
      .withIndex(
        "by_assignmentId_and_userId_and_pointId",
        (index) =>
          index
            .eq("assignmentId", assignment._id)
            .eq("userId", point.userId)
            .eq("pointId", point._id),
      )
      .first();
    if (existing !== null) {
      domainError(
        "CONFLICT",
        "The assignment is already linked to this point.",
      );
    }
    const linkId = await ctx.db.insert("assignmentPointLinks", {
      assignmentId: assignment._id,
      userId: point.userId,
      pointId: point._id,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.pointAssignmentLinked",
      targetType: "point",
      targetId: point._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { assignmentPointLinkId: linkId },
    });
    return {
      id: linkId,
      assignment: await hydrateAssignment(ctx, assignment),
    };
  },
});

export const unlinkAssignment = adminMutation({
  args: {
    pointId: v.id("points"),
    assignmentId: v.id("assignments"),
  },
  returns: v.object({ count: v.number() }),
  handler: async (ctx, args) => {
    const point = await requirePoint(ctx, args.pointId);
    await requirePointAssignment(ctx, args.assignmentId);
    const link = await ctx.db
      .query("assignmentPointLinks")
      .withIndex(
        "by_assignmentId_and_userId_and_pointId",
        (index) =>
          index
            .eq("assignmentId", args.assignmentId)
            .eq("userId", point.userId)
            .eq("pointId", point._id),
      )
      .first();
    if (link === null) {
      return { count: 0 };
    }
    await ctx.db.delete("assignmentPointLinks", link._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.pointAssignmentUnlinked",
      targetType: "point",
      targetId: point._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { assignmentPointLinkId: link._id },
    });
    return { count: 1 };
  },
});

export const remove = adminMutation({
  args: { id: v.id("points") },
  returns: v.object({ id: v.id("points") }),
  handler: async (ctx, args) => {
    const point = await requirePoint(ctx, args.id);
    const counts = await deletePointAndClearRelationships(ctx, point);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.pointDeleted",
      targetType: "point",
      targetId: point._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: counts,
    });
    return { id: point._id };
  },
});
