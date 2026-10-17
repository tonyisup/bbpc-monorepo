import { v } from "convex/values";

import { anonymousQuery } from "../functions.js";
import { MAX_MERCH_ITEMS, toPublicMerchItem } from "./model.js";
import { publicMerchItemValidator } from "./validators.js";

// Visible items in shop order; hidden items are drafts and never leave admin.
export const listVisible = anonymousQuery({
  args: {},
  returns: v.array(publicMerchItemValidator),
  handler: async (ctx) => {
    const items = await ctx.db
      .query("merchItems")
      .withIndex("by_visible_and_sortOrder", (index) =>
        index.eq("visible", true),
      )
      .take(MAX_MERCH_ITEMS);
    return items.map(toPublicMerchItem);
  },
});
