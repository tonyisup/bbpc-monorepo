/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { internal } from "./_generated/api.js";
import {
  ASSIGNMENT_OPERATIONS,
  GAME_OPERATIONS,
  GAME_RECONCILIATION_OPERATIONS,
  SOURCE_SCHEMA_FINGERPRINT,
} from "./migration/constants.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const RUN_ID = "game-relationships-test-001";
const USER_ID = "legacy-game-user";
const TARGET_USER_ID = "legacy-target-user";
const MOVIE_ID = "00000000-0000-0000-0000-000000000101";
const EPISODE_ID = "00000000-0000-0000-0000-000000000201";
const ASSIGNMENT_ID = "00000000-0000-0000-0000-000000000202";
const RATING_ID = "00000000-0000-0000-0000-000000000301";
const REVIEW_ID = "00000000-0000-0000-0000-000000000302";
const ASSIGNMENT_REVIEW_ID =
  "00000000-0000-0000-0000-000000000303";
const SEASON_ID = "00000000-0000-0000-0000-000000000401";
const POINT_ID = "00000000-0000-0000-0000-000000000411";
const DANGLING_POINT_ID =
  "00000000-0000-0000-0000-000000000499";
const GUESS_ID_A = "00000000-0000-0000-0000-000000000501";
const GUESS_ID_B = "00000000-0000-0000-0000-000000000502";
const GAMBLING_TYPE_ID =
  "00000000-0000-0000-0000-000000000601";
const GAMBLING_ENTRY_ID_A =
  "00000000-0000-0000-0000-000000000611";
const GAMBLING_ENTRY_ID_B =
  "00000000-0000-0000-0000-000000000612";
const TAG_VOTE_ID_A =
  "00000000-0000-0000-0000-000000000701";
const TAG_VOTE_ID_B =
  "00000000-0000-0000-0000-000000000702";
const TAG_VOTE_ID_C =
  "00000000-0000-0000-0000-000000000703";
const QUOTE_ID = "00000000-0000-0000-0000-000000000801";

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
    actor: "game-relationships-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "game-relationships-test",
  });
}

async function seedCanonicalPrerequisites(
  t: TestBackend,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("migrationRuns", {
      runId: RUN_ID,
      sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
      status: "running",
      startedAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("migrationDomainRuns", {
      runId: RUN_ID,
      domain: "identity",
      status: "reconciled",
      expectedCounts: {},
      startedAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("migrationDomainRuns", {
      runId: RUN_ID,
      domain: "reviews",
      status: "reconciled",
      expectedCounts: {},
      startedAt: 1,
      updatedAt: 1,
    });
    const userId = await ctx.db.insert("users", {
      legacyId: USER_ID,
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("users", {
      legacyId: TARGET_USER_ID,
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const movieId = await ctx.db.insert("movies", {
      legacyId: MOVIE_ID,
      title: "Synthetic Movie",
      normalizedTitle: "synthetic movie",
      year: 2025,
      url: "https://example.invalid/movie",
    });
    const episodeId = await ctx.db.insert("episodes", {
      legacyId: EPISODE_ID,
      number: 1,
      title: "Synthetic Episode",
    });
    const assignmentId = await ctx.db.insert("assignments", {
      legacyId: ASSIGNMENT_ID,
      userId,
      episodeId,
      movieId,
      type: "host",
      playable: true,
    });
    const ratingId = await ctx.db.insert("ratings", {
      legacyId: RATING_ID,
      name: "Five",
      value: 5,
    });
    const reviewId = await ctx.db.insert("reviews", {
      legacyId: REVIEW_ID,
      userId,
      movieId,
      ratingId,
      reviewedAt: 1_700_000_000_000,
    });
    await ctx.db.insert("assignmentReviews", {
      legacyId: ASSIGNMENT_REVIEW_ID,
      assignmentId,
      reviewId,
    });
    const gameTypeId = await ctx.db.insert("gameTypes", {
      legacyId: 1,
      title: "Prediction Game",
      lookupId: "prediction",
      normalizedLookupId: "prediction",
    });
    const pointTypeId = await ctx.db.insert("gamePointTypes", {
      legacyId: 2,
      lookupId: "correct",
      normalizedLookupId: "correct",
      title: "Correct",
      points: 5,
      gameTypeId,
    });
    const seasonId = await ctx.db.insert("seasons", {
      legacyId: SEASON_ID,
      title: "Synthetic Season",
      gameTypeId,
      startedOn: "2025-01-01",
    });
    await ctx.db.insert("points", {
      legacyId: POINT_ID,
      userId,
      seasonId,
      reason: "Synthetic point",
      earnedAt: 1_700_000_000_000,
      adjustment: 0,
      gamePointTypeId: pointTypeId,
    });
  });
}

interface ExpectedCounts {
  guesses: number;
  gamblingTypes: number;
  gamblingEntries: number;
  tagVotes: number;
  quoteSubmissions: number;
}

async function startRun(
  t: TestBackend,
  counts: ExpectedCounts = {
    guesses: 2,
    gamblingTypes: 1,
    gamblingEntries: 2,
    tagVotes: 3,
    quoteSubmissions: 1,
  },
) {
  return await t.mutation(
    internal.migration.gameFoundation.startGameRun,
    {
      cutoverRunId: RUN_ID,
      operationId: GAME_OPERATIONS.start,
      sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
      expectedGameTypes: 1,
      expectedGamePointTypes: 1,
      expectedSeasons: 1,
      expectedPoints: 1,
      expectedGuesses: counts.guesses,
      expectedGamblingTypes: counts.gamblingTypes,
      expectedGamblingEntries: counts.gamblingEntries,
      expectedTagVotes: counts.tagVotes,
      expectedQuoteSubmissions: counts.quoteSubmissions,
    },
  );
}

async function seedCompletedCheckpoint(
  t: TestBackend,
  operation: string,
  processedCount = 1,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("migrationCheckpoints", {
      runId: RUN_ID,
      operation,
      status: "completed",
      processedCount,
      insertedCount: processedCount,
      reusedCount: 0,
      updatedAt: 1,
    });
  });
}

async function seedFoundationCheckpoints(
  t: TestBackend,
): Promise<void> {
  for (const operation of [
    GAME_OPERATIONS.gameTypes,
    GAME_OPERATIONS.gamePointTypes,
    GAME_OPERATIONS.seasons,
    GAME_OPERATIONS.points,
    ASSIGNMENT_OPERATIONS.assignments,
  ]) {
    await seedCompletedCheckpoint(t, operation);
  }
}

async function seedRelationshipRows(t: TestBackend): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("migrationRawGameTypes", {
      runId: RUN_ID,
      legacyId: 1,
      title: "Prediction Game",
      lookupId: "prediction",
      sourceRowHash: "sha256:game-type",
    });
    await ctx.db.insert("migrationRawGamePointTypes", {
      runId: RUN_ID,
      legacyId: 2,
      lookupId: "correct",
      title: "Correct",
      points: 5,
      gameTypeLegacyId: 1,
      sourceRowHash: "sha256:game-point-type",
    });
    await ctx.db.insert("migrationRawSeasons", {
      runId: RUN_ID,
      legacyId: SEASON_ID,
      title: "Synthetic Season",
      gameTypeLegacyId: 1,
      startedOn: "2025-01-01",
      sourceRowHash: "sha256:season",
    });
    await ctx.db.insert("migrationRawPoints", {
      runId: RUN_ID,
      legacyId: POINT_ID,
      userLegacyId: USER_ID,
      seasonLegacyId: SEASON_ID,
      reason: "Synthetic point",
      earnedAt: 1_700_000_000_000,
      adjustment: 0,
      gamePointTypeLegacyId: 2,
      sourceRowHash: "sha256:point",
    });
    await ctx.db.insert("migrationRawGuesses", {
      runId: RUN_ID,
      legacyId: GUESS_ID_A,
      ratingLegacyId: RATING_ID,
      createdAt: 1_700_000_000_100,
      userLegacyId: USER_ID,
      assignmentReviewLegacyId: ASSIGNMENT_REVIEW_ID,
      seasonLegacyId: SEASON_ID,
      sourceRowHash: "sha256:guess-a",
    });
    await ctx.db.insert("migrationRawGuesses", {
      runId: RUN_ID,
      legacyId: GUESS_ID_B,
      ratingLegacyId: RATING_ID,
      createdAt: 1_700_000_000_101,
      userLegacyId: TARGET_USER_ID,
      assignmentReviewLegacyId: ASSIGNMENT_REVIEW_ID,
      seasonLegacyId: SEASON_ID,
      pointLegacyId: POINT_ID,
      sourceRowHash: "sha256:guess-b",
    });
    await ctx.db.insert("migrationRawGamblingTypes", {
      runId: RUN_ID,
      legacyId: GAMBLING_TYPE_ID,
      lookupId: "  SPＥCIAL  ",
      title: "Special Bet",
      description: "Synthetic gambling type",
      multiplier: 1.5,
      isActive: true,
      createdAt: 1_700_000_000_200,
      sourceRowHash: "sha256:gambling-type",
    });
    await ctx.db.insert("migrationRawGamblingEntries", {
      runId: RUN_ID,
      legacyId: GAMBLING_ENTRY_ID_A,
      userLegacyId: USER_ID,
      assignmentLegacyId: ASSIGNMENT_ID,
      points: 10,
      createdAt: 1_700_000_000_201,
      pointLegacyId: POINT_ID,
      seasonLegacyId: SEASON_ID,
      notes: "Synthetic bet",
      gamblingTypeLegacyId: GAMBLING_TYPE_ID,
      targetUserLegacyId: TARGET_USER_ID,
      status: "WON",
      sourceRowHash: "sha256:gambling-entry-a",
    });
    await ctx.db.insert("migrationRawGamblingEntries", {
      runId: RUN_ID,
      legacyId: GAMBLING_ENTRY_ID_B,
      userLegacyId: TARGET_USER_ID,
      points: -5,
      createdAt: 1_700_000_000_202,
      gamblingTypeLegacyId: GAMBLING_TYPE_ID,
      status: "PENDING",
      sourceRowHash: "sha256:gambling-entry-b",
    });
    await ctx.db.insert("migrationRawTagVotes", {
      runId: RUN_ID,
      legacyId: TAG_VOTE_ID_A,
      tag: "  Sci-Fi  ",
      tmdbId: 101,
      isTag: true,
      createdAt: 1_700_000_000_300,
      sessionId: "session-a",
      userLegacyId: USER_ID,
      sourceRowHash: "sha256:tag-a",
    });
    await ctx.db.insert("migrationRawTagVotes", {
      runId: RUN_ID,
      legacyId: TAG_VOTE_ID_B,
      tag: "Thriller",
      tmdbId: 102,
      createdAt: 1_700_000_000_301,
      pointLegacyId: POINT_ID,
      sourceRowHash: "sha256:tag-b",
    });
    await ctx.db.insert("migrationRawTagVotes", {
      runId: RUN_ID,
      legacyId: TAG_VOTE_ID_C,
      tag: "Drama",
      tmdbId: 103,
      createdAt: 1_700_000_000_302,
      pointLegacyId: DANGLING_POINT_ID,
      sourceRowHash: "sha256:tag-c",
    });
    await ctx.db.insert("migrationRawQuoteSubmissions", {
      runId: RUN_ID,
      legacyId: QUOTE_ID,
      userLegacyId: USER_ID,
      episodeLegacyId: EPISODE_ID,
      seasonLegacyId: SEASON_ID,
      quoteText: "A synthetic quote",
      sourceTitle: "Synthetic Movie",
      sourceType: "MOVIE",
      clipUrl: "https://example.invalid/clip",
      clipStartSeconds: 12,
      listenerNotes: "Listener note",
      status: "INCLUDED",
      bracketOrder: 2,
      placement: 1,
      adminNotes: "Admin note",
      pointLegacyId: POINT_ID,
      createdAt: 1_700_000_000_400,
      updatedAt: 1_700_000_000_401,
      sourceRowHash: "sha256:quote",
    });
  });
}

async function transformRelationships(
  t: TestBackend,
  batchSize = 100,
): Promise<void> {
  await t.mutation(
    internal.migration.gameRelationships.transformGuessesBatch,
    {
      cutoverRunId: RUN_ID,
      operationId: GAME_OPERATIONS.guesses,
      batchSize,
    },
  );
  await t.mutation(
    internal.migration.gameRelationships
      .transformGamblingTypesBatch,
    {
      cutoverRunId: RUN_ID,
      operationId: GAME_OPERATIONS.gamblingTypes,
      batchSize,
    },
  );
  await t.mutation(
    internal.migration.gameRelationships
      .transformGamblingEntriesBatch,
    {
      cutoverRunId: RUN_ID,
      operationId: GAME_OPERATIONS.gamblingEntries,
      batchSize,
    },
  );
  await t.mutation(
    internal.migration.gameRelationships.transformTagVotesBatch,
    {
      cutoverRunId: RUN_ID,
      operationId: GAME_OPERATIONS.tagVotes,
      batchSize,
    },
  );
  await t.mutation(
    internal.migration.gameRelationships
      .transformQuoteSubmissionsBatch,
    {
      cutoverRunId: RUN_ID,
      operationId: GAME_OPERATIONS.quoteSubmissions,
      batchSize,
    },
  );
}

async function reconcileGames(
  t: TestBackend,
  batchSize = 100,
): Promise<void> {
  const calls = [
    {
      mutation:
        internal.migration.gameReconciliation
          .reconcileGameTypesBatch,
      operation: GAME_RECONCILIATION_OPERATIONS.gameTypes,
    },
    {
      mutation:
        internal.migration.gameReconciliation
          .reconcileGamePointTypesBatch,
      operation: GAME_RECONCILIATION_OPERATIONS.gamePointTypes,
    },
    {
      mutation:
        internal.migration.gameReconciliation.reconcileSeasonsBatch,
      operation: GAME_RECONCILIATION_OPERATIONS.seasons,
    },
    {
      mutation:
        internal.migration.gameReconciliation.reconcilePointsBatch,
      operation: GAME_RECONCILIATION_OPERATIONS.points,
    },
    {
      mutation:
        internal.migration.gameReconciliation.reconcileGuessesBatch,
      operation: GAME_RECONCILIATION_OPERATIONS.guesses,
    },
    {
      mutation:
        internal.migration.gameReconciliation
          .reconcileGamblingTypesBatch,
      operation: GAME_RECONCILIATION_OPERATIONS.gamblingTypes,
    },
    {
      mutation:
        internal.migration.gameReconciliation
          .reconcileGamblingEntriesBatch,
      operation: GAME_RECONCILIATION_OPERATIONS.gamblingEntries,
    },
    {
      mutation:
        internal.migration.gameReconciliation
          .reconcileTagVotesBatch,
      operation: GAME_RECONCILIATION_OPERATIONS.tagVotes,
    },
    {
      mutation:
        internal.migration.gameReconciliation
          .reconcileQuoteSubmissionsBatch,
      operation: GAME_RECONCILIATION_OPERATIONS.quoteSubmissions,
    },
  ] as const;
  for (const call of calls) {
    await t.mutation(call.mutation, {
      cutoverRunId: RUN_ID,
      operationId: call.operation,
      batchSize,
    });
  }
}

async function deleteRelationshipCheckpoints(
  t: TestBackend,
): Promise<void> {
  await t.run(async (ctx) => {
    for (const operation of [
      GAME_OPERATIONS.guesses,
      GAME_OPERATIONS.gamblingTypes,
      GAME_OPERATIONS.gamblingEntries,
      GAME_OPERATIONS.tagVotes,
      GAME_OPERATIONS.quoteSubmissions,
    ]) {
      const checkpoint = await ctx.db
        .query("migrationCheckpoints")
        .withIndex("by_runId_and_operation", (query) =>
          query.eq("runId", RUN_ID).eq("operation", operation),
        )
        .unique();
      if (checkpoint) {
        await ctx.db.delete("migrationCheckpoints", checkpoint._id);
      }
    }
  });
}

async function prepareCompleteFixture(t: TestBackend): Promise<void> {
  await initializeAtS1(t);
  await seedCanonicalPrerequisites(t);
  await startRun(t);
  await seedFoundationCheckpoints(t);
  await seedRelationshipRows(t);
}

describe("game relationship migration slice", () => {
  test("transforms every relationship shape, resumes, reuses, and finishes", async () => {
    const t = createTestBackend();
    await prepareCompleteFixture(t);

    await expect(
      t.mutation(
        internal.migration.gameRelationships.transformGuessesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.guesses,
          batchSize: 1,
        },
      ),
    ).resolves.toMatchObject({
      status: "running",
      processedCount: 1,
    });
    await expect(
      t.mutation(
        internal.migration.gameRelationships.transformGuessesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.guesses,
          batchSize: 1,
        },
      ),
    ).resolves.toMatchObject({
      status: "completed",
      processedCount: 2,
    });
    await t.mutation(
      internal.migration.gameRelationships
        .transformGamblingTypesBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: GAME_OPERATIONS.gamblingTypes,
        batchSize: 10,
      },
    );
    await t.mutation(
      internal.migration.gameRelationships
        .transformGamblingEntriesBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: GAME_OPERATIONS.gamblingEntries,
        batchSize: 10,
      },
    );
    await expect(
      t.mutation(
        internal.migration.gameRelationships.transformTagVotesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.tagVotes,
          batchSize: 2,
        },
      ),
    ).resolves.toMatchObject({ status: "running" });
    await t.mutation(
      internal.migration.gameRelationships.transformTagVotesBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: GAME_OPERATIONS.tagVotes,
        batchSize: 2,
      },
    );
    await t.mutation(
      internal.migration.gameRelationships
        .transformQuoteSubmissionsBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: GAME_OPERATIONS.quoteSubmissions,
        batchSize: 10,
      },
    );

    const snapshot = await t.run(async (ctx) => {
      const guesses = await ctx.db.query("guesses").take(10);
      const gamblingTypes = await ctx.db
        .query("gamblingTypes")
        .take(10);
      const gamblingEntries = await ctx.db
        .query("gamblingEntries")
        .take(10);
      const tagVotes = await ctx.db.query("tagVotes").take(10);
      const quoteSubmissions = await ctx.db
        .query("quoteSubmissions")
        .take(10);
      return {
        guesses,
        gamblingTypes,
        gamblingEntries,
        tagVotes,
        quoteSubmissions,
      };
    });
    expect(snapshot.guesses).toHaveLength(2);
    expect(
      snapshot.guesses.find((guess) => guess.legacyId === GUESS_ID_A)
        ?.pointId,
    ).toBeUndefined();
    expect(
      snapshot.guesses.find((guess) => guess.legacyId === GUESS_ID_B)
        ?.pointId,
    ).toBeDefined();
    expect(snapshot.gamblingTypes[0]?.normalizedLookupId).toBe(
      "special",
    );
    expect(snapshot.gamblingEntries).toHaveLength(2);
    const minimalEntry = snapshot.gamblingEntries.find(
      (entry) => entry.legacyId === GAMBLING_ENTRY_ID_B,
    );
    expect(minimalEntry?.assignmentId).toBeUndefined();
    expect(minimalEntry?.awardPointId).toBeUndefined();
    expect(minimalEntry?.seasonId).toBeUndefined();
    expect(minimalEntry?.notes).toBeUndefined();
    expect(minimalEntry?.targetUserId).toBeUndefined();
    expect(snapshot.tagVotes).toHaveLength(3);
    expect(
      snapshot.tagVotes.find(
        (vote) => vote.legacyId === TAG_VOTE_ID_A,
      ),
    ).toMatchObject({
      normalizedTag: "sci-fi",
      award: { kind: "unawarded" },
    });
    expect(
      snapshot.tagVotes.find(
        (vote) => vote.legacyId === TAG_VOTE_ID_B,
      )?.award.kind,
    ).toBe("point");
    expect(
      snapshot.tagVotes.find(
        (vote) => vote.legacyId === TAG_VOTE_ID_C,
      )?.award,
    ).toEqual({
      kind: "legacyAwardTombstone",
      legacyPointId: DANGLING_POINT_ID,
    });
    expect(snapshot.quoteSubmissions[0]).toMatchObject({
      sourceType: "MOVIE",
      status: "INCLUDED",
      placement: 1,
    });

    await deleteRelationshipCheckpoints(t);
    await transformRelationships(t);
    const rerunCheckpoints = await t.run(async (ctx) => {
      return await ctx.db
        .query("migrationCheckpoints")
        .withIndex("by_runId_and_operation", (query) =>
          query.eq("runId", RUN_ID),
        )
        .take(20);
    });
    for (const operation of [
      GAME_OPERATIONS.guesses,
      GAME_OPERATIONS.gamblingTypes,
      GAME_OPERATIONS.gamblingEntries,
      GAME_OPERATIONS.tagVotes,
      GAME_OPERATIONS.quoteSubmissions,
    ]) {
      const checkpoint = rerunCheckpoints.find(
        (candidate) => candidate.operation === operation,
      );
      expect(checkpoint?.insertedCount).toBe(0);
      expect(checkpoint?.reusedCount).toBe(
        checkpoint?.processedCount,
      );
    }

    await expect(
      t.mutation(
        internal.migration.gameRelationships.finishGameRun,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.finish,
        },
      ),
    ).resolves.toMatchObject({
      runId: RUN_ID,
      status: "transformed",
      counts: {
        gameTypes: 1,
        gamePointTypes: 1,
        seasons: 1,
        points: 1,
        guesses: 2,
        gamblingTypes: 1,
        gamblingEntries: 2,
        tagVotes: 3,
        quoteSubmissions: 1,
      },
    });

    await expectDomainError(
      t.mutation(
        internal.migration.gameReconciliation
          .finishGameReconciliation,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_RECONCILIATION_OPERATIONS.finish,
        },
      ),
      "CONFLICT",
    );
    await reconcileGames(t, 1);
    await reconcileGames(t, 1);
    await reconcileGames(t, 1);
    await reconcileGames(t, 1);
    const reconciled = await t.mutation(
      internal.migration.gameReconciliation
        .finishGameReconciliation,
      {
        cutoverRunId: RUN_ID,
        operationId: GAME_RECONCILIATION_OPERATIONS.finish,
      },
    );
    expect(reconciled).toMatchObject({
      runId: RUN_ID,
      status: "reconciled",
      counts: {
        gameTypes: 1,
        gamePointTypes: 1,
        seasons: 1,
        points: 1,
        guesses: 2,
        gamblingTypes: 1,
        gamblingEntries: 2,
        tagVotes: 3,
        quoteSubmissions: 1,
      },
    });
    await expect(
      t.mutation(
        internal.migration.gameReconciliation
          .finishGameReconciliation,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_RECONCILIATION_OPERATIONS.finish,
        },
      ),
    ).resolves.toEqual(reconciled);
  });

  test("enforces operation, batch, checkpoint, and finish gates", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await seedCanonicalPrerequisites(t);
    await startRun(t, {
      guesses: 0,
      gamblingTypes: 0,
      gamblingEntries: 0,
      tagVotes: 0,
      quoteSubmissions: 0,
    });
    await expectDomainError(
      t.mutation(
        internal.migration.gameRelationships.transformGuessesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.tagVotes,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.gameRelationships.transformGuessesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.guesses,
          batchSize: 101,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.gameRelationships.transformGuessesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.guesses,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    await seedFoundationCheckpoints(t);
    await transformRelationships(t);
    await t.run(async (ctx) => {
      const checkpoint = await ctx.db
        .query("migrationCheckpoints")
        .withIndex("by_runId_and_operation", (query) =>
          query
            .eq("runId", RUN_ID)
            .eq("operation", GAME_OPERATIONS.tagVotes),
        )
        .unique();
      if (!checkpoint) {
        throw new Error("Expected tag checkpoint");
      }
      await ctx.db.patch("migrationCheckpoints", checkpoint._id, {
        processedCount: 1,
      });
    });
    await expectDomainError(
      t.mutation(
        internal.migration.gameRelationships.finishGameRun,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.finish,
        },
      ),
      "CONFLICT",
    );
  });

  test("rolls back normalized gambling-type collisions", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await seedCanonicalPrerequisites(t);
    await startRun(t, {
      guesses: 0,
      gamblingTypes: 2,
      gamblingEntries: 0,
      tagVotes: 0,
      quoteSubmissions: 0,
    });
    await seedFoundationCheckpoints(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("migrationRawGamblingTypes", {
        runId: RUN_ID,
        legacyId: GAMBLING_TYPE_ID,
        lookupId: "special",
        title: "First",
        multiplier: 1,
        isActive: true,
        createdAt: 1,
        sourceRowHash: "sha256:first",
      });
      await ctx.db.insert("migrationRawGamblingTypes", {
        runId: RUN_ID,
        legacyId: "00000000-0000-0000-0000-000000000602",
        lookupId: "  SPＥCIAL  ",
        title: "Second",
        multiplier: 2,
        isActive: false,
        createdAt: 2,
        sourceRowHash: "sha256:second",
      });
    });
    await expectDomainError(
      t.mutation(
        internal.migration.gameRelationships
          .transformGamblingTypesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.gamblingTypes,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    const gamblingTypes = await t.run(async (ctx) => {
      return await ctx.db.query("gamblingTypes").take(10);
    });
    expect(gamblingTypes).toHaveLength(0);
  });

  test("rejects malformed IDs, missing parents, and SQL-bound values", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await seedCanonicalPrerequisites(t);
    await startRun(t, {
      guesses: 1,
      gamblingTypes: 1,
      gamblingEntries: 1,
      tagVotes: 1,
      quoteSubmissions: 1,
    });
    await seedFoundationCheckpoints(t);
    const rawIds = await t.run(async (ctx) => {
      const guess = await ctx.db.insert("migrationRawGuesses", {
        runId: RUN_ID,
        legacyId: "not-a-uuid",
        ratingLegacyId: RATING_ID,
        createdAt: 1,
        userLegacyId: USER_ID,
        assignmentReviewLegacyId: ASSIGNMENT_REVIEW_ID,
        seasonLegacyId: SEASON_ID,
        sourceRowHash: "sha256:guess",
      });
      const gamblingType = await ctx.db.insert(
        "migrationRawGamblingTypes",
        {
          runId: RUN_ID,
          legacyId: GAMBLING_TYPE_ID,
          lookupId: "special",
          title: "Special",
          multiplier: 1,
          isActive: true,
          createdAt: 1,
          sourceRowHash: "sha256:type",
        },
      );
      const gamblingEntry = await ctx.db.insert(
        "migrationRawGamblingEntries",
        {
          runId: RUN_ID,
          legacyId: GAMBLING_ENTRY_ID_A,
          userLegacyId: USER_ID,
          points: 2_147_483_648,
          createdAt: 1,
          gamblingTypeLegacyId: GAMBLING_TYPE_ID,
          status: "PENDING",
          sourceRowHash: "sha256:entry",
        },
      );
      const tagVote = await ctx.db.insert("migrationRawTagVotes", {
        runId: RUN_ID,
        legacyId: TAG_VOTE_ID_A,
        tag: "Tag",
        tmdbId: 2_147_483_648,
        createdAt: 1,
        userLegacyId: "missing-user",
        sourceRowHash: "sha256:tag",
      });
      const quote = await ctx.db.insert(
        "migrationRawQuoteSubmissions",
        {
          runId: RUN_ID,
          legacyId: QUOTE_ID,
          userLegacyId: USER_ID,
          episodeLegacyId: EPISODE_ID,
          seasonLegacyId: SEASON_ID,
          quoteText: "Quote",
          sourceTitle: "Movie",
          sourceType: "INVALID",
          status: "SUBMITTED",
          createdAt: 1,
          updatedAt: 1,
          sourceRowHash: "sha256:quote",
        },
      );
      return { guess, gamblingType, gamblingEntry, tagVote, quote };
    });

    await expectDomainError(
      t.mutation(
        internal.migration.gameRelationships.transformGuessesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.guesses,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("migrationRawGuesses", rawIds.guess, {
        legacyId: GUESS_ID_A,
        ratingLegacyId: DANGLING_POINT_ID,
      });
    });
    await expectDomainError(
      t.mutation(
        internal.migration.gameRelationships.transformGuessesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.guesses,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    await t.mutation(
      internal.migration.gameRelationships
        .transformGamblingTypesBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: GAME_OPERATIONS.gamblingTypes,
        batchSize: 10,
      },
    );
    await expectDomainError(
      t.mutation(
        internal.migration.gameRelationships
          .transformGamblingEntriesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.gamblingEntries,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(
        "migrationRawGamblingEntries",
        rawIds.gamblingEntry,
        {
          points: 1,
          assignmentLegacyId: DANGLING_POINT_ID,
        },
      );
    });
    await expectDomainError(
      t.mutation(
        internal.migration.gameRelationships
          .transformGamblingEntriesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.gamblingEntries,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    await expectDomainError(
      t.mutation(
        internal.migration.gameRelationships.transformTagVotesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.tagVotes,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("migrationRawTagVotes", rawIds.tagVote, {
        tmdbId: 1,
      });
    });
    await expectDomainError(
      t.mutation(
        internal.migration.gameRelationships.transformTagVotesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.tagVotes,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    await expectDomainError(
      t.mutation(
        internal.migration.gameRelationships
          .transformQuoteSubmissionsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.quoteSubmissions,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(
        "migrationRawQuoteSubmissions",
        rawIds.quote,
        {
          sourceType: "TV",
          status: "INVALID",
        },
      );
    });
    await expectDomainError(
      t.mutation(
        internal.migration.gameRelationships
          .transformQuoteSubmissionsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.quoteSubmissions,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
  });

  test("rolls back quote uniqueness conflicts and invalid constraints", async () => {
    const duplicateUser = createTestBackend();
    await initializeAtS1(duplicateUser);
    await seedCanonicalPrerequisites(duplicateUser);
    await startRun(duplicateUser, {
      guesses: 0,
      gamblingTypes: 0,
      gamblingEntries: 0,
      tagVotes: 0,
      quoteSubmissions: 2,
    });
    await seedFoundationCheckpoints(duplicateUser);
    await duplicateUser.run(async (ctx) => {
      for (const [legacyId, pointLegacyId] of [
        [QUOTE_ID, POINT_ID],
        ["00000000-0000-0000-0000-000000000802", undefined],
      ] as const) {
        await ctx.db.insert("migrationRawQuoteSubmissions", {
          runId: RUN_ID,
          legacyId,
          userLegacyId: USER_ID,
          episodeLegacyId: EPISODE_ID,
          seasonLegacyId: SEASON_ID,
          quoteText: "Quote",
          sourceTitle: "Movie",
          sourceType: "OTHER",
          status: "REJECTED",
          ...(pointLegacyId === undefined
            ? {}
            : { pointLegacyId }),
          createdAt: 1,
          updatedAt: 1,
          sourceRowHash: `sha256:${legacyId}`,
        });
      }
    });
    await expectDomainError(
      duplicateUser.mutation(
        internal.migration.gameRelationships
          .transformQuoteSubmissionsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.quoteSubmissions,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    expect(
      await duplicateUser.run(async (ctx) =>
        await ctx.db.query("quoteSubmissions").take(10),
      ),
    ).toHaveLength(0);

    const invalid = createTestBackend();
    await initializeAtS1(invalid);
    await seedCanonicalPrerequisites(invalid);
    await startRun(invalid, {
      guesses: 0,
      gamblingTypes: 0,
      gamblingEntries: 0,
      tagVotes: 0,
      quoteSubmissions: 1,
    });
    await seedFoundationCheckpoints(invalid);
    const quoteId = await invalid.run(async (ctx) => {
      return await ctx.db.insert("migrationRawQuoteSubmissions", {
        runId: RUN_ID,
        legacyId: QUOTE_ID,
        userLegacyId: USER_ID,
        episodeLegacyId: EPISODE_ID,
        seasonLegacyId: SEASON_ID,
        quoteText: "Quote",
        sourceTitle: "Movie",
        sourceType: "TV",
        clipStartSeconds: -1,
        status: "SUBMITTED",
        bracketOrder: 32_768,
        placement: 4,
        createdAt: 1,
        updatedAt: 1,
        sourceRowHash: "sha256:invalid",
      });
    });
    await expectDomainError(
      invalid.mutation(
        internal.migration.gameRelationships
          .transformQuoteSubmissionsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.quoteSubmissions,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
    await invalid.run(async (ctx) => {
      await ctx.db.patch("migrationRawQuoteSubmissions", quoteId, {
        clipStartSeconds: 0,
      });
    });
    await expectDomainError(
      invalid.mutation(
        internal.migration.gameRelationships
          .transformQuoteSubmissionsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.quoteSubmissions,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
    await invalid.run(async (ctx) => {
      await ctx.db.patch("migrationRawQuoteSubmissions", quoteId, {
        bracketOrder: 1,
      });
    });
    await expectDomainError(
      invalid.mutation(
        internal.migration.gameRelationships
          .transformQuoteSubmissionsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.quoteSubmissions,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
  });

  test("rejects drift in every canonical relationship table", async () => {
    const t = createTestBackend();
    await prepareCompleteFixture(t);
    await transformRelationships(t);

    const cases = [
      {
        operation: GAME_OPERATIONS.guesses,
        table: "guesses",
        patch: { createdAt: 0 },
        mutation:
          internal.migration.gameRelationships.transformGuessesBatch,
      },
      {
        operation: GAME_OPERATIONS.gamblingTypes,
        table: "gamblingTypes",
        patch: { title: "Drifted" },
        mutation:
          internal.migration.gameRelationships
            .transformGamblingTypesBatch,
      },
      {
        operation: GAME_OPERATIONS.gamblingEntries,
        table: "gamblingEntries",
        patch: { status: "DRIFTED" },
        mutation:
          internal.migration.gameRelationships
            .transformGamblingEntriesBatch,
      },
      {
        operation: GAME_OPERATIONS.tagVotes,
        table: "tagVotes",
        patch: { tag: "Drifted" },
        mutation:
          internal.migration.gameRelationships.transformTagVotesBatch,
      },
      {
        operation: GAME_OPERATIONS.quoteSubmissions,
        table: "quoteSubmissions",
        patch: { quoteText: "Drifted" },
        mutation:
          internal.migration.gameRelationships
            .transformQuoteSubmissionsBatch,
      },
    ] as const;

    for (const driftCase of cases) {
      await t.run(async (ctx) => {
        const checkpoint = await ctx.db
          .query("migrationCheckpoints")
          .withIndex("by_runId_and_operation", (query) =>
            query
              .eq("runId", RUN_ID)
              .eq("operation", driftCase.operation),
          )
          .unique();
        if (!checkpoint) {
          throw new Error("Expected relationship checkpoint");
        }
        await ctx.db.delete("migrationCheckpoints", checkpoint._id);
        const document = await ctx.db
          .query(driftCase.table)
          .withIndex("by_legacyId")
          .first();
        if (!document) {
          throw new Error("Expected canonical relationship document");
        }
        await ctx.db.patch(
          driftCase.table,
          document._id,
          driftCase.patch,
        );
      });
      await expectDomainError(
        t.mutation(driftCase.mutation, {
          cutoverRunId: RUN_ID,
          operationId: driftCase.operation,
          batchSize: 100,
        }),
        "CONFLICT",
      );
    }
  });
});
