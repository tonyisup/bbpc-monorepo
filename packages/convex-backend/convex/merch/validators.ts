import { v } from "convex/values";

const nullableStringValidator = v.union(v.string(), v.null());

export const merchMoveDirectionValidator = v.union(
  v.literal("up"),
  v.literal("down"),
);

export const merchItemInputFields = {
  title: v.string(),
  description: nullableStringValidator,
  url: v.string(),
  imageUrl: nullableStringValidator,
  priceLabel: nullableStringValidator,
  badge: nullableStringValidator,
  featured: v.boolean(),
  visible: v.boolean(),
};

export const publicMerchItemValidator = v.object({
  id: v.id("merchItems"),
  title: v.string(),
  description: nullableStringValidator,
  url: v.string(),
  imageUrl: nullableStringValidator,
  priceLabel: nullableStringValidator,
  badge: nullableStringValidator,
  featured: v.boolean(),
  updatedAt: v.number(),
});

export const adminMerchItemValidator = publicMerchItemValidator.extend({
  visible: v.boolean(),
  sortOrder: v.number(),
  createdAt: v.number(),
});
