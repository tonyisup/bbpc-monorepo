import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { internalMigrationMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  REVIEW_RECONCILIATION_OPERATIONS,
} from "./constants.js";
import { deriveReviewedAt } from "./reviews.js";
import {
  getMigrationCheckpoint,
  getReconciliationDomainRun,
  reconciliationCheckpointResult,
  requireMigrationBatchSize,
  requireMigrationOperation,
  saveMigrationCheckpoint,
  writeReconciliationBatchAudit,
} from "./runtime.js";

const DOMAIN = "reviews";
const reconciliationResultValidator = v.object({
  operation: v.string(),
  status: v.union(
    v.literal("running"),
    v.literal("completed"),
  ),
  checkedCount: v.number(),
});
type DatabaseContext = Pick<MutationCtx, "db">;

function normalizeUuid(value: string): string {
  return value.toLowerCase();
}

async function resolveOptionalUserId(
  ctx: DatabaseContext,
  legacyId: string | undefined,
): Promise<Id<"users"> | undefined> {
  if (legacyId === undefined) {
    return undefined;
  }
  const document = await ctx.db
    .query("users")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  if (!document) {
    domainError(
      "CONFLICT",
      "Review reconciliation found a missing user parent.",
    );
  }
  return document._id;
}

async function resolveOptionalMovieId(
  ctx: DatabaseContext,
  legacyId: string | undefined,
): Promise<Id<"movies"> | undefined> {
  if (legacyId === undefined) {
    return undefined;
  }
  const document = await ctx.db
    .query("movies")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(legacyId)),
    )
    .unique();
  if (!document) {
    domainError(
      "CONFLICT",
      "Review reconciliation found a missing movie parent.",
    );
  }
  return document._id;
}

async function resolveOptionalShowId(
  ctx: DatabaseContext,
  legacyId: string | undefined,
): Promise<Id<"shows"> | undefined> {
  if (legacyId === undefined) {
    return undefined;
  }
  const document = await ctx.db
    .query("shows")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(legacyId)),
    )
    .unique();
  if (!document) {
    domainError(
      "CONFLICT",
      "Review reconciliation found a missing show parent.",
    );
  }
  return document._id;
}

async function resolveOptionalRatingId(
  ctx: DatabaseContext,
  legacyId: string | undefined,
): Promise<Id<"ratings"> | undefined> {
  if (legacyId === undefined) {
    return undefined;
  }
  const document = await ctx.db
    .query("ratings")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(legacyId)),
    )
    .unique();
  if (!document) {
    domainError(
      "CONFLICT",
      "Review reconciliation found a missing rating parent.",
    );
  }
  return document._id;
}

async function resolveAssignmentId(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Id<"assignments">> {
  const document = await ctx.db
    .query("assignments")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(legacyId)),
    )
    .unique();
  if (!document) {
    domainError(
      "CONFLICT",
      "Review reconciliation found a missing assignment parent.",
    );
  }
  return document._id;
}

async function resolveReviewId(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Id<"reviews">> {
  const document = await ctx.db
    .query("reviews")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(legacyId)),
    )
    .unique();
  if (!document) {
    domainError(
      "CONFLICT",
      "Review reconciliation found a missing review parent.",
    );
  }
  return document._id;
}

async function resolveEpisodeId(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Id<"episodes">> {
  const document = await ctx.db
    .query("episodes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(legacyId)),
    )
    .unique();
  if (!document) {
    domainError(
      "CONFLICT",
      "Review reconciliation found a missing episode parent.",
    );
  }
  return document._id;
}

async function verifyRating(
  ctx: DatabaseContext,
  row: Doc<"migrationRawRatings">,
): Promise<void> {
  const canonical = await ctx.db
    .query("ratings")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(row.legacyId)),
    )
    .unique();
  if (
    canonical?.name !== row.name ||
    canonical.value !== row.value ||
    canonical.sound !== row.sound ||
    canonical.icon !== row.icon ||
    canonical.category !== row.category
  ) {
    domainError(
      "CONFLICT",
      "Review reconciliation found a rating mismatch.",
    );
  }
}

async function verifyReview(
  ctx: DatabaseContext,
  row: Doc<"migrationRawReviews">,
): Promise<void> {
  const userId = await resolveOptionalUserId(
    ctx,
    row.userLegacyId,
  );
  const movieId = await resolveOptionalMovieId(
    ctx,
    row.movieLegacyId,
  );
  const ratingId = await resolveOptionalRatingId(
    ctx,
    row.ratingLegacyId,
  );
  const showId = await resolveOptionalShowId(
    ctx,
    row.showLegacyId,
  );
  const reviewedAt = deriveReviewedAt(row);
  const canonical = await ctx.db
    .query("reviews")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(row.legacyId)),
    )
    .unique();
  if (
    canonical?.userId !== userId ||
    canonical?.movieId !== movieId ||
    canonical?.ratingId !== ratingId ||
    canonical?.showId !== showId ||
    canonical?.reviewedAt !== reviewedAt
  ) {
    domainError(
      "CONFLICT",
      "Review reconciliation found a review mismatch.",
    );
  }
}

async function verifyAssignmentReview(
  ctx: DatabaseContext,
  row: Doc<"migrationRawAssignmentReviews">,
): Promise<void> {
  const assignmentId = await resolveAssignmentId(
    ctx,
    row.assignmentLegacyId,
  );
  const reviewId = await resolveReviewId(
    ctx,
    row.reviewLegacyId,
  );
  const canonical = await ctx.db
    .query("assignmentReviews")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(row.legacyId)),
    )
    .unique();
  if (
    canonical?.assignmentId !== assignmentId ||
    canonical.reviewId !== reviewId
  ) {
    domainError(
      "CONFLICT",
      "Review reconciliation found an assignment-review mismatch.",
    );
  }
}

async function verifyExtraReview(
  ctx: DatabaseContext,
  row: Doc<"migrationRawExtraReviews">,
): Promise<void> {
  const reviewId = await resolveReviewId(
    ctx,
    row.reviewLegacyId,
  );
  const episodeId = await resolveEpisodeId(
    ctx,
    row.episodeLegacyId,
  );
  const canonical = await ctx.db
    .query("extraReviews")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(row.legacyId)),
    )
    .unique();
  if (
    canonical?.reviewId !== reviewId ||
    canonical.episodeId !== episodeId
  ) {
    domainError(
      "CONFLICT",
      "Review reconciliation found an extra-review mismatch.",
    );
  }
}

export const reconcileRatingsBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: reconciliationResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      REVIEW_RECONCILIATION_OPERATIONS.ratings,
    );
    requireMigrationBatchSize(args.batchSize);
    const runId = ctx.systemState.cutoverRunId;
    await getReconciliationDomainRun(ctx, {
      runId,
      domain: DOMAIN,
    });
    const previous = await getMigrationCheckpoint(
      ctx,
      runId,
      REVIEW_RECONCILIATION_OPERATIONS.ratings,
    );
    if (previous?.status === "completed") {
      return reconciliationCheckpointResult(previous);
    }
    const rows = await ctx.db
      .query("migrationRawRatings")
      .withIndex("by_runId_and_legacyId", (query) => {
        const range = query.eq("runId", runId);
        return previous?.lastLegacyKey === undefined
          ? range
          : range.gt("legacyId", previous.lastLegacyKey);
      })
      .take(args.batchSize + 1);
    const batch = rows.slice(0, args.batchSize);
    const completed = rows.length <= args.batchSize;
    for (const row of batch) {
      await verifyRating(ctx, row);
    }
    const lastRow = batch.at(-1);
    const checkpoint = await saveMigrationCheckpoint(ctx, {
      runId,
      operation: REVIEW_RECONCILIATION_OPERATIONS.ratings,
      previous,
      ...(lastRow === undefined
        ? {}
        : { lastLegacyKey: lastRow.legacyId }),
      processedThisBatch: batch.length,
      insertedThisBatch: 0,
      reusedThisBatch: batch.length,
      completed,
    });
    await writeReconciliationBatchAudit(ctx, {
      runId,
      domain: DOMAIN,
      operation: REVIEW_RECONCILIATION_OPERATIONS.ratings,
      checkedThisBatch: batch.length,
      completed,
    });
    return reconciliationCheckpointResult(checkpoint);
  },
});

export const reconcileReviewsBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: reconciliationResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      REVIEW_RECONCILIATION_OPERATIONS.reviews,
    );
    requireMigrationBatchSize(args.batchSize);
    const runId = ctx.systemState.cutoverRunId;
    await getReconciliationDomainRun(ctx, {
      runId,
      domain: DOMAIN,
    });
    const previous = await getMigrationCheckpoint(
      ctx,
      runId,
      REVIEW_RECONCILIATION_OPERATIONS.reviews,
    );
    if (previous?.status === "completed") {
      return reconciliationCheckpointResult(previous);
    }
    const rows = await ctx.db
      .query("migrationRawReviews")
      .withIndex("by_runId_and_legacyId", (query) => {
        const range = query.eq("runId", runId);
        return previous?.lastLegacyKey === undefined
          ? range
          : range.gt("legacyId", previous.lastLegacyKey);
      })
      .take(args.batchSize + 1);
    const batch = rows.slice(0, args.batchSize);
    const completed = rows.length <= args.batchSize;
    for (const row of batch) {
      await verifyReview(ctx, row);
    }
    const lastRow = batch.at(-1);
    const checkpoint = await saveMigrationCheckpoint(ctx, {
      runId,
      operation: REVIEW_RECONCILIATION_OPERATIONS.reviews,
      previous,
      ...(lastRow === undefined
        ? {}
        : { lastLegacyKey: lastRow.legacyId }),
      processedThisBatch: batch.length,
      insertedThisBatch: 0,
      reusedThisBatch: batch.length,
      completed,
    });
    await writeReconciliationBatchAudit(ctx, {
      runId,
      domain: DOMAIN,
      operation: REVIEW_RECONCILIATION_OPERATIONS.reviews,
      checkedThisBatch: batch.length,
      completed,
    });
    return reconciliationCheckpointResult(checkpoint);
  },
});

export const reconcileAssignmentReviewsBatch =
  internalMigrationMutation({
    args: { batchSize: v.number() },
    returns: reconciliationResultValidator,
    handler: async (ctx, args) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        REVIEW_RECONCILIATION_OPERATIONS.assignmentReviews,
      );
      requireMigrationBatchSize(args.batchSize);
      const runId = ctx.systemState.cutoverRunId;
      await getReconciliationDomainRun(ctx, {
        runId,
        domain: DOMAIN,
      });
      const previous = await getMigrationCheckpoint(
        ctx,
        runId,
        REVIEW_RECONCILIATION_OPERATIONS.assignmentReviews,
      );
      if (previous?.status === "completed") {
        return reconciliationCheckpointResult(previous);
      }
      const rows = await ctx.db
        .query("migrationRawAssignmentReviews")
        .withIndex("by_runId_and_legacyId", (query) => {
          const range = query.eq("runId", runId);
          return previous?.lastLegacyKey === undefined
            ? range
            : range.gt("legacyId", previous.lastLegacyKey);
        })
        .take(args.batchSize + 1);
      const batch = rows.slice(0, args.batchSize);
      const completed = rows.length <= args.batchSize;
      for (const row of batch) {
        await verifyAssignmentReview(ctx, row);
      }
      const lastRow = batch.at(-1);
      const checkpoint = await saveMigrationCheckpoint(ctx, {
        runId,
        operation:
          REVIEW_RECONCILIATION_OPERATIONS.assignmentReviews,
        previous,
        ...(lastRow === undefined
          ? {}
          : { lastLegacyKey: lastRow.legacyId }),
        processedThisBatch: batch.length,
        insertedThisBatch: 0,
        reusedThisBatch: batch.length,
        completed,
      });
      await writeReconciliationBatchAudit(ctx, {
        runId,
        domain: DOMAIN,
        operation:
          REVIEW_RECONCILIATION_OPERATIONS.assignmentReviews,
        checkedThisBatch: batch.length,
        completed,
      });
      return reconciliationCheckpointResult(checkpoint);
    },
  });

export const reconcileExtraReviewsBatch =
  internalMigrationMutation({
    args: { batchSize: v.number() },
    returns: reconciliationResultValidator,
    handler: async (ctx, args) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        REVIEW_RECONCILIATION_OPERATIONS.extraReviews,
      );
      requireMigrationBatchSize(args.batchSize);
      const runId = ctx.systemState.cutoverRunId;
      await getReconciliationDomainRun(ctx, {
        runId,
        domain: DOMAIN,
      });
      const previous = await getMigrationCheckpoint(
        ctx,
        runId,
        REVIEW_RECONCILIATION_OPERATIONS.extraReviews,
      );
      if (previous?.status === "completed") {
        return reconciliationCheckpointResult(previous);
      }
      const rows = await ctx.db
        .query("migrationRawExtraReviews")
        .withIndex("by_runId_and_legacyId", (query) => {
          const range = query.eq("runId", runId);
          return previous?.lastLegacyKey === undefined
            ? range
            : range.gt("legacyId", previous.lastLegacyKey);
        })
        .take(args.batchSize + 1);
      const batch = rows.slice(0, args.batchSize);
      const completed = rows.length <= args.batchSize;
      for (const row of batch) {
        await verifyExtraReview(ctx, row);
      }
      const lastRow = batch.at(-1);
      const checkpoint = await saveMigrationCheckpoint(ctx, {
        runId,
        operation: REVIEW_RECONCILIATION_OPERATIONS.extraReviews,
        previous,
        ...(lastRow === undefined
          ? {}
          : { lastLegacyKey: lastRow.legacyId }),
        processedThisBatch: batch.length,
        insertedThisBatch: 0,
        reusedThisBatch: batch.length,
        completed,
      });
      await writeReconciliationBatchAudit(ctx, {
        runId,
        domain: DOMAIN,
        operation: REVIEW_RECONCILIATION_OPERATIONS.extraReviews,
        checkedThisBatch: batch.length,
        completed,
      });
      return reconciliationCheckpointResult(checkpoint);
    },
  });

export const finishReviewReconciliation =
  internalMigrationMutation({
    args: {},
    returns: v.object({
      runId: v.string(),
      status: v.literal("reconciled"),
      ratings: v.number(),
      reviews: v.number(),
      assignmentReviews: v.number(),
      extraReviews: v.number(),
    }),
    handler: async (ctx) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        REVIEW_RECONCILIATION_OPERATIONS.finish,
      );
      const runId = ctx.systemState.cutoverRunId;
      const { domainRun } = await getReconciliationDomainRun(ctx, {
        runId,
        domain: DOMAIN,
      });
      const ratings = await getMigrationCheckpoint(
        ctx,
        runId,
        REVIEW_RECONCILIATION_OPERATIONS.ratings,
      );
      const reviews = await getMigrationCheckpoint(
        ctx,
        runId,
        REVIEW_RECONCILIATION_OPERATIONS.reviews,
      );
      const assignmentReviews = await getMigrationCheckpoint(
        ctx,
        runId,
        REVIEW_RECONCILIATION_OPERATIONS.assignmentReviews,
      );
      const extraReviews = await getMigrationCheckpoint(
        ctx,
        runId,
        REVIEW_RECONCILIATION_OPERATIONS.extraReviews,
      );
      if (
        ratings?.status !== "completed" ||
        reviews?.status !== "completed" ||
        assignmentReviews?.status !== "completed" ||
        extraReviews?.status !== "completed"
      ) {
        domainError(
          "CONFLICT",
          "Every review reconciliation checkpoint must be complete.",
        );
      }
      const actualCounts = {
        ratings: ratings.reusedCount,
        reviews: reviews.reusedCount,
        assignmentReviews: assignmentReviews.reusedCount,
        extraReviews: extraReviews.reusedCount,
      };
      if (
        Object.entries(actualCounts).some(
          ([key, value]) => domainRun.expectedCounts[key] !== value,
        )
      ) {
        domainError(
          "CONFLICT",
          "Review reconciliation counts do not match source expectations.",
          { details: actualCounts },
        );
      }
      if (domainRun.status !== "reconciled") {
        await ctx.db.patch("migrationDomainRuns", domainRun._id, {
          status: "reconciled",
          updatedAt: Date.now(),
        });
        await writeAuditEvent(ctx, {
          actor: ctx.actor,
          action: "migration.reviews.reconciled",
          targetType: "migrationDomainRun",
          targetId: domainRun._id,
          cutoverRunId: runId,
          metadata: actualCounts,
        });
      }
      return {
        runId,
        status: "reconciled" as const,
        ...actualCounts,
      };
    },
  });
