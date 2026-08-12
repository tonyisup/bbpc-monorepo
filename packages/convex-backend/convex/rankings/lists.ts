import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel.js";
import {
  adminMutation,
  adminQuery,
  authenticatedMutation,
  authenticatedQuery,
} from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import { MAX_RANKED_LISTS_PER_USER } from "../games/limits.js";
import {
  assertRankingListAccess,
  hydrateRankingListDetail,
  hydrateRankingListSummary,
  requireRankingList,
  requireRankingListType,
} from "./readModel.js";
import {
  assertRankingOwnerCapacity,
  deleteRankingListItems,
  requireRankingOwner,
  validateRankingPageSize,
  validateRankingStatus,
  validateRankingTimestamp,
  validateRankingTitle,
} from "./writeModel.js";
import {
  rankingListDetailValidator,
  rankingListSummaryValidator,
  rankingStatusValidator,
  rankingTargetTypeValidator,
} from "./validators.js";

async function hydrateSummaries(
  ctx: Parameters<typeof hydrateRankingListSummary>[0],
  lists: Array<Doc<"rankedLists">>,
) {
  return await Promise.all(
    lists.map((list) => hydrateRankingListSummary(ctx, list)),
  );
}

export const listMine = authenticatedQuery({
  args: {
    targetType: v.optional(rankingTargetTypeValidator),
  },
  returns: v.array(rankingListSummaryValidator),
  handler: async (ctx, args) => {
    const lists = await ctx.db
      .query("rankedLists")
      .withIndex("by_userId_and_updatedAt", (index) =>
        index.eq("userId", ctx.actor.user._id),
      )
      .order("desc")
      .take(MAX_RANKED_LISTS_PER_USER + 1);
    if (lists.length > MAX_RANKED_LISTS_PER_USER) {
      domainError(
        "CONFLICT",
        "Your ranked lists exceed the supported read limit.",
        { details: { limit: MAX_RANKED_LISTS_PER_USER } },
      );
    }
    const hydrated = await hydrateSummaries(ctx, lists);
    if (args.targetType === undefined) {
      return hydrated;
    }
    // convex-query-audit: allow-filter bounded owner list summaries
    return hydrated.filter(
      (list) => list.type.targetType === args.targetType,
    );
  },
});

export const get = authenticatedQuery({
  args: { id: v.id("rankedLists") },
  returns: rankingListDetailValidator,
  handler: async (ctx, args) => {
    const list = await requireRankingList(ctx, args.id);
    assertRankingListAccess(ctx.actor, list);
    return await hydrateRankingListDetail(ctx, list);
  },
});

export const listAdminPage = adminQuery({
  args: {
    userId: v.optional(v.id("users")),
    rankedListTypeId: v.optional(v.id("rankedListTypes")),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(rankingListSummaryValidator),
  handler: async (ctx, args) => {
    validateRankingPageSize(args.paginationOpts.numItems);
    await Promise.all([
      args.userId === undefined
        ? Promise.resolve()
        : requireRankingOwner(ctx, args.userId),
      args.rankedListTypeId === undefined
        ? Promise.resolve()
        : requireRankingListType(ctx, args.rankedListTypeId),
    ]);
    let result;
    if (
      args.userId !== undefined &&
      args.rankedListTypeId !== undefined
    ) {
      const userId = args.userId;
      const rankedListTypeId = args.rankedListTypeId;
      result = await ctx.db
        .query("rankedLists")
        .withIndex(
          "by_userId_and_rankedListTypeId_and_updatedAt",
          (index) =>
            index
              .eq("userId", userId)
              .eq("rankedListTypeId", rankedListTypeId),
        )
        .order("desc")
        .paginate(args.paginationOpts);
    } else if (args.userId !== undefined) {
      const userId = args.userId;
      result = await ctx.db
        .query("rankedLists")
        .withIndex("by_userId_and_updatedAt", (index) =>
          index.eq("userId", userId),
        )
        .order("desc")
        .paginate(args.paginationOpts);
    } else if (args.rankedListTypeId !== undefined) {
      const rankedListTypeId = args.rankedListTypeId;
      result = await ctx.db
        .query("rankedLists")
        .withIndex(
          "by_rankedListTypeId_and_updatedAt",
          (index) =>
            index.eq("rankedListTypeId", rankedListTypeId),
        )
        .order("desc")
        .paginate(args.paginationOpts);
    } else {
      result = await ctx.db
        .query("rankedLists")
        .withIndex("by_updatedAt")
        .order("desc")
        .paginate(args.paginationOpts);
    }
    return {
      ...result,
      page: await hydrateSummaries(ctx, result.page),
    };
  },
});

export const createMine = authenticatedMutation({
  args: {
    rankedListTypeId: v.id("rankedListTypes"),
    title: v.optional(v.union(v.string(), v.null())),
    status: rankingStatusValidator,
    now: v.optional(v.number()),
  },
  returns: rankingListDetailValidator,
  handler: async (ctx, args) => {
    await Promise.all([
      requireRankingListType(ctx, args.rankedListTypeId),
      assertRankingOwnerCapacity(ctx, ctx.actor.user._id),
    ]);
    const now = validateRankingTimestamp(
      args.now ?? Date.now(),
      "Ranked-list creation time",
    );
    const title = validateRankingTitle(args.title ?? null);
    const id = await ctx.db.insert("rankedLists", {
      userId: ctx.actor.user._id,
      rankedListTypeId: args.rankedListTypeId,
      status: validateRankingStatus(args.status),
      ...(title === undefined ? {} : { title }),
      createdAt: now,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "rankings.user.listCreated",
      targetType: "rankedList",
      targetId: id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return await hydrateRankingListDetail(
      ctx,
      await requireRankingList(ctx, id),
    );
  },
});

export const updateAccessible = authenticatedMutation({
  args: {
    id: v.id("rankedLists"),
    title: v.optional(v.union(v.string(), v.null())),
    status: v.optional(rankingStatusValidator),
    now: v.optional(v.number()),
  },
  returns: rankingListDetailValidator,
  handler: async (ctx, args) => {
    const list = await requireRankingList(ctx, args.id);
    assertRankingListAccess(ctx.actor, list);
    const patch: {
      title?: string | undefined;
      status?: "DRAFT" | "PUBLISHED";
      updatedAt?: number;
    } = {};
    if (args.title !== undefined) {
      patch.title = validateRankingTitle(args.title);
    }
    if (args.status !== undefined) {
      patch.status = validateRankingStatus(args.status);
    }
    const fieldCount = Object.keys(patch).length;
    if (fieldCount === 0) {
      return await hydrateRankingListDetail(ctx, list);
    }
    patch.updatedAt = validateRankingTimestamp(
      args.now ?? Date.now(),
      "Ranked-list update time",
    );
    await ctx.db.patch("rankedLists", list._id, patch);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "rankings.user.listUpdated",
      targetType: "rankedList",
      targetId: list._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { fieldCount },
    });
    return await hydrateRankingListDetail(
      ctx,
      await requireRankingList(ctx, list._id),
    );
  },
});

export const removeAccessible = authenticatedMutation({
  args: { id: v.id("rankedLists") },
  returns: v.object({
    id: v.id("rankedLists"),
    deletedItems: v.number(),
  }),
  handler: async (ctx, args) => {
    const list = await requireRankingList(ctx, args.id);
    assertRankingListAccess(ctx.actor, list);
    const type = await requireRankingListType(
      ctx,
      list.rankedListTypeId,
    );
    const deletedItems = await deleteRankingListItems(
      ctx,
      list,
      type,
    );
    await ctx.db.delete("rankedLists", list._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "rankings.user.listDeleted",
      targetType: "rankedList",
      targetId: list._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { deletedItems },
    });
    return { id: list._id, deletedItems };
  },
});

export const changeOwner = adminMutation({
  args: {
    id: v.id("rankedLists"),
    userId: v.id("users"),
    now: v.optional(v.number()),
  },
  returns: rankingListDetailValidator,
  handler: async (ctx, args) => {
    const [list] = await Promise.all([
      requireRankingList(ctx, args.id),
      requireRankingOwner(ctx, args.userId),
    ]);
    if (list.userId === args.userId) {
      return await hydrateRankingListDetail(ctx, list);
    }
    await assertRankingOwnerCapacity(ctx, args.userId, list._id);
    await ctx.db.patch("rankedLists", list._id, {
      userId: args.userId,
      updatedAt: validateRankingTimestamp(
        args.now ?? Date.now(),
        "Ranked-list ownership update time",
      ),
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "rankings.admin.listOwnerChanged",
      targetType: "rankedList",
      targetId: list._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return await hydrateRankingListDetail(
      ctx,
      await requireRankingList(ctx, list._id),
    );
  },
});
