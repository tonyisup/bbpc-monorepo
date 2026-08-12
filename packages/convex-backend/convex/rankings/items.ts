import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import { authenticatedMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  assertRankingListAccess,
  hydrateRankingItem,
  hydrateRankingListDetail,
  listValidatedRankingItems,
  requireRankingItem,
  requireRankingList,
  requireRankingListType,
} from "./readModel.js";
import {
  rankingItemMatchesTarget,
  rankingTargetPatch,
  resolveRankingTarget,
  validateRankingComment,
  validateRankingRank,
  validateRankingTimestamp,
} from "./writeModel.js";
import {
  rankingItemValidator,
  rankingListDetailValidator,
  rankingTargetInputValidator,
} from "./validators.js";

async function requireAccessibleList(
  ctx: Parameters<typeof requireRankingList>[0] & {
    actor: Parameters<typeof assertRankingListAccess>[0];
  },
  listId: Id<"rankedLists">,
) {
  const list = await requireRankingList(ctx, listId);
  assertRankingListAccess(ctx.actor, list);
  const type = await requireRankingListType(
    ctx,
    list.rankedListTypeId,
  );
  const items = await listValidatedRankingItems(ctx, list, type);
  return { items, list, type };
}

function findTargetAndRank(
  items: Array<Doc<"rankedItems">>,
  target: Parameters<typeof rankingItemMatchesTarget>[1],
  rank: number,
) {
  let existingTarget: Doc<"rankedItems"> | undefined;
  let existingAtRank: Doc<"rankedItems"> | undefined;
  for (const item of items) {
    if (rankingItemMatchesTarget(item, target)) {
      existingTarget = item;
    }
    if (item.rank === rank) {
      existingAtRank = item;
    }
  }
  return { existingAtRank, existingTarget };
}

export const upsert = authenticatedMutation({
  args: {
    rankedListId: v.id("rankedLists"),
    target: rankingTargetInputValidator,
    rank: v.number(),
    comment: v.optional(v.union(v.string(), v.null())),
    now: v.optional(v.number()),
  },
  returns: rankingItemValidator,
  handler: async (ctx, args) => {
    const { items, list, type } = await requireAccessibleList(
      ctx,
      args.rankedListId,
    );
    const rank = validateRankingRank(args.rank, type.maxItems);
    const target = await resolveRankingTarget(ctx, type, args.target);
    const comment = validateRankingComment(args.comment ?? null);
    const now = validateRankingTimestamp(
      args.now ?? Date.now(),
      "Ranked-item update time",
    );
    const { existingAtRank, existingTarget } = findTargetAndRank(
      items,
      target,
      rank,
    );
    let itemId: Id<"rankedItems">;
    let operation: "created" | "moved" | "replaced";
    if (existingTarget !== undefined) {
      if (
        existingAtRank !== undefined &&
        existingAtRank._id !== existingTarget._id
      ) {
        await ctx.db.patch("rankedItems", existingAtRank._id, {
          rank: existingTarget.rank,
          updatedAt: now,
        });
      }
      await ctx.db.patch("rankedItems", existingTarget._id, {
        ...rankingTargetPatch(target),
        rank,
        comment,
        updatedAt: now,
      });
      itemId = existingTarget._id;
      operation = "moved";
    } else if (existingAtRank !== undefined) {
      await ctx.db.patch("rankedItems", existingAtRank._id, {
        ...rankingTargetPatch(target),
        comment,
        updatedAt: now,
      });
      itemId = existingAtRank._id;
      operation = "replaced";
    } else {
      itemId = await ctx.db.insert("rankedItems", {
        rankedListId: list._id,
        ...target,
        rank,
        ...(comment === undefined ? {} : { comment }),
        createdAt: now,
        updatedAt: now,
      });
      operation = "created";
    }
    await ctx.db.patch("rankedLists", list._id, { updatedAt: now });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "rankings.user.itemUpserted",
      targetType: "rankedItem",
      targetId: itemId,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { operation },
    });
    return await hydrateRankingItem(
      ctx,
      await requireRankingItem(ctx, itemId),
      type,
    );
  },
});

export const move = authenticatedMutation({
  args: {
    id: v.id("rankedItems"),
    newRank: v.number(),
    now: v.optional(v.number()),
  },
  returns: rankingItemValidator,
  handler: async (ctx, args) => {
    const item = await requireRankingItem(ctx, args.id);
    const { items, list, type } = await requireAccessibleList(
      ctx,
      item.rankedListId,
    );
    const newRank = validateRankingRank(
      args.newRank,
      type.maxItems,
    );
    if (item.rank === newRank) {
      return await hydrateRankingItem(ctx, item, type);
    }
    const now = validateRankingTimestamp(
      args.now ?? Date.now(),
      "Ranked-item move time",
    );
    for (const candidate of items) {
      if (candidate._id === item._id) {
        continue;
      }
      if (
        newRank < item.rank &&
        candidate.rank >= newRank &&
        candidate.rank < item.rank
      ) {
        await ctx.db.patch("rankedItems", candidate._id, {
          rank: candidate.rank + 1,
          updatedAt: now,
        });
      } else if (
        newRank > item.rank &&
        candidate.rank > item.rank &&
        candidate.rank <= newRank
      ) {
        await ctx.db.patch("rankedItems", candidate._id, {
          rank: candidate.rank - 1,
          updatedAt: now,
        });
      }
    }
    await ctx.db.patch("rankedItems", item._id, {
      rank: newRank,
      updatedAt: now,
    });
    await ctx.db.patch("rankedLists", list._id, { updatedAt: now });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "rankings.user.itemMoved",
      targetType: "rankedItem",
      targetId: item._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return await hydrateRankingItem(
      ctx,
      await requireRankingItem(ctx, item._id),
      type,
    );
  },
});

export const reorder = authenticatedMutation({
  args: {
    rankedListId: v.id("rankedLists"),
    itemIds: v.array(v.id("rankedItems")),
    now: v.optional(v.number()),
  },
  returns: rankingListDetailValidator,
  handler: async (ctx, args) => {
    const { items, list } = await requireAccessibleList(
      ctx,
      args.rankedListId,
    );
    if (args.itemIds.length !== items.length) {
      domainError(
        "VALIDATION_FAILED",
        "A ranked-list reorder must include every current item.",
      );
    }
    const requestedIds = new Set(args.itemIds);
    if (requestedIds.size !== args.itemIds.length) {
      domainError(
        "VALIDATION_FAILED",
        "A ranked-list reorder cannot contain duplicate items.",
      );
    }
    for (const item of items) {
      if (!requestedIds.has(item._id)) {
        domainError(
          "VALIDATION_FAILED",
          "A ranked-list reorder contains a foreign or missing item.",
        );
      }
    }
    if (items.length === 0) {
      return await hydrateRankingListDetail(ctx, list);
    }
    const now = validateRankingTimestamp(
      args.now ?? Date.now(),
      "Ranked-list reorder time",
    );
    for (const [index, itemId] of args.itemIds.entries()) {
      await ctx.db.patch("rankedItems", itemId, {
        rank: index + 1,
        updatedAt: now,
      });
    }
    await ctx.db.patch("rankedLists", list._id, { updatedAt: now });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "rankings.user.itemsReordered",
      targetType: "rankedList",
      targetId: list._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { itemCount: items.length },
    });
    return await hydrateRankingListDetail(
      ctx,
      await requireRankingList(ctx, list._id),
    );
  },
});

export const remove = authenticatedMutation({
  args: {
    id: v.id("rankedItems"),
    now: v.optional(v.number()),
  },
  returns: v.object({
    id: v.id("rankedItems"),
    rank: v.number(),
  }),
  handler: async (ctx, args) => {
    const item = await requireRankingItem(ctx, args.id);
    const { list } = await requireAccessibleList(
      ctx,
      item.rankedListId,
    );
    const now = validateRankingTimestamp(
      args.now ?? Date.now(),
      "Ranked-item removal time",
    );
    await ctx.db.delete("rankedItems", item._id);
    await ctx.db.patch("rankedLists", list._id, { updatedAt: now });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "rankings.user.itemDeleted",
      targetType: "rankedItem",
      targetId: item._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return { id: item._id, rank: item.rank };
  },
});
