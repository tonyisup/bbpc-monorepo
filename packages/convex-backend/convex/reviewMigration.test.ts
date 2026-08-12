/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { internal } from "./_generated/api.js";
import {
  ASSIGNMENT_OPERATIONS,
  REVIEW_OPERATIONS,
  REVIEW_RECONCILIATION_OPERATIONS,
  SOURCE_SCHEMA_FINGERPRINT,
} from "./migration/constants.js";
import { deriveReviewedAt } from "./migration/reviews.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const RUN_ID = "review-migration-test-001";
const USER_ID = "legacy-review-user";
const ASSIGNMENT_ID =
  "00000000-0000-0000-0000-000000000301";
const EPISODE_ID =
  "00000000-0000-0000-0000-000000000311";
const MOVIE_ID = "00000000-0000-0000-0000-000000000321";
const SHOW_ID = "00000000-0000-0000-0000-000000000331";
const RATING_ID = "00000000-0000-0000-0000-000000000341";
const REVIEW_ID_A =
  "00000000-0000-0000-0000-000000000351";
const REVIEW_ID_B =
  "00000000-0000-0000-0000-000000000352";
const ASSIGNMENT_REVIEW_ID =
  "00000000-0000-0000-0000-000000000361";
const ASSIGNMENT_REVIEW_ID_B =
  "00000000-0000-0000-0000-000000000362";
const EXTRA_REVIEW_ID =
  "00000000-0000-0000-0000-000000000371";
const EXTRA_REVIEW_ID_B =
  "00000000-0000-0000-0000-000000000372";

function createTestBackend() {
  return convexTest(schema, modules);
}

type TestBackend = ReturnType<typeof createTestBackend>;

async function expectDomainError(
  promise: Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ConvexError);
    if (!(error instanceof ConvexError)) {
      throw error;
    }
    expect(error.data).toMatchObject({ code: expectedCode });
    return;
  }
  throw new Error(`Expected domain error ${expectedCode}`);
}

async function initializeAtS1(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "review-migration-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "review-migration-test",
  });
}

async function seedPrerequisites(
  t: TestBackend,
  includeAssignmentCheckpoint = true,
) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("migrationRuns", {
      runId: RUN_ID,
      sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
      status: "running",
      startedAt: 1,
      updatedAt: 1,
    });
    for (const domain of ["identity", "catalog", "episodes"]) {
      await ctx.db.insert("migrationDomainRuns", {
        runId: RUN_ID,
        domain,
        status: "reconciled",
        expectedCounts: {},
        startedAt: 1,
        updatedAt: 1,
      });
    }
    const userId = await ctx.db.insert("users", {
      legacyId: USER_ID,
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const episodeId = await ctx.db.insert("episodes", {
      legacyId: EPISODE_ID,
      number: 1,
      title: "Synthetic Episode",
    });
    const movieId = await ctx.db.insert("movies", {
      legacyId: MOVIE_ID,
      title: "Synthetic Movie",
      normalizedTitle: "synthetic movie",
      year: 2025,
      url: "https://example.test/movie",
    });
    const showId = await ctx.db.insert("shows", {
      legacyId: SHOW_ID,
      title: "Synthetic Show",
      normalizedTitle: "synthetic show",
      year: 2025,
      url: "https://example.test/show",
    });
    const assignmentId = await ctx.db.insert("assignments", {
      legacyId: ASSIGNMENT_ID,
      userId,
      episodeId,
      movieId,
      type: "HOMEWORK",
      playable: true,
    });
    if (includeAssignmentCheckpoint) {
      await ctx.db.insert("migrationCheckpoints", {
        runId: RUN_ID,
        operation: ASSIGNMENT_OPERATIONS.assignments,
        status: "completed",
        processedCount: 1,
        insertedCount: 1,
        reusedCount: 0,
        lastLegacyKey: ASSIGNMENT_ID,
        updatedAt: 1,
      });
    }
    return {
      userId,
      episodeId,
      movieId,
      showId,
      assignmentId,
    };
  });
}

async function seedRawRows(t: TestBackend): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("migrationRawRatings", {
      runId: RUN_ID,
      legacyId: RATING_ID,
      name: "Excellent",
      value: 5,
      sound: "https://example.test/rating.mp3",
      icon: "star",
      category: "positive",
      sourceRowHash: "sha256:rating",
    });
    await ctx.db.insert("migrationRawReviews", {
      runId: RUN_ID,
      legacyId: REVIEW_ID_A,
      userLegacyId: USER_ID,
      movieLegacyId: MOVIE_ID,
      ratingLegacyId: RATING_ID,
      reviewdOn: 1_700_000_000_000,
      sourceRowHash: "sha256:review-a",
    });
    await ctx.db.insert("migrationRawReviews", {
      runId: RUN_ID,
      legacyId: REVIEW_ID_B,
      showLegacyId: SHOW_ID,
      reviewdOn: 1_700_000_000_001,
      reviewedOn: 1_700_000_000_001,
      sourceRowHash: "sha256:review-b",
    });
    await ctx.db.insert("migrationRawAssignmentReviews", {
      runId: RUN_ID,
      legacyId: ASSIGNMENT_REVIEW_ID,
      assignmentLegacyId: ASSIGNMENT_ID,
      reviewLegacyId: REVIEW_ID_A,
      sourceRowHash: "sha256:assignment-review",
    });
    await ctx.db.insert("migrationRawExtraReviews", {
      runId: RUN_ID,
      legacyId: EXTRA_REVIEW_ID,
      reviewLegacyId: REVIEW_ID_B,
      episodeLegacyId: EPISODE_ID,
      sourceRowHash: "sha256:extra-review",
    });
  });
}

async function startRun(
  t: TestBackend,
  counts = {
    ratings: 1,
    reviews: 2,
    assignmentReviews: 1,
    extraReviews: 1,
  },
) {
  return await t.mutation(
    internal.migration.reviews.startReviewRun,
    {
      cutoverRunId: RUN_ID,
      operationId: REVIEW_OPERATIONS.start,
      sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
      expectedRatings: counts.ratings,
      expectedReviews: counts.reviews,
      expectedAssignmentReviews: counts.assignmentReviews,
      expectedExtraReviews: counts.extraReviews,
    },
  );
}

async function transformAll(
  t: TestBackend,
  batchSize = 100,
): Promise<void> {
  await t.mutation(
    internal.migration.reviews.transformRatingsBatch,
    {
      cutoverRunId: RUN_ID,
      operationId: REVIEW_OPERATIONS.ratings,
      batchSize,
    },
  );
  await t.mutation(
    internal.migration.reviews.transformReviewsBatch,
    {
      cutoverRunId: RUN_ID,
      operationId: REVIEW_OPERATIONS.reviews,
      batchSize,
    },
  );
  await t.mutation(
    internal.migration.reviews.transformAssignmentReviewsBatch,
    {
      cutoverRunId: RUN_ID,
      operationId: REVIEW_OPERATIONS.assignmentReviews,
      batchSize,
    },
  );
  await t.mutation(
    internal.migration.reviews.transformExtraReviewsBatch,
    {
      cutoverRunId: RUN_ID,
      operationId: REVIEW_OPERATIONS.extraReviews,
      batchSize,
    },
  );
}

async function reconcileAll(t: TestBackend): Promise<void> {
  await t.mutation(
    internal.migration.reviewReconciliation
      .reconcileRatingsBatch,
    {
      cutoverRunId: RUN_ID,
      operationId: REVIEW_RECONCILIATION_OPERATIONS.ratings,
      batchSize: 100,
    },
  );
  await t.mutation(
    internal.migration.reviewReconciliation
      .reconcileReviewsBatch,
    {
      cutoverRunId: RUN_ID,
      operationId: REVIEW_RECONCILIATION_OPERATIONS.reviews,
      batchSize: 100,
    },
  );
  await t.mutation(
    internal.migration.reviewReconciliation
      .reconcileAssignmentReviewsBatch,
    {
      cutoverRunId: RUN_ID,
      operationId:
        REVIEW_RECONCILIATION_OPERATIONS.assignmentReviews,
      batchSize: 100,
    },
  );
  await t.mutation(
    internal.migration.reviewReconciliation
      .reconcileExtraReviewsBatch,
    {
      cutoverRunId: RUN_ID,
      operationId:
        REVIEW_RECONCILIATION_OPERATIONS.extraReviews,
      batchSize: 100,
    },
  );
}

describe("review migration slice", () => {
  test("derives absent and corrected-only review timestamps", () => {
    expect(deriveReviewedAt({})).toBeUndefined();
    expect(deriveReviewedAt({ reviewedOn: 42 })).toBe(42);
  });

  test("transforms both review target shapes and independently reconciles", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await seedPrerequisites(t);
    await seedRawRows(t);
    await expect(startRun(t)).resolves.toMatchObject({
      created: true,
      status: "running",
    });
    await expect(startRun(t)).resolves.toMatchObject({
      created: false,
    });
    await t.mutation(
      internal.migration.reviews.transformRatingsBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: REVIEW_OPERATIONS.ratings,
        batchSize: 10,
      },
    );
    await expect(
      t.mutation(
        internal.migration.reviews.transformReviewsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: REVIEW_OPERATIONS.reviews,
          batchSize: 1,
        },
      ),
    ).resolves.toMatchObject({
      status: "running",
      processedCount: 1,
    });
    await expect(
      t.mutation(
        internal.migration.reviews.transformReviewsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: REVIEW_OPERATIONS.reviews,
          batchSize: 1,
        },
      ),
    ).resolves.toMatchObject({
      status: "completed",
      processedCount: 2,
    });
    await t.mutation(
      internal.migration.reviews.transformAssignmentReviewsBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: REVIEW_OPERATIONS.assignmentReviews,
        batchSize: 10,
      },
    );
    await t.mutation(
      internal.migration.reviews.transformExtraReviewsBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: REVIEW_OPERATIONS.extraReviews,
        batchSize: 10,
      },
    );
    await expect(
      t.mutation(internal.migration.reviews.finishReviewRun, {
        cutoverRunId: RUN_ID,
        operationId: REVIEW_OPERATIONS.finish,
      }),
    ).resolves.toEqual({
      runId: RUN_ID,
      status: "transformed",
      ratings: 1,
      reviews: 2,
      assignmentReviews: 1,
      extraReviews: 1,
    });

    const snapshot = await t.run(async (ctx) => {
      const movieReview = await ctx.db
        .query("reviews")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", REVIEW_ID_A),
        )
        .unique();
      const showReview = await ctx.db
        .query("reviews")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", REVIEW_ID_B),
        )
        .unique();
      return { movieReview, showReview };
    });
    expect(snapshot.movieReview).toMatchObject({
      reviewedAt: 1_700_000_000_000,
    });
    expect(snapshot.movieReview?.movieId).toBeDefined();
    expect(snapshot.movieReview?.showId).toBeUndefined();
    expect(snapshot.showReview?.showId).toBeDefined();
    expect(snapshot.showReview?.movieId).toBeUndefined();

    await reconcileAll(t);
    const reconciled = await t.mutation(
      internal.migration.reviewReconciliation
        .finishReviewReconciliation,
      {
        cutoverRunId: RUN_ID,
        operationId: REVIEW_RECONCILIATION_OPERATIONS.finish,
      },
    );
    expect(reconciled).toEqual({
      runId: RUN_ID,
      status: "reconciled",
      ratings: 1,
      reviews: 2,
      assignmentReviews: 1,
      extraReviews: 1,
    });
    await expect(
      t.mutation(
        internal.migration.reviewReconciliation
          .finishReviewReconciliation,
        {
          cutoverRunId: RUN_ID,
          operationId:
            REVIEW_RECONCILIATION_OPERATIONS.finish,
        },
      ),
    ).resolves.toEqual(reconciled);
  });

  test("requires the assignment-core checkpoint and operation gates", async () => {
    const missing = createTestBackend();
    await initializeAtS1(missing);
    await seedPrerequisites(missing, false);
    await expectDomainError(startRun(missing), "CONFLICT");

    const t = createTestBackend();
    await initializeAtS1(t);
    await seedPrerequisites(t);
    await expectDomainError(
      t.mutation(internal.migration.reviews.startReviewRun, {
        cutoverRunId: RUN_ID,
        operationId: "reviews.wrong",
        sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
        expectedRatings: 0,
        expectedReviews: 0,
        expectedAssignmentReviews: 0,
        expectedExtraReviews: 0,
      }),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      startRun(t, {
        ratings: -1,
        reviews: 0,
        assignmentReviews: 0,
        extraReviews: 0,
      }),
      "VALIDATION_FAILED",
    );
    await startRun(t, {
      ratings: 0,
      reviews: 0,
      assignmentReviews: 0,
      extraReviews: 0,
    });
    await expectDomainError(
      t.mutation(
        internal.migration.reviews.transformReviewsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: REVIEW_OPERATIONS.reviews,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.reviews.transformRatingsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: REVIEW_OPERATIONS.reviews,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.reviews.transformRatingsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: REVIEW_OPERATIONS.ratings,
          batchSize: 101,
        },
      ),
      "VALIDATION_FAILED",
    );
  });

  test("rejects invalid targets, timestamps, and rating bounds", async () => {
    const invalidTarget = createTestBackend();
    await initializeAtS1(invalidTarget);
    await seedPrerequisites(invalidTarget);
    await invalidTarget.run(async (ctx) => {
      await ctx.db.insert("migrationRawReviews", {
        runId: RUN_ID,
        legacyId: REVIEW_ID_A,
        movieLegacyId: MOVIE_ID,
        showLegacyId: SHOW_ID,
        sourceRowHash: "sha256:both-targets",
      });
    });
    await startRun(invalidTarget, {
      ratings: 0,
      reviews: 1,
      assignmentReviews: 0,
      extraReviews: 0,
    });
    await invalidTarget.mutation(
      internal.migration.reviews.transformRatingsBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: REVIEW_OPERATIONS.ratings,
        batchSize: 10,
      },
    );
    await expectDomainError(
      invalidTarget.mutation(
        internal.migration.reviews.transformReviewsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: REVIEW_OPERATIONS.reviews,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    const timestamps = createTestBackend();
    await initializeAtS1(timestamps);
    await seedPrerequisites(timestamps);
    await timestamps.run(async (ctx) => {
      await ctx.db.insert("migrationRawReviews", {
        runId: RUN_ID,
        legacyId: REVIEW_ID_A,
        movieLegacyId: MOVIE_ID,
        reviewdOn: 1,
        reviewedOn: 2,
        sourceRowHash: "sha256:timestamp-conflict",
      });
    });
    await startRun(timestamps, {
      ratings: 0,
      reviews: 1,
      assignmentReviews: 0,
      extraReviews: 0,
    });
    await timestamps.mutation(
      internal.migration.reviews.transformRatingsBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: REVIEW_OPERATIONS.ratings,
        batchSize: 10,
      },
    );
    await expectDomainError(
      timestamps.mutation(
        internal.migration.reviews.transformReviewsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: REVIEW_OPERATIONS.reviews,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    const rating = createTestBackend();
    await initializeAtS1(rating);
    await seedPrerequisites(rating);
    await rating.run(async (ctx) => {
      await ctx.db.insert("migrationRawRatings", {
        runId: RUN_ID,
        legacyId: RATING_ID,
        name: "Invalid",
        value: 256,
        sourceRowHash: "sha256:invalid-rating",
      });
    });
    await startRun(rating, {
      ratings: 1,
      reviews: 0,
      assignmentReviews: 0,
      extraReviews: 0,
    });
    await expectDomainError(
      rating.mutation(
        internal.migration.reviews.transformRatingsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: REVIEW_OPERATIONS.ratings,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
  });

  test("rejects malformed IDs, missing parents, and canonical conflicts", async () => {
    const malformed = createTestBackend();
    await initializeAtS1(malformed);
    await seedPrerequisites(malformed);
    await malformed.run(async (ctx) => {
      await ctx.db.insert("migrationRawRatings", {
        runId: RUN_ID,
        legacyId: "not-a-uuid",
        name: "Malformed",
        value: 5,
        sourceRowHash: "sha256:malformed",
      });
    });
    await startRun(malformed, {
      ratings: 1,
      reviews: 0,
      assignmentReviews: 0,
      extraReviews: 0,
    });
    await expectDomainError(
      malformed.mutation(
        internal.migration.reviews.transformRatingsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: REVIEW_OPERATIONS.ratings,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );

    const missingParent = createTestBackend();
    await initializeAtS1(missingParent);
    await seedPrerequisites(missingParent);
    await missingParent.run(async (ctx) => {
      await ctx.db.insert("migrationRawReviews", {
        runId: RUN_ID,
        legacyId: REVIEW_ID_A,
        userLegacyId: "missing-user",
        movieLegacyId: MOVIE_ID,
        sourceRowHash: "sha256:missing-user",
      });
    });
    await startRun(missingParent, {
      ratings: 0,
      reviews: 1,
      assignmentReviews: 0,
      extraReviews: 0,
    });
    await missingParent.mutation(
      internal.migration.reviews.transformRatingsBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: REVIEW_OPERATIONS.ratings,
        batchSize: 10,
      },
    );
    await expectDomainError(
      missingParent.mutation(
        internal.migration.reviews.transformReviewsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: REVIEW_OPERATIONS.reviews,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    const canonicalConflict = createTestBackend();
    await initializeAtS1(canonicalConflict);
    await seedPrerequisites(canonicalConflict);
    await canonicalConflict.run(async (ctx) => {
      await ctx.db.insert("ratings", {
        legacyId: RATING_ID,
        name: "Different",
        value: 5,
      });
      await ctx.db.insert("migrationRawRatings", {
        runId: RUN_ID,
        legacyId: RATING_ID,
        name: "Expected",
        value: 5,
        sourceRowHash: "sha256:conflict",
      });
    });
    await startRun(canonicalConflict, {
      ratings: 1,
      reviews: 0,
      assignmentReviews: 0,
      extraReviews: 0,
    });
    await expectDomainError(
      canonicalConflict.mutation(
        internal.migration.reviews.transformRatingsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: REVIEW_OPERATIONS.ratings,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
  });

  test("rolls back duplicate review relationships", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await seedPrerequisites(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("migrationRawReviews", {
        runId: RUN_ID,
        legacyId: REVIEW_ID_A,
        movieLegacyId: MOVIE_ID,
        sourceRowHash: "sha256:review",
      });
      for (const legacyId of [
        ASSIGNMENT_REVIEW_ID,
        ASSIGNMENT_REVIEW_ID_B,
      ]) {
        await ctx.db.insert("migrationRawAssignmentReviews", {
          runId: RUN_ID,
          legacyId,
          assignmentLegacyId: ASSIGNMENT_ID,
          reviewLegacyId: REVIEW_ID_A,
          sourceRowHash: `sha256:${legacyId}`,
        });
      }
      for (const legacyId of [
        EXTRA_REVIEW_ID,
        EXTRA_REVIEW_ID_B,
      ]) {
        await ctx.db.insert("migrationRawExtraReviews", {
          runId: RUN_ID,
          legacyId,
          reviewLegacyId: REVIEW_ID_A,
          episodeLegacyId: EPISODE_ID,
          sourceRowHash: `sha256:${legacyId}`,
        });
      }
    });
    await startRun(t, {
      ratings: 0,
      reviews: 1,
      assignmentReviews: 2,
      extraReviews: 2,
    });
    await t.mutation(
      internal.migration.reviews.transformRatingsBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: REVIEW_OPERATIONS.ratings,
        batchSize: 10,
      },
    );
    await t.mutation(
      internal.migration.reviews.transformReviewsBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: REVIEW_OPERATIONS.reviews,
        batchSize: 10,
      },
    );
    await expectDomainError(
      t.mutation(
        internal.migration.reviews
          .transformAssignmentReviewsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: REVIEW_OPERATIONS.assignmentReviews,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.reviews.transformExtraReviewsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: REVIEW_OPERATIONS.extraReviews,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    const relationships = await t.run(async (ctx) => {
      const assignmentReviews = await ctx.db
        .query("assignmentReviews")
        .withIndex("by_assignmentId")
        .take(10);
      const extraReviews = await ctx.db
        .query("extraReviews")
        .withIndex("by_episodeId")
        .take(10);
      return { assignmentReviews, extraReviews };
    });
    expect(relationships.assignmentReviews).toHaveLength(0);
    expect(relationships.extraReviews).toHaveLength(0);
  });

  test("reuses exact records and detects reconciliation drift", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    const parents = await seedPrerequisites(t);
    const canonical = await t.run(async (ctx) => {
      const ratingId = await ctx.db.insert("ratings", {
        legacyId: RATING_ID,
        name: "Excellent",
        value: 5,
        sound: "https://example.test/rating.mp3",
        icon: "star",
        category: "positive",
      });
      const reviewA = await ctx.db.insert("reviews", {
        legacyId: REVIEW_ID_A,
        userId: parents.userId,
        movieId: parents.movieId,
        ratingId,
        reviewedAt: 1_700_000_000_000,
      });
      const reviewB = await ctx.db.insert("reviews", {
        legacyId: REVIEW_ID_B,
        showId: parents.showId,
        reviewedAt: 1_700_000_000_001,
      });
      await ctx.db.insert("assignmentReviews", {
        legacyId: ASSIGNMENT_REVIEW_ID,
        assignmentId: parents.assignmentId,
        reviewId: reviewA,
      });
      await ctx.db.insert("extraReviews", {
        legacyId: EXTRA_REVIEW_ID,
        reviewId: reviewB,
        episodeId: parents.episodeId,
      });
      return { reviewA };
    });
    await seedRawRows(t);
    await startRun(t);
    await transformAll(t);
    const checkpoints = await t.run(async (ctx) => {
      return await ctx.db
        .query("migrationCheckpoints")
        .withIndex("by_runId_and_operation", (query) =>
          query.eq("runId", RUN_ID),
        )
        .take(20);
    });
    const reviewCheckpoints = checkpoints.filter((checkpoint) =>
      checkpoint.operation.startsWith("reviews."),
    );
    expect(reviewCheckpoints).toHaveLength(4);
    expect(
      reviewCheckpoints.every(
        (checkpoint) =>
          checkpoint.insertedCount === 0 &&
          checkpoint.reusedCount === checkpoint.processedCount,
      ),
    ).toBe(true);
    await t.mutation(
      internal.migration.reviews.finishReviewRun,
      {
        cutoverRunId: RUN_ID,
        operationId: REVIEW_OPERATIONS.finish,
      },
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("reviews", canonical.reviewA, {
        reviewedAt: 99,
      });
    });
    await expectDomainError(
      t.mutation(
        internal.migration.reviewReconciliation
          .reconcileReviewsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId:
            REVIEW_RECONCILIATION_OPERATIONS.reviews,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
  });
});
