import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import { adminMutation, adminQuery } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import { requireRating } from "../ratings/writeModel.js";
import { validateReviewPageSize } from "./limits.js";
import {
  hydrateAssignmentReview,
  hydrateExtraReview,
  hydrateReviewDetail,
} from "./readModel.js";
import {
  assignmentReviewDetailValidator,
  extraReviewDetailValidator,
  reviewDetailValidator,
} from "./validators.js";
import {
  createReview,
  deleteReviewCascade,
  readReviewCascadeImpact,
  requireAssignment,
  requireAssignmentReview,
  requireEpisode,
  requireReview,
} from "./writeModel.js";

export const getById = adminQuery({
  args: { id: v.id("reviews") },
  returns: v.union(reviewDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const review = await ctx.db.get("reviews", args.id);
    return review === null
      ? null
      : await hydrateReviewDetail(ctx, review);
  },
});

export const listPage = adminQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    ratingId: v.optional(v.id("ratings")),
    unrated: v.optional(v.boolean()),
    userId: v.optional(v.id("users")),
  },
  returns: paginationResultValidator(reviewDetailValidator),
  handler: async (ctx, args) => {
    validateReviewPageSize(args.paginationOpts.numItems);
    if (args.unrated === true && args.ratingId !== undefined) {
      domainError(
        "VALIDATION_FAILED",
        "A review page cannot filter by both a rating and unrated status.",
      );
    }
    const result =
      args.unrated === true && args.userId !== undefined
        ? await ctx.db
            .query("reviews")
            .withIndex(
              "by_ratingId_and_userId_and_reviewedAt",
              (index) =>
                index
                  .eq("ratingId", undefined)
                  .eq("userId", args.userId),
            )
            .order("desc")
            .paginate(args.paginationOpts)
        : args.unrated === true
          ? await ctx.db
              .query("reviews")
              .withIndex(
                "by_ratingId_and_reviewedAt",
                (index) => index.eq("ratingId", undefined),
              )
              .order("desc")
              .paginate(args.paginationOpts)
          : args.ratingId !== undefined && args.userId !== undefined
        ? await ctx.db
            .query("reviews")
            .withIndex(
              "by_ratingId_and_userId_and_reviewedAt",
              (index) =>
                index
                  .eq("ratingId", args.ratingId)
                  .eq("userId", args.userId),
            )
            .order("desc")
            .paginate(args.paginationOpts)
        : args.ratingId !== undefined
          ? await ctx.db
              .query("reviews")
              .withIndex(
                "by_ratingId_and_reviewedAt",
                (index) =>
                  index.eq("ratingId", args.ratingId),
              )
              .order("desc")
              .paginate(args.paginationOpts)
          : args.userId !== undefined
            ? await ctx.db
                .query("reviews")
                .withIndex(
                  "by_userId_and_reviewedAt",
                  (index) =>
                    index.eq("userId", args.userId),
                )
                .order("desc")
                .paginate(args.paginationOpts)
            : await ctx.db
                .query("reviews")
                .withIndex("by_reviewedAt")
                .order("desc")
                .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map((review) =>
          hydrateReviewDetail(ctx, review),
        ),
      ),
    };
  },
});

export const getDeleteImpact = adminQuery({
  args: { id: v.id("reviews") },
  returns: v.object({
    id: v.id("reviews"),
    assignmentReviewCount: v.number(),
    extraReviewCount: v.number(),
    guessCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const review = await requireReview(ctx, args.id);
    return {
      id: review._id,
      ...(await readReviewCascadeImpact(ctx, review)),
    };
  },
});

export const listExtrasForEpisode = adminQuery({
  args: {
    episodeId: v.id("episodes"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(extraReviewDetailValidator),
  handler: async (ctx, args) => {
    validateReviewPageSize(args.paginationOpts.numItems);
    const episode = await ctx.db.get("episodes", args.episodeId);
    if (episode === null) {
      domainError("NOT_FOUND", "The episode is unavailable.");
    }
    const result = await ctx.db
      .query("extraReviews")
      .withIndex("by_episodeId", (index) =>
        index.eq("episodeId", episode._id),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map((link) => hydrateExtraReview(ctx, link)),
      ),
    };
  },
});

export const listForAssignment = adminQuery({
  args: {
    assignmentId: v.id("assignments"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(
    assignmentReviewDetailValidator,
  ),
  handler: async (ctx, args) => {
    validateReviewPageSize(args.paginationOpts.numItems);
    const assignment = await ctx.db.get(
      "assignments",
      args.assignmentId,
    );
    if (assignment === null) {
      domainError("NOT_FOUND", "The assignment is unavailable.");
    }
    const result = await ctx.db
      .query("assignmentReviews")
      .withIndex("by_assignmentId", (index) =>
        index.eq("assignmentId", assignment._id),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map((link) =>
          hydrateAssignmentReview(ctx, link),
        ),
      ),
    };
  },
});

export const createExtra = adminMutation({
  args: {
    userId: v.id("users"),
    movieId: v.optional(v.id("movies")),
    showId: v.optional(v.id("shows")),
    episodeId: v.id("episodes"),
    ratingId: v.optional(v.id("ratings")),
  },
  returns: extraReviewDetailValidator,
  handler: async (ctx, args) => {
    const episode = await requireEpisode(ctx, args.episodeId);
    const review = await createReview(ctx, {
      userId: args.userId,
      ...(args.movieId === undefined
        ? {}
        : { movieId: args.movieId }),
      ...(args.showId === undefined
        ? {}
        : { showId: args.showId }),
      ...(args.ratingId === undefined
        ? {}
        : { ratingId: args.ratingId }),
    });
    const linkId = await ctx.db.insert("extraReviews", {
      reviewId: review._id,
      episodeId: episode._id,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "reviews.admin.extraCreated",
      targetType: "review",
      targetId: review._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    const link = await ctx.db.get("extraReviews", linkId);
    if (link === null) {
      throw new Error("Created extra review link is unavailable.");
    }
    return await hydrateExtraReview(ctx, link);
  },
});

export const createForAssignment = adminMutation({
  args: {
    assignmentId: v.id("assignments"),
    userId: v.id("users"),
    ratingId: v.optional(v.id("ratings")),
  },
  returns: assignmentReviewDetailValidator,
  handler: async (ctx, args) => {
    const assignment = await requireAssignment(
      ctx,
      args.assignmentId,
    );
    const review = await createReview(ctx, {
      userId: args.userId,
      movieId: assignment.movieId,
      ...(args.ratingId === undefined
        ? {}
        : { ratingId: args.ratingId }),
    });
    const linkId = await ctx.db.insert("assignmentReviews", {
      assignmentId: assignment._id,
      reviewId: review._id,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "reviews.admin.assignmentCreated",
      targetType: "review",
      targetId: review._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    const link = await ctx.db.get("assignmentReviews", linkId);
    if (link === null) {
      throw new Error(
        "Created assignment review link is unavailable.",
      );
    }
    return await hydrateAssignmentReview(ctx, link);
  },
});

export const setRating = adminMutation({
  args: {
    reviewId: v.id("reviews"),
    ratingId: v.union(v.id("ratings"), v.null()),
  },
  returns: reviewDetailValidator,
  handler: async (ctx, args) => {
    const review = await requireReview(ctx, args.reviewId);
    const ratingId =
      args.ratingId === null
        ? undefined
        : (await requireRating(ctx, args.ratingId))._id;
    await ctx.db.patch("reviews", review._id, { ratingId });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "reviews.admin.ratingUpdated",
      targetType: "review",
      targetId: review._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { hasRating: ratingId !== undefined },
    });
    return await hydrateReviewDetail(
      ctx,
      await requireReview(ctx, review._id),
    );
  },
});

export const remove = adminMutation({
  args: {
    id: v.id("reviews"),
    expectedImpact: v.optional(
      v.object({
        assignmentReviewCount: v.number(),
        extraReviewCount: v.number(),
        guessCount: v.number(),
      }),
    ),
  },
  returns: v.object({
    id: v.id("reviews"),
    assignmentReviewCount: v.number(),
    extraReviewCount: v.number(),
    guessCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const review = await requireReview(ctx, args.id);
    if (args.expectedImpact !== undefined) {
      const actualImpact = await readReviewCascadeImpact(ctx, review);
      if (
        actualImpact.assignmentReviewCount !==
          args.expectedImpact.assignmentReviewCount ||
        actualImpact.extraReviewCount !==
          args.expectedImpact.extraReviewCount ||
        actualImpact.guessCount !== args.expectedImpact.guessCount
      ) {
        domainError(
          "CONFLICT",
          "The review deletion impact changed after confirmation.",
          { details: { ...actualImpact } },
        );
      }
    }
    const counts = await deleteReviewCascade(ctx, review);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "reviews.admin.deleted",
      targetType: "review",
      targetId: review._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: counts,
    });
    return { id: review._id, ...counts };
  },
});

export const removeAssignmentIfNoGuesses = adminMutation({
  args: { id: v.id("assignmentReviews") },
  returns: v.object({ id: v.id("assignmentReviews") }),
  handler: async (ctx, args) => {
    const link = await requireAssignmentReview(ctx, args.id);
    const guess = await ctx.db
      .query("guesses")
      .withIndex("by_assignmentReviewId", (index) =>
        index.eq("assignmentReviewId", link._id),
      )
      .first();
    if (guess !== null) {
      domainError(
        "CONFLICT",
        "The assignment review cannot be unlinked while guesses exist.",
      );
    }
    await ctx.db.delete("assignmentReviews", link._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "reviews.admin.assignmentUnlinked",
      targetType: "assignmentReview",
      targetId: link._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return { id: link._id };
  },
});
