import { v } from "convex/values";

import { adminMutation, adminQuery } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import { MAX_RATING_CATALOG_SIZE } from "./limits.js";
import { toRating } from "./readModel.js";
import { ratingValidator } from "./validators.js";
import {
  assertRatingUnreferenced,
  requireRating,
  validateOptionalRatingText,
  validateRatingName,
  validateRatingValue,
} from "./writeModel.js";

export const getById = adminQuery({
  args: { id: v.id("ratings") },
  returns: v.union(ratingValidator, v.null()),
  handler: async (ctx, args) => {
    const rating = await ctx.db.get("ratings", args.id);
    return rating === null ? null : toRating(rating);
  },
});

export const list = adminQuery({
  args: {},
  returns: v.array(ratingValidator),
  handler: async (ctx) => {
    const ratings = await ctx.db
      .query("ratings")
      .withIndex("by_value")
      .order("desc")
      .take(MAX_RATING_CATALOG_SIZE + 1);
    if (ratings.length > MAX_RATING_CATALOG_SIZE) {
      domainError(
        "CONFLICT",
        "The rating catalog exceeds the administrator read limit.",
        { details: { limit: MAX_RATING_CATALOG_SIZE } },
      );
    }
    return ratings.map(toRating);
  },
});

export const create = adminMutation({
  args: {
    name: v.string(),
    value: v.number(),
    sound: v.optional(v.string()),
    icon: v.optional(v.string()),
    category: v.optional(v.string()),
  },
  returns: ratingValidator,
  handler: async (ctx, args) => {
    const name = validateRatingName(args.name);
    const value = validateRatingValue(args.value);
    const sound =
      args.sound === undefined
        ? undefined
        : validateOptionalRatingText(args.sound, "Rating sound");
    const icon =
      args.icon === undefined
        ? undefined
        : validateOptionalRatingText(args.icon, "Rating icon");
    const category =
      args.category === undefined
        ? undefined
        : validateOptionalRatingText(
            args.category,
            "Rating category",
          );
    const ratingId = await ctx.db.insert("ratings", {
      name,
      value,
      ...(sound === undefined ? {} : { sound }),
      ...(icon === undefined ? {} : { icon }),
      ...(category === undefined ? {} : { category }),
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "ratings.admin.created",
      targetType: "rating",
      targetId: ratingId,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return toRating(await requireRating(ctx, ratingId));
  },
});

export const update = adminMutation({
  args: {
    id: v.id("ratings"),
    name: v.optional(v.string()),
    value: v.optional(v.number()),
    sound: v.optional(v.union(v.string(), v.null())),
    icon: v.optional(v.union(v.string(), v.null())),
    category: v.optional(v.union(v.string(), v.null())),
  },
  returns: ratingValidator,
  handler: async (ctx, args) => {
    const rating = await requireRating(ctx, args.id);
    const patch: {
      name?: string;
      value?: number;
      sound?: string | undefined;
      icon?: string | undefined;
      category?: string | undefined;
    } = {};
    if (args.name !== undefined) {
      patch.name = validateRatingName(args.name);
    }
    if (args.value !== undefined) {
      patch.value = validateRatingValue(args.value);
    }
    if (args.sound !== undefined) {
      patch.sound = validateOptionalRatingText(
        args.sound,
        "Rating sound",
      );
    }
    if (args.icon !== undefined) {
      patch.icon = validateOptionalRatingText(
        args.icon,
        "Rating icon",
      );
    }
    if (args.category !== undefined) {
      patch.category = validateOptionalRatingText(
        args.category,
        "Rating category",
      );
    }
    const fieldCount = Object.keys(patch).length;
    if (fieldCount === 0) {
      return toRating(rating);
    }
    await ctx.db.patch("ratings", rating._id, patch);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "ratings.admin.updated",
      targetType: "rating",
      targetId: rating._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { fieldCount },
    });
    return toRating(await requireRating(ctx, rating._id));
  },
});

export const removeIfUnreferenced = adminMutation({
  args: { id: v.id("ratings") },
  returns: v.object({ id: v.id("ratings") }),
  handler: async (ctx, args) => {
    const rating = await requireRating(ctx, args.id);
    await assertRatingUnreferenced(ctx, rating._id);
    await ctx.db.delete("ratings", rating._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "ratings.admin.deleted",
      targetType: "rating",
      targetId: rating._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return { id: rating._id };
  },
});
