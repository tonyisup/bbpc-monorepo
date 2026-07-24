import { v } from "convex/values";

import { anonymousQuery } from "../functions.js";
import { domainError } from "../lib/errors.js";
import { MAX_RATING_CATALOG_SIZE } from "./limits.js";
import { toRating } from "./readModel.js";
import { ratingValidator } from "./validators.js";
import { validateRatingValue } from "./writeModel.js";

export const getById = anonymousQuery({
  args: { id: v.id("ratings") },
  returns: v.union(ratingValidator, v.null()),
  handler: async (ctx, args) => {
    const rating = await ctx.db.get("ratings", args.id);
    return rating === null ? null : toRating(rating);
  },
});

export const getByValue = anonymousQuery({
  args: { value: v.number() },
  returns: v.union(ratingValidator, v.null()),
  handler: async (ctx, args) => {
    const value = validateRatingValue(args.value);
    const rating = await ctx.db
      .query("ratings")
      .withIndex("by_value", (index) => index.eq("value", value))
      .first();
    return rating === null ? null : toRating(rating);
  },
});

export const list = anonymousQuery({
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
        "The rating catalog exceeds the public read limit.",
        { details: { limit: MAX_RATING_CATALOG_SIZE } },
      );
    }
    return ratings.map(toRating);
  },
});
