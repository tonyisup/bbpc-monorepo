import { v } from "convex/values";

import {
  adminMutation,
  authenticatedQuery,
} from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import { MAX_RANKED_LIST_TYPES } from "../games/limits.js";
import {
  requireRankingListType,
  toRankingListType,
} from "./readModel.js";
import {
  assertRankingTypeCatalogCapacity,
  assertRankingTypeUnreferenced,
  assertRankingTypeUpdateSafe,
  validateRankingDescription,
  validateRankingMaxItems,
  validateRankingTargetType,
  validateRankingTimestamp,
  validateRankingTypeName,
} from "./writeModel.js";
import {
  rankingListTypeValidator,
  rankingTargetTypeValidator,
} from "./validators.js";

export const list = authenticatedQuery({
  args: {},
  returns: v.array(rankingListTypeValidator),
  handler: async (ctx) => {
    const types = await ctx.db
      .query("rankedListTypes")
      .withIndex("by_createdAt")
      .order("desc")
      .take(MAX_RANKED_LIST_TYPES + 1);
    if (types.length > MAX_RANKED_LIST_TYPES) {
      domainError(
        "CONFLICT",
        "The ranked-list type catalog exceeds the supported limit.",
        { details: { limit: MAX_RANKED_LIST_TYPES } },
      );
    }
    return types.map(toRankingListType);
  },
});

export const create = adminMutation({
  args: {
    name: v.string(),
    description: v.optional(v.union(v.string(), v.null())),
    maxItems: v.number(),
    targetType: rankingTargetTypeValidator,
    now: v.optional(v.number()),
  },
  returns: rankingListTypeValidator,
  handler: async (ctx, args) => {
    await assertRankingTypeCatalogCapacity(ctx);
    const now = validateRankingTimestamp(
      args.now ?? Date.now(),
      "Ranked-list type creation time",
    );
    const description = validateRankingDescription(
      args.description ?? null,
    );
    const id = await ctx.db.insert("rankedListTypes", {
      name: validateRankingTypeName(args.name),
      ...(description === undefined ? {} : { description }),
      maxItems: validateRankingMaxItems(args.maxItems),
      targetType: validateRankingTargetType(args.targetType),
      createdAt: now,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "rankings.admin.typeCreated",
      targetType: "rankedListType",
      targetId: id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return toRankingListType(
      await requireRankingListType(ctx, id),
    );
  },
});

export const update = adminMutation({
  args: {
    id: v.id("rankedListTypes"),
    name: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    maxItems: v.optional(v.number()),
    targetType: v.optional(rankingTargetTypeValidator),
    now: v.optional(v.number()),
  },
  returns: rankingListTypeValidator,
  handler: async (ctx, args) => {
    const type = await requireRankingListType(ctx, args.id);
    const targetType =
      args.targetType === undefined
        ? type.targetType
        : validateRankingTargetType(args.targetType);
    const maxItems =
      args.maxItems === undefined
        ? type.maxItems
        : validateRankingMaxItems(args.maxItems);
    await assertRankingTypeUpdateSafe(
      ctx,
      type,
      targetType,
      maxItems,
    );
    const patch: {
      name?: string;
      description?: string | undefined;
      maxItems?: number;
      targetType?: typeof targetType;
      updatedAt?: number;
    } = {};
    if (args.name !== undefined) {
      patch.name = validateRankingTypeName(args.name);
    }
    if (args.description !== undefined) {
      patch.description = validateRankingDescription(
        args.description,
      );
    }
    if (args.maxItems !== undefined) {
      patch.maxItems = maxItems;
    }
    if (args.targetType !== undefined) {
      patch.targetType = targetType;
    }
    const fieldCount = Object.keys(patch).length;
    if (fieldCount === 0) {
      return toRankingListType(type);
    }
    patch.updatedAt = validateRankingTimestamp(
      args.now ?? Date.now(),
      "Ranked-list type update time",
    );
    await ctx.db.patch("rankedListTypes", type._id, patch);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "rankings.admin.typeUpdated",
      targetType: "rankedListType",
      targetId: type._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { fieldCount },
    });
    return toRankingListType(
      await requireRankingListType(ctx, type._id),
    );
  },
});

export const remove = adminMutation({
  args: { id: v.id("rankedListTypes") },
  returns: v.object({ id: v.id("rankedListTypes") }),
  handler: async (ctx, args) => {
    const type = await requireRankingListType(ctx, args.id);
    await assertRankingTypeUnreferenced(ctx, type._id);
    await ctx.db.delete("rankedListTypes", type._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "rankings.admin.typeDeleted",
      targetType: "rankedListType",
      targetId: type._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return { id: type._id };
  },
});
