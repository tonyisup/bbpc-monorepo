import { v } from "convex/values";

const nullableStringValidator = v.union(v.string(), v.null());

export const ratingValidator = v.object({
  id: v.id("ratings"),
  name: v.string(),
  value: v.number(),
  sound: nullableStringValidator,
  icon: nullableStringValidator,
  category: nullableStringValidator,
});
