import { v } from "convex/values";

export const feedbackCategoryValidator = v.union(
  v.literal("bug"),
  v.literal("idea"),
  v.literal("praise"),
  v.literal("other"),
);

export const feedbackStatusValidator = v.union(
  v.literal("new"),
  v.literal("reviewed"),
  v.literal("archived"),
);

export const feedbackSubmitFields = {
  category: feedbackCategoryValidator,
  message: v.string(),
  pagePath: v.union(v.string(), v.null()),
};

export const feedbackSubmitResultValidator = v.object({
  id: v.id("feedback"),
  createdAt: v.number(),
});

export const adminFeedbackValidator = v.object({
  id: v.id("feedback"),
  category: feedbackCategoryValidator,
  message: v.string(),
  pagePath: v.union(v.string(), v.null()),
  status: feedbackStatusValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
  submitter: v.union(
    v.object({
      id: v.id("users"),
      name: v.union(v.string(), v.null()),
      email: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
});

export const adminFeedbackPageValidator = v.object({
  items: v.array(adminFeedbackValidator),
  hasMore: v.boolean(),
});

export const adminFeedbackCountsValidator = v.object({
  new: v.number(),
  reviewed: v.number(),
  archived: v.number(),
  // Each count stops at the cap; a capped count reads as "cap+".
  cap: v.number(),
});
