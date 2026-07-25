import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel.js";
import { adminMutation, adminQuery } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  MAX_ASSIGNMENTS_PER_EPISODE,
  MAX_ASSIGNMENT_AUDIO_PAGE_SIZE,
  MAX_ASSIGNMENT_WORKBENCH_GUESSES,
  MAX_ASSIGNMENT_WORKBENCH_REVIEWS,
  MAX_ASSIGNMENT_WORKBENCH_WAGERS,
} from "./limits.js";
import { hydrateAssignment } from "./readModel.js";
import {
  assignmentAdminAudioMessageValidator,
  assignmentDetailValidator,
  assignmentTypeValidator,
  assignmentWorkbenchValidator,
} from "./validators.js";
import {
  allocateAssignmentSlug,
  assertAssignmentUnreferenced,
  requireAssignment,
  requireAssignmentParents,
  validateAssignmentType,
  validateRequestedAssignmentSlug,
} from "./writeModel.js";

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

function validateAudioPageSize(numItems: number): void {
  if (
    !Number.isSafeInteger(numItems) ||
    numItems < 1 ||
    numItems > MAX_ASSIGNMENT_AUDIO_PAGE_SIZE
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Assignment audio page size must be an integer from 1 through ${String(MAX_ASSIGNMENT_AUDIO_PAGE_SIZE)}.`,
    );
  }
}

function workbenchUser(user: Doc<"users">) {
  return {
    id: user._id,
    name: nullable(user.name),
    status: user.status,
  };
}

function workbenchRating(rating: Doc<"ratings">) {
  return {
    id: rating._id,
    name: rating.name,
    value: rating.value,
  };
}

function workbenchGamblingStatus(value: string) {
  switch (value) {
    case "pending":
    case "locked":
    case "won":
    case "lost":
    case "rejected":
      return value;
    default:
      domainError(
        "CONFLICT",
        "Assignment workbench found an unsupported wager status.",
      );
  }
}

async function hydrateAudioMessage(
  ctx: Parameters<typeof hydrateAssignment>[0],
  message: Doc<"assignmentAudioMessages">,
) {
  const user = await ctx.db.get("users", message.userId);
  if (user === null) {
    domainError(
      "CONFLICT",
      "Assignment audio message has a missing user relationship.",
      { details: { audioMessageId: message._id } },
    );
  }
  return {
    id: message._id,
    url: message.url,
    createdAt: message.createdAt,
    fileKey: nullable(message.fileKey),
    assignmentId: nullable(message.assignmentId),
    user: {
      id: user._id,
      name: nullable(user.name),
      email: nullable(user.email),
      image: nullable(user.image),
      status: user.status,
    },
  };
}

export const getById = adminQuery({
  args: { id: v.id("assignments") },
  returns: v.union(assignmentDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const assignment = await ctx.db.get("assignments", args.id);
    return assignment === null
      ? null
      : await hydrateAssignment(ctx, assignment);
  },
});

export const getWorkbench = adminQuery({
  args: { id: v.id("assignments") },
  returns: v.union(assignmentWorkbenchValidator, v.null()),
  handler: async (ctx, args) => {
    const assignment = await ctx.db.get("assignments", args.id);
    if (assignment === null) {
      return null;
    }
    const reviewLinks = await ctx.db
      .query("assignmentReviews")
      .withIndex("by_assignmentId", (index) =>
        index.eq("assignmentId", assignment._id),
      )
      .take(MAX_ASSIGNMENT_WORKBENCH_REVIEWS + 1);
    if (reviewLinks.length > MAX_ASSIGNMENT_WORKBENCH_REVIEWS) {
      domainError(
        "CONFLICT",
        "Assignment reviews exceed the workbench read limit.",
        {
          details: {
            limit: MAX_ASSIGNMENT_WORKBENCH_REVIEWS,
            relationship: "assignment reviews",
          },
        },
      );
    }

    let guessCount = 0;
    const reviews = [];
    for (const link of reviewLinks) {
      const review = await ctx.db.get("reviews", link.reviewId);
      if (review === null) {
        domainError(
          "CONFLICT",
          "Assignment workbench found a missing review relationship.",
          { details: { assignmentReviewId: link._id } },
        );
      }
      if (
        review.movieId !== assignment.movieId ||
        review.showId !== undefined
      ) {
        domainError(
          "CONFLICT",
          "Assignment workbench found a review with the wrong media target.",
          { details: { reviewId: review._id } },
        );
      }
      const guesses = await ctx.db
        .query("guesses")
        .withIndex("by_assignmentReviewId", (index) =>
          index.eq("assignmentReviewId", link._id),
        )
        .take(MAX_ASSIGNMENT_WORKBENCH_GUESSES + 1);
      guessCount += guesses.length;
      if (
        guesses.length > MAX_ASSIGNMENT_WORKBENCH_GUESSES ||
        guessCount > MAX_ASSIGNMENT_WORKBENCH_GUESSES
      ) {
        domainError(
          "CONFLICT",
          "Assignment guesses exceed the workbench read limit.",
          {
            details: {
              limit: MAX_ASSIGNMENT_WORKBENCH_GUESSES,
              relationship: "guesses",
            },
          },
        );
      }
      const [reviewer, reviewRating] = await Promise.all([
        review.userId === undefined
          ? null
          : ctx.db.get("users", review.userId),
        review.ratingId === undefined
          ? null
          : ctx.db.get("ratings", review.ratingId),
      ]);
      if (
        (review.userId !== undefined && reviewer === null) ||
        (review.ratingId !== undefined && reviewRating === null)
      ) {
        domainError(
          "CONFLICT",
          "Assignment workbench found a missing review detail.",
          { details: { reviewId: review._id } },
        );
      }
      const hydratedGuesses = [];
      for (const guess of guesses) {
        const [user, rating, season] = await Promise.all([
          ctx.db.get("users", guess.userId),
          ctx.db.get("ratings", guess.ratingId),
          ctx.db.get("seasons", guess.seasonId),
        ]);
        if (user === null || rating === null || season === null) {
          domainError(
            "CONFLICT",
            "Assignment workbench found a missing guess relationship.",
            { details: { guessId: guess._id } },
          );
        }
        hydratedGuesses.push({
          id: guess._id,
          createdAt: guess.createdAt,
          user: workbenchUser(user),
          rating: workbenchRating(rating),
          season: { id: season._id, title: season.title },
          hasPoint: guess.pointId !== undefined,
        });
      }
      reviews.push({
        id: link._id,
        reviewId: review._id,
        reviewer:
          reviewer === null ? null : workbenchUser(reviewer),
        rating:
          reviewRating === null
            ? null
            : workbenchRating(reviewRating),
        reviewedAt: nullable(review.reviewedAt),
        guesses: hydratedGuesses,
      });
    }

    const wagerDocuments = await ctx.db
      .query("gamblingEntries")
      .withIndex("by_assignmentId_and_createdAt", (index) =>
        index.eq("assignmentId", assignment._id),
      )
      .order("desc")
      .take(MAX_ASSIGNMENT_WORKBENCH_WAGERS + 1);
    if (wagerDocuments.length > MAX_ASSIGNMENT_WORKBENCH_WAGERS) {
      domainError(
        "CONFLICT",
        "Assignment wagers exceed the workbench read limit.",
        {
          details: {
            limit: MAX_ASSIGNMENT_WORKBENCH_WAGERS,
            relationship: "wagers",
          },
        },
      );
    }
    const wagers = [];
    for (const wager of wagerDocuments) {
      const [user, targetUser, gamblingType, awardPoint] =
        await Promise.all([
          ctx.db.get("users", wager.userId),
          wager.targetUserId === undefined
            ? null
            : ctx.db.get("users", wager.targetUserId),
          ctx.db.get("gamblingTypes", wager.gamblingTypeId),
          wager.awardPointId === undefined
            ? null
            : ctx.db.get("points", wager.awardPointId),
        ]);
      if (
        user === null ||
        gamblingType === null ||
        (wager.targetUserId !== undefined && targetUser === null) ||
        (wager.awardPointId !== undefined && awardPoint === null)
      ) {
        domainError(
          "CONFLICT",
          "Assignment workbench found a missing wager relationship.",
          { details: { gamblingEntryId: wager._id } },
        );
      }
      wagers.push({
        id: wager._id,
        points: wager.points,
        createdAt: wager.createdAt,
        status: workbenchGamblingStatus(wager.status),
        user: workbenchUser(user),
        targetUser:
          targetUser === null ? null : workbenchUser(targetUser),
        gamblingType: {
          id: gamblingType._id,
          title: gamblingType.title,
          multiplier: gamblingType.multiplier,
        },
        awardAdjustment:
          awardPoint === null ? null : awardPoint.adjustment,
      });
    }
    return {
      assignment: await hydrateAssignment(ctx, assignment),
      reviews,
      wagers,
    };
  },
});

export const listPage = adminQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(assignmentDetailValidator),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("assignments")
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map((assignment) =>
          hydrateAssignment(ctx, assignment),
        ),
      ),
    };
  },
});

export const listForEpisode = adminQuery({
  args: { episodeId: v.id("episodes") },
  returns: v.array(assignmentDetailValidator),
  handler: async (ctx, args) => {
    const episode = await ctx.db.get("episodes", args.episodeId);
    if (episode === null) {
      domainError("NOT_FOUND", "The episode is unavailable.");
    }
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_episodeId", (index) =>
        index.eq("episodeId", episode._id),
      )
      .take(MAX_ASSIGNMENTS_PER_EPISODE + 1);
    if (assignments.length > MAX_ASSIGNMENTS_PER_EPISODE) {
      domainError(
        "CONFLICT",
        "Episode assignments exceed the administrator read limit.",
        {
          details: {
            limit: MAX_ASSIGNMENTS_PER_EPISODE,
            relationship: "assignments",
          },
        },
      );
    }
    return await Promise.all(
      assignments.map((assignment) =>
        hydrateAssignment(ctx, assignment),
      ),
    );
  },
});

export const listAudioMessages = adminQuery({
  args: {
    assignmentId: v.id("assignments"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(
    assignmentAdminAudioMessageValidator,
  ),
  handler: async (ctx, args) => {
    validateAudioPageSize(args.paginationOpts.numItems);
    const assignment = await ctx.db.get(
      "assignments",
      args.assignmentId,
    );
    if (assignment === null) {
      domainError("NOT_FOUND", "The assignment is unavailable.");
    }
    const result = await ctx.db
      .query("assignmentAudioMessages")
      .withIndex("by_assignmentId", (index) =>
        index.eq("assignmentId", args.assignmentId),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map((message) =>
          hydrateAudioMessage(ctx, message),
        ),
      ),
    };
  },
});

export const create = adminMutation({
  args: {
    userId: v.id("users"),
    movieId: v.id("movies"),
    episodeId: v.id("episodes"),
    type: v.string(),
  },
  returns: assignmentDetailValidator,
  handler: async (ctx, args) => {
    const type = validateAssignmentType(args.type);
    const parents = await requireAssignmentParents(ctx, args);
    const slug = await allocateAssignmentSlug(ctx, {
      ...parents,
      assignmentType: type,
    });
    const assignmentId = await ctx.db.insert("assignments", {
      userId: parents.user._id,
      movieId: parents.movie._id,
      episodeId: parents.episode._id,
      type,
      playable: false,
      ...slug,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "assignments.admin.created",
      targetType: "assignment",
      targetId: assignmentId,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { type },
    });
    return await hydrateAssignment(
      ctx,
      await requireAssignment(ctx, assignmentId),
    );
  },
});

export const updateSlug = adminMutation({
  args: {
    id: v.id("assignments"),
    slug: v.optional(v.string()),
    expectedSlug: v.optional(v.union(v.string(), v.null())),
  },
  returns: assignmentDetailValidator,
  handler: async (ctx, args) => {
    const assignment = await requireAssignment(ctx, args.id);
    if (
      args.expectedSlug !== undefined &&
      nullable(assignment.slug) !== args.expectedSlug
    ) {
      domainError(
        "CONFLICT",
        "The assignment slug changed after it was loaded.",
      );
    }
    if (args.slug === undefined) {
      return await hydrateAssignment(ctx, assignment);
    }
    const parents = await requireAssignmentParents(ctx, assignment);
    const slug =
      args.slug.length === 0
        ? await allocateAssignmentSlug(ctx, {
            ...parents,
            assignmentType: validateAssignmentType(assignment.type),
            excludeId: assignment._id,
          })
        : await validateRequestedAssignmentSlug(
            ctx,
            args.slug,
            assignment._id,
          );
    await ctx.db.patch("assignments", assignment._id, slug);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "assignments.admin.slugUpdated",
      targetType: "assignment",
      targetId: assignment._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { regenerated: args.slug.length === 0 },
    });
    return await hydrateAssignment(ctx, { ...assignment, ...slug });
  },
});

export const setType = adminMutation({
  args: {
    id: v.id("assignments"),
    type: v.string(),
    expectedType: v.optional(assignmentTypeValidator),
  },
  returns: assignmentDetailValidator,
  handler: async (ctx, args) => {
    const assignment = await requireAssignment(ctx, args.id);
    if (
      args.expectedType !== undefined &&
      assignment.type !== args.expectedType
    ) {
      domainError(
        "CONFLICT",
        "The assignment type changed after it was loaded.",
      );
    }
    const type = validateAssignmentType(args.type);
    if (assignment.type === type) {
      return await hydrateAssignment(ctx, assignment);
    }
    await ctx.db.patch("assignments", assignment._id, { type });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "assignments.admin.typeUpdated",
      targetType: "assignment",
      targetId: assignment._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { type },
    });
    return await hydrateAssignment(ctx, { ...assignment, type });
  },
});

export const removeIfUnreferenced = adminMutation({
  args: {
    id: v.id("assignments"),
    expected: v.optional(
      v.object({
        type: assignmentTypeValidator,
        slug: v.union(v.string(), v.null()),
        userId: v.id("users"),
        movieId: v.id("movies"),
        episodeId: v.id("episodes"),
      }),
    ),
  },
  returns: v.object({ id: v.id("assignments") }),
  handler: async (ctx, args) => {
    const assignment = await requireAssignment(ctx, args.id);
    if (
      args.expected !== undefined &&
      (assignment.type !== args.expected.type ||
        nullable(assignment.slug) !== args.expected.slug ||
        assignment.userId !== args.expected.userId ||
        assignment.movieId !== args.expected.movieId ||
        assignment.episodeId !== args.expected.episodeId)
    ) {
      domainError(
        "CONFLICT",
        "The assignment changed after deletion was requested.",
      );
    }
    await assertAssignmentUnreferenced(ctx, assignment._id);
    await ctx.db.delete("assignments", assignment._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "assignments.admin.deleted",
      targetType: "assignment",
      targetId: assignment._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return { id: assignment._id };
  },
});

export const removeAudioMessage = adminMutation({
  args: {
    id: v.id("assignmentAudioMessages"),
    expected: v.object({
      assignmentId: v.union(v.id("assignments"), v.null()),
      userId: v.id("users"),
      url: v.string(),
      fileKey: v.union(v.string(), v.null()),
      createdAt: v.number(),
    }),
  },
  returns: v.object({ id: v.id("assignmentAudioMessages") }),
  handler: async (ctx, args) => {
    const message = await ctx.db.get(
      "assignmentAudioMessages",
      args.id,
    );
    if (message === null) {
      domainError(
        "NOT_FOUND",
        "The assignment audio message is unavailable.",
      );
    }
    if (
      nullable(message.assignmentId) !== args.expected.assignmentId ||
      message.userId !== args.expected.userId ||
      message.url !== args.expected.url ||
      nullable(message.fileKey) !== args.expected.fileKey ||
      message.createdAt !== args.expected.createdAt
    ) {
      domainError(
        "CONFLICT",
        "The assignment audio message changed after it was loaded.",
      );
    }
    if (message.fileKey !== undefined) {
      domainError(
        "CONFLICT",
        "The assignment audio file must be removed from its external provider before deleting metadata.",
        { details: { externalCleanupRequired: true } },
      );
    }
    await ctx.db.delete("assignmentAudioMessages", message._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "assignments.admin.audioMessageRemoved",
      targetType: "assignmentAudioMessage",
      targetId: message._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return { id: message._id };
  },
});
