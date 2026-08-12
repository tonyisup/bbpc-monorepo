import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { internalMigrationMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  ASSIGNMENT_OPERATIONS,
  REVIEW_OPERATIONS,
} from "./constants.js";
import {
  getActiveDomainRun,
  getMigrationCheckpoint,
  migrationCheckpointResult,
  requireCompletedMigrationCheckpoint,
  requireMigrationBatchSize,
  requireMigrationCount,
  requireMigrationOperation,
  requireReconciledDomain,
  saveMigrationCheckpoint,
  startDomainRun,
  writeMigrationBatchAudit,
} from "./runtime.js";

const DOMAIN = "reviews";
const runStatusValidator = v.union(
  v.literal("running"),
  v.literal("transformed"),
  v.literal("reconciled"),
  v.literal("failed"),
);
const checkpointStatusValidator = v.union(
  v.literal("running"),
  v.literal("completed"),
);
const checkpointResultValidator = v.object({
  operation: v.string(),
  status: checkpointStatusValidator,
  processedCount: v.number(),
  insertedCount: v.number(),
  reusedCount: v.number(),
});

type DatabaseContext = Pick<MutationCtx, "db">;
type UpsertOutcome = "inserted" | "reused";

function normalizeUuid(value: string, label: string): string {
  const normalized = value.toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
      normalized,
    )
  ) {
    domainError("VALIDATION_FAILED", `${label} must be a UUID.`);
  }
  return normalized;
}

function requireTinyInt(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 255) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must fit the SQL tinyint range.`,
    );
  }
}

function requireOptionalTimestamp(
  value: number | undefined,
  label: string,
): void {
  if (value !== undefined && !Number.isFinite(value)) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must be a finite timestamp when present.`,
    );
  }
}

export function deriveReviewedAt(
  row: Pick<
    Doc<"migrationRawReviews">,
    "reviewdOn" | "reviewedOn"
  >,
): number | undefined {
  requireOptionalTimestamp(row.reviewdOn, "Review.ReviewdOn");
  requireOptionalTimestamp(row.reviewedOn, "Review.reviewedOn");
  if (
    row.reviewdOn !== undefined &&
    row.reviewedOn !== undefined &&
    row.reviewdOn !== row.reviewedOn
  ) {
    domainError(
      "CONFLICT",
      "A review has conflicting legacy timestamp values.",
    );
  }
  return row.reviewedOn ?? row.reviewdOn;
}

async function resolveOptionalUserId(
  ctx: DatabaseContext,
  legacyId: string | undefined,
): Promise<Id<"users"> | undefined> {
  if (legacyId === undefined) {
    return undefined;
  }
  const user = await ctx.db
    .query("users")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  if (!user) {
    domainError(
      "CONFLICT",
      "A review references a missing canonical user.",
    );
  }
  return user._id;
}

async function resolveOptionalMovieId(
  ctx: DatabaseContext,
  legacyId: string | undefined,
): Promise<Id<"movies"> | undefined> {
  if (legacyId === undefined) {
    return undefined;
  }
  const normalized = normalizeUuid(
    legacyId,
    "Review movie relationship ID",
  );
  const movie = await ctx.db
    .query("movies")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalized),
    )
    .unique();
  if (!movie) {
    domainError(
      "CONFLICT",
      "A review references a missing canonical movie.",
    );
  }
  return movie._id;
}

async function resolveOptionalShowId(
  ctx: DatabaseContext,
  legacyId: string | undefined,
): Promise<Id<"shows"> | undefined> {
  if (legacyId === undefined) {
    return undefined;
  }
  const normalized = normalizeUuid(
    legacyId,
    "Review show relationship ID",
  );
  const show = await ctx.db
    .query("shows")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalized),
    )
    .unique();
  if (!show) {
    domainError(
      "CONFLICT",
      "A review references a missing canonical show.",
    );
  }
  return show._id;
}

async function resolveOptionalRatingId(
  ctx: DatabaseContext,
  legacyId: string | undefined,
): Promise<Id<"ratings"> | undefined> {
  if (legacyId === undefined) {
    return undefined;
  }
  const normalized = normalizeUuid(
    legacyId,
    "Review rating relationship ID",
  );
  const rating = await ctx.db
    .query("ratings")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalized),
    )
    .unique();
  if (!rating) {
    domainError(
      "CONFLICT",
      "A review references a missing canonical rating.",
    );
  }
  return rating._id;
}

async function resolveAssignmentId(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Id<"assignments">> {
  const normalized = normalizeUuid(
    legacyId,
    "Assignment review assignment relationship ID",
  );
  const assignment = await ctx.db
    .query("assignments")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalized),
    )
    .unique();
  if (!assignment) {
    domainError(
      "CONFLICT",
      "An assignment review references a missing assignment.",
    );
  }
  return assignment._id;
}

async function resolveReviewId(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Id<"reviews">> {
  const normalized = normalizeUuid(
    legacyId,
    "Review relationship ID",
  );
  const review = await ctx.db
    .query("reviews")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalized),
    )
    .unique();
  if (!review) {
    domainError(
      "CONFLICT",
      "A review relationship references a missing canonical review.",
    );
  }
  return review._id;
}

async function resolveEpisodeId(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Id<"episodes">> {
  const normalized = normalizeUuid(
    legacyId,
    "Extra review episode relationship ID",
  );
  const episode = await ctx.db
    .query("episodes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalized),
    )
    .unique();
  if (!episode) {
    domainError(
      "CONFLICT",
      "An extra review references a missing canonical episode.",
    );
  }
  return episode._id;
}

async function upsertRating(
  ctx: DatabaseContext,
  row: Doc<"migrationRawRatings">,
): Promise<UpsertOutcome> {
  const legacyId = normalizeUuid(row.legacyId, "Rating legacy ID");
  requireTinyInt(row.value, "Rating value");
  const existing = await ctx.db
    .query("ratings")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  if (existing) {
    const matches =
      existing.name === row.name &&
      existing.value === row.value &&
      existing.sound === row.sound &&
      existing.icon === row.icon &&
      existing.category === row.category;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated rating conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("ratings", {
    legacyId,
    name: row.name,
    value: row.value,
    ...(row.sound === undefined ? {} : { sound: row.sound }),
    ...(row.icon === undefined ? {} : { icon: row.icon }),
    ...(row.category === undefined
      ? {}
      : { category: row.category }),
  });
  return "inserted";
}

async function upsertReview(
  ctx: DatabaseContext,
  row: Doc<"migrationRawReviews">,
): Promise<UpsertOutcome> {
  const legacyId = normalizeUuid(row.legacyId, "Review legacy ID");
  if (
    (row.movieLegacyId === undefined) ===
    (row.showLegacyId === undefined)
  ) {
    domainError(
      "CONFLICT",
      "A migrated review must reference exactly one movie or show.",
    );
  }
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
  const existing = await ctx.db
    .query("reviews")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  if (existing) {
    const matches =
      existing.userId === userId &&
      existing.movieId === movieId &&
      existing.ratingId === ratingId &&
      existing.showId === showId &&
      existing.reviewedAt === reviewedAt;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated review conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("reviews", {
    legacyId,
    ...(userId === undefined ? {} : { userId }),
    ...(movieId === undefined ? {} : { movieId }),
    ...(ratingId === undefined ? {} : { ratingId }),
    ...(showId === undefined ? {} : { showId }),
    ...(reviewedAt === undefined ? {} : { reviewedAt }),
  });
  return "inserted";
}

async function upsertAssignmentReview(
  ctx: DatabaseContext,
  row: Doc<"migrationRawAssignmentReviews">,
): Promise<UpsertOutcome> {
  const legacyId = normalizeUuid(
    row.legacyId,
    "Assignment review legacy ID",
  );
  const assignmentId = await resolveAssignmentId(
    ctx,
    row.assignmentLegacyId,
  );
  const reviewId = await resolveReviewId(
    ctx,
    row.reviewLegacyId,
  );
  const existing = await ctx.db
    .query("assignmentReviews")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  const relationshipCollision = await ctx.db
    .query("assignmentReviews")
    .withIndex("by_assignmentId_and_reviewId", (query) =>
      query
        .eq("assignmentId", assignmentId)
        .eq("reviewId", reviewId),
    )
    .unique();
  if (
    relationshipCollision &&
    relationshipCollision._id !== existing?._id
  ) {
    domainError(
      "CONFLICT",
      "Assignment-review migration produced a duplicate relationship.",
    );
  }
  if (existing) {
    const matches =
      existing.assignmentId === assignmentId &&
      existing.reviewId === reviewId;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated assignment review conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("assignmentReviews", {
    legacyId,
    assignmentId,
    reviewId,
  });
  return "inserted";
}

async function upsertExtraReview(
  ctx: DatabaseContext,
  row: Doc<"migrationRawExtraReviews">,
): Promise<UpsertOutcome> {
  const legacyId = normalizeUuid(
    row.legacyId,
    "Extra review legacy ID",
  );
  const reviewId = await resolveReviewId(
    ctx,
    row.reviewLegacyId,
  );
  const episodeId = await resolveEpisodeId(
    ctx,
    row.episodeLegacyId,
  );
  const existing = await ctx.db
    .query("extraReviews")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  const relationshipCollision = await ctx.db
    .query("extraReviews")
    .withIndex("by_reviewId_and_episodeId", (query) =>
      query.eq("reviewId", reviewId).eq("episodeId", episodeId),
    )
    .unique();
  if (
    relationshipCollision &&
    relationshipCollision._id !== existing?._id
  ) {
    domainError(
      "CONFLICT",
      "Extra-review migration produced a duplicate relationship.",
    );
  }
  if (existing) {
    const matches =
      existing.reviewId === reviewId &&
      existing.episodeId === episodeId;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated extra review conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("extraReviews", {
    legacyId,
    reviewId,
    episodeId,
  });
  return "inserted";
}

export const startReviewRun = internalMigrationMutation({
  args: {
    sourceSchemaFingerprint: v.string(),
    expectedRatings: v.number(),
    expectedReviews: v.number(),
    expectedAssignmentReviews: v.number(),
    expectedExtraReviews: v.number(),
  },
  returns: v.object({
    runId: v.string(),
    status: runStatusValidator,
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      REVIEW_OPERATIONS.start,
    );
    requireMigrationCount(args.expectedRatings, "Expected rating count");
    requireMigrationCount(args.expectedReviews, "Expected review count");
    requireMigrationCount(
      args.expectedAssignmentReviews,
      "Expected assignment review count",
    );
    requireMigrationCount(
      args.expectedExtraReviews,
      "Expected extra review count",
    );
    const runId = ctx.systemState.cutoverRunId;
    for (const domain of ["identity", "catalog", "episodes"]) {
      await requireReconciledDomain(ctx, { runId, domain });
    }
    await requireCompletedMigrationCheckpoint(ctx, {
      runId,
      operation: ASSIGNMENT_OPERATIONS.assignments,
    });
    const result = await startDomainRun(ctx, {
      runId,
      domain: DOMAIN,
      sourceSchemaFingerprint: args.sourceSchemaFingerprint,
      expectedCounts: {
        ratings: args.expectedRatings,
        reviews: args.expectedReviews,
        assignmentReviews: args.expectedAssignmentReviews,
        extraReviews: args.expectedExtraReviews,
      },
    });
    if (result.created) {
      await writeAuditEvent(ctx, {
        actor: ctx.actor,
        action: "migration.reviews.started",
        targetType: "migrationDomainRun",
        targetId: result.domainRun._id,
        cutoverRunId: result.run.runId,
        metadata: {
          expectedRatings: args.expectedRatings,
          expectedReviews: args.expectedReviews,
          expectedAssignmentReviews: args.expectedAssignmentReviews,
          expectedExtraReviews: args.expectedExtraReviews,
        },
      });
    }
    return {
      runId: result.run.runId,
      status: result.domainRun.status,
      created: result.created,
    };
  },
});

export const transformRatingsBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: checkpointResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      REVIEW_OPERATIONS.ratings,
    );
    requireMigrationBatchSize(args.batchSize);
    const runId = ctx.systemState.cutoverRunId;
    await getActiveDomainRun(ctx, { runId, domain: DOMAIN });
    const previous = await getMigrationCheckpoint(
      ctx,
      runId,
      REVIEW_OPERATIONS.ratings,
    );
    if (previous?.status === "completed") {
      return migrationCheckpointResult(previous);
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
    let insertedThisBatch = 0;
    let reusedThisBatch = 0;
    for (const row of batch) {
      const outcome = await upsertRating(ctx, row);
      if (outcome === "inserted") {
        insertedThisBatch += 1;
      } else {
        reusedThisBatch += 1;
      }
    }
    const lastRow = batch.at(-1);
    const checkpoint = await saveMigrationCheckpoint(ctx, {
      runId,
      operation: REVIEW_OPERATIONS.ratings,
      previous,
      ...(lastRow === undefined
        ? {}
        : { lastLegacyKey: lastRow.legacyId }),
      processedThisBatch: batch.length,
      insertedThisBatch,
      reusedThisBatch,
      completed,
    });
    await writeMigrationBatchAudit(ctx, {
      runId,
      domain: DOMAIN,
      operation: REVIEW_OPERATIONS.ratings,
      processedThisBatch: batch.length,
      insertedThisBatch,
      reusedThisBatch,
      completed,
    });
    return migrationCheckpointResult(checkpoint);
  },
});

export const transformReviewsBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: checkpointResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      REVIEW_OPERATIONS.reviews,
    );
    requireMigrationBatchSize(args.batchSize);
    const runId = ctx.systemState.cutoverRunId;
    await getActiveDomainRun(ctx, { runId, domain: DOMAIN });
    await requireCompletedMigrationCheckpoint(ctx, {
      runId,
      operation: REVIEW_OPERATIONS.ratings,
    });
    const previous = await getMigrationCheckpoint(
      ctx,
      runId,
      REVIEW_OPERATIONS.reviews,
    );
    if (previous?.status === "completed") {
      return migrationCheckpointResult(previous);
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
    let insertedThisBatch = 0;
    let reusedThisBatch = 0;
    for (const row of batch) {
      const outcome = await upsertReview(ctx, row);
      if (outcome === "inserted") {
        insertedThisBatch += 1;
      } else {
        reusedThisBatch += 1;
      }
    }
    const lastRow = batch.at(-1);
    const checkpoint = await saveMigrationCheckpoint(ctx, {
      runId,
      operation: REVIEW_OPERATIONS.reviews,
      previous,
      ...(lastRow === undefined
        ? {}
        : { lastLegacyKey: lastRow.legacyId }),
      processedThisBatch: batch.length,
      insertedThisBatch,
      reusedThisBatch,
      completed,
    });
    await writeMigrationBatchAudit(ctx, {
      runId,
      domain: DOMAIN,
      operation: REVIEW_OPERATIONS.reviews,
      processedThisBatch: batch.length,
      insertedThisBatch,
      reusedThisBatch,
      completed,
    });
    return migrationCheckpointResult(checkpoint);
  },
});

export const transformAssignmentReviewsBatch =
  internalMigrationMutation({
    args: { batchSize: v.number() },
    returns: checkpointResultValidator,
    handler: async (ctx, args) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        REVIEW_OPERATIONS.assignmentReviews,
      );
      requireMigrationBatchSize(args.batchSize);
      const runId = ctx.systemState.cutoverRunId;
      await getActiveDomainRun(ctx, { runId, domain: DOMAIN });
      await requireCompletedMigrationCheckpoint(ctx, {
        runId,
        operation: REVIEW_OPERATIONS.reviews,
      });
      await requireCompletedMigrationCheckpoint(ctx, {
        runId,
        operation: ASSIGNMENT_OPERATIONS.assignments,
      });
      const previous = await getMigrationCheckpoint(
        ctx,
        runId,
        REVIEW_OPERATIONS.assignmentReviews,
      );
      if (previous?.status === "completed") {
        return migrationCheckpointResult(previous);
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
      let insertedThisBatch = 0;
      let reusedThisBatch = 0;
      for (const row of batch) {
        const outcome = await upsertAssignmentReview(ctx, row);
        if (outcome === "inserted") {
          insertedThisBatch += 1;
        } else {
          reusedThisBatch += 1;
        }
      }
      const lastRow = batch.at(-1);
      const checkpoint = await saveMigrationCheckpoint(ctx, {
        runId,
        operation: REVIEW_OPERATIONS.assignmentReviews,
        previous,
        ...(lastRow === undefined
          ? {}
          : { lastLegacyKey: lastRow.legacyId }),
        processedThisBatch: batch.length,
        insertedThisBatch,
        reusedThisBatch,
        completed,
      });
      await writeMigrationBatchAudit(ctx, {
        runId,
        domain: DOMAIN,
        operation: REVIEW_OPERATIONS.assignmentReviews,
        processedThisBatch: batch.length,
        insertedThisBatch,
        reusedThisBatch,
        completed,
      });
      return migrationCheckpointResult(checkpoint);
    },
  });

export const transformExtraReviewsBatch =
  internalMigrationMutation({
    args: { batchSize: v.number() },
    returns: checkpointResultValidator,
    handler: async (ctx, args) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        REVIEW_OPERATIONS.extraReviews,
      );
      requireMigrationBatchSize(args.batchSize);
      const runId = ctx.systemState.cutoverRunId;
      await getActiveDomainRun(ctx, { runId, domain: DOMAIN });
      await requireCompletedMigrationCheckpoint(ctx, {
        runId,
        operation: REVIEW_OPERATIONS.reviews,
      });
      const previous = await getMigrationCheckpoint(
        ctx,
        runId,
        REVIEW_OPERATIONS.extraReviews,
      );
      if (previous?.status === "completed") {
        return migrationCheckpointResult(previous);
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
      let insertedThisBatch = 0;
      let reusedThisBatch = 0;
      for (const row of batch) {
        const outcome = await upsertExtraReview(ctx, row);
        if (outcome === "inserted") {
          insertedThisBatch += 1;
        } else {
          reusedThisBatch += 1;
        }
      }
      const lastRow = batch.at(-1);
      const checkpoint = await saveMigrationCheckpoint(ctx, {
        runId,
        operation: REVIEW_OPERATIONS.extraReviews,
        previous,
        ...(lastRow === undefined
          ? {}
          : { lastLegacyKey: lastRow.legacyId }),
        processedThisBatch: batch.length,
        insertedThisBatch,
        reusedThisBatch,
        completed,
      });
      await writeMigrationBatchAudit(ctx, {
        runId,
        domain: DOMAIN,
        operation: REVIEW_OPERATIONS.extraReviews,
        processedThisBatch: batch.length,
        insertedThisBatch,
        reusedThisBatch,
        completed,
      });
      return migrationCheckpointResult(checkpoint);
    },
  });

export const finishReviewRun = internalMigrationMutation({
  args: {},
  returns: v.object({
    runId: v.string(),
    status: v.literal("transformed"),
    ratings: v.number(),
    reviews: v.number(),
    assignmentReviews: v.number(),
    extraReviews: v.number(),
  }),
  handler: async (ctx) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      REVIEW_OPERATIONS.finish,
    );
    const runId = ctx.systemState.cutoverRunId;
    const { domainRun } = await getActiveDomainRun(ctx, {
      runId,
      domain: DOMAIN,
    });
    const ratings = await requireCompletedMigrationCheckpoint(ctx, {
      runId,
      operation: REVIEW_OPERATIONS.ratings,
    });
    const reviews = await requireCompletedMigrationCheckpoint(ctx, {
      runId,
      operation: REVIEW_OPERATIONS.reviews,
    });
    const assignmentReviews =
      await requireCompletedMigrationCheckpoint(ctx, {
        runId,
        operation: REVIEW_OPERATIONS.assignmentReviews,
      });
    const extraReviews =
      await requireCompletedMigrationCheckpoint(ctx, {
        runId,
        operation: REVIEW_OPERATIONS.extraReviews,
      });
    const actualCounts = {
      ratings: ratings.processedCount,
      reviews: reviews.processedCount,
      assignmentReviews: assignmentReviews.processedCount,
      extraReviews: extraReviews.processedCount,
    };
    if (
      Object.entries(actualCounts).some(
        ([key, value]) => domainRun.expectedCounts[key] !== value,
      )
    ) {
      domainError(
        "CONFLICT",
        "Review transform counts do not match source expectations.",
        { details: actualCounts },
      );
    }
    await ctx.db.patch("migrationDomainRuns", domainRun._id, {
      status: "transformed",
      updatedAt: Date.now(),
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "migration.reviews.transformed",
      targetType: "migrationDomainRun",
      targetId: domainRun._id,
      cutoverRunId: runId,
      metadata: actualCounts,
    });
    return {
      runId,
      status: "transformed" as const,
      ...actualCounts,
    };
  },
});
