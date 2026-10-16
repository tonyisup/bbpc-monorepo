import { v } from "convex/values";

import { adminMutation, adminQuery } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import {
  listMerchItemsInOrder,
  nextMerchSortOrder,
  requireMerchItem,
  toAdminMerchItem,
  validateMerchItemInput,
} from "./model.js";
import {
  adminMerchItemValidator,
  merchItemInputFields,
  merchMoveDirectionValidator,
} from "./validators.js";

export const list = adminQuery({
  args: {},
  returns: v.array(adminMerchItemValidator),
  handler: async (ctx) => {
    const items = await listMerchItemsInOrder(ctx);
    return items.map(toAdminMerchItem);
  },
});

export const create = adminMutation({
  args: merchItemInputFields,
  returns: adminMerchItemValidator,
  handler: async (ctx, args) => {
    const fields = validateMerchItemInput(args);
    const sortOrder = await nextMerchSortOrder(ctx);
    const now = Date.now();
    const id = await ctx.db.insert("merchItems", {
      ...fields,
      sortOrder,
      createdAt: now,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "merch.admin.created",
      targetType: "merchItem",
      targetId: id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { visible: fields.visible, featured: fields.featured },
    });
    return toAdminMerchItem(await requireMerchItem(ctx, id));
  },
});

export const update = adminMutation({
  args: { id: v.id("merchItems"), ...merchItemInputFields },
  returns: adminMerchItemValidator,
  handler: async (ctx, { id, ...input }) => {
    const item = await requireMerchItem(ctx, id);
    const fields = validateMerchItemInput(input);
    await ctx.db.replace("merchItems", item._id, {
      ...fields,
      sortOrder: item.sortOrder,
      createdAt: item.createdAt,
      updatedAt: Date.now(),
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "merch.admin.updated",
      targetType: "merchItem",
      targetId: item._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { visible: fields.visible, featured: fields.featured },
    });
    return toAdminMerchItem(await requireMerchItem(ctx, item._id));
  },
});

// Changes only `visible`, so a stale admin list cannot undo another edit.
export const setVisible = adminMutation({
  args: { id: v.id("merchItems"), visible: v.boolean() },
  returns: adminMerchItemValidator,
  handler: async (ctx, args) => {
    const item = await requireMerchItem(ctx, args.id);
    if (item.visible === args.visible) {
      return toAdminMerchItem(item);
    }
    await ctx.db.patch("merchItems", item._id, {
      visible: args.visible,
      updatedAt: Date.now(),
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "merch.admin.visibilityChanged",
      targetType: "merchItem",
      targetId: item._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { visible: args.visible },
    });
    return toAdminMerchItem(await requireMerchItem(ctx, item._id));
  },
});

// Swaps an item with its neighbour. Moving past either end is a no-op.
export const move = adminMutation({
  args: { id: v.id("merchItems"), direction: merchMoveDirectionValidator },
  returns: v.array(adminMerchItemValidator),
  handler: async (ctx, args) => {
    const item = await requireMerchItem(ctx, args.id);
    const items = await listMerchItemsInOrder(ctx);
    const index = items.findIndex((row) => row._id === item._id);
    const neighbourIndex = args.direction === "up" ? index - 1 : index + 1;
    // `at` wraps negative indexes, so the first item moving up stops here.
    const neighbour =
      index === -1 || neighbourIndex < 0 ? undefined : items.at(neighbourIndex);
    if (neighbour === undefined) {
      return items.map(toAdminMerchItem);
    }
    let itemOrder = neighbour.sortOrder;
    let neighbourOrder = item.sortOrder;
    if (itemOrder === neighbourOrder) {
      // Imported or hand-edited rows can share a sortOrder, which would make
      // the swap a no-op. Renumber by position first.
      for (const [position, row] of items.entries()) {
        if (row.sortOrder !== position) {
          await ctx.db.patch("merchItems", row._id, { sortOrder: position });
        }
      }
      itemOrder = neighbourIndex;
      neighbourOrder = index;
    }
    const now = Date.now();
    await ctx.db.patch("merchItems", item._id, {
      sortOrder: itemOrder,
      updatedAt: now,
    });
    await ctx.db.patch("merchItems", neighbour._id, {
      sortOrder: neighbourOrder,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "merch.admin.moved",
      targetType: "merchItem",
      targetId: item._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { direction: args.direction },
    });
    const reordered = await listMerchItemsInOrder(ctx);
    return reordered.map(toAdminMerchItem);
  },
});

export const remove = adminMutation({
  args: { id: v.id("merchItems") },
  returns: v.object({ id: v.id("merchItems") }),
  handler: async (ctx, args) => {
    const item = await requireMerchItem(ctx, args.id);
    await ctx.db.delete("merchItems", item._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "merch.admin.deleted",
      targetType: "merchItem",
      targetId: item._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return { id: item._id };
  },
});
