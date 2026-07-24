/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { internal } from "./_generated/api.js";
import {
  GAME_OPERATIONS,
  SOURCE_SCHEMA_FINGERPRINT,
} from "./migration/constants.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const RUN_ID = "game-foundation-test-001";
const USER_ID = "legacy-game-user";
const SEASON_ID = "00000000-0000-0000-0000-000000000401";
const POINT_ID_A = "00000000-0000-0000-0000-000000000411";
const POINT_ID_B = "00000000-0000-0000-0000-000000000412";

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
    actor: "game-foundation-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "game-foundation-test",
  });
}

async function seedPrerequisites(
  t: TestBackend,
  reviewStatus: "reconciled" | "transformed" = "reconciled",
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
      status: reviewStatus,
      expectedCounts: {},
      startedAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("users", {
      legacyId: USER_ID,
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
  });
}

async function seedRawRows(t: TestBackend): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("migrationRawGameTypes", {
      runId: RUN_ID,
      legacyId: 1,
      title: "Prediction Game",
      description: "Synthetic game",
      lookupId: "  PRＥDICTION  ",
      sourceRowHash: "sha256:game-type",
    });
    await ctx.db.insert("migrationRawGamePointTypes", {
      runId: RUN_ID,
      legacyId: 2,
      lookupId: "  CORRECT-GUESS  ",
      title: "Correct Guess",
      description: "Synthetic points",
      points: 5,
      gameTypeLegacyId: 1,
      sourceRowHash: "sha256:point-type",
    });
    await ctx.db.insert("migrationRawSeasons", {
      runId: RUN_ID,
      legacyId: SEASON_ID,
      title: "Synthetic Season",
      description: "Season description",
      gameTypeLegacyId: 1,
      startedOn: "2025-01-01",
      endedOn: "2025-12-31",
      sourceRowHash: "sha256:season",
    });
    await ctx.db.insert("migrationRawPoints", {
      runId: RUN_ID,
      legacyId: POINT_ID_A,
      userLegacyId: USER_ID,
      seasonLegacyId: SEASON_ID,
      reason: "Correct guess",
      earnedAt: 1_700_000_000_000,
      adjustment: 1,
      gamePointTypeLegacyId: 2,
      sourceRowHash: "sha256:point-a",
    });
    await ctx.db.insert("migrationRawPoints", {
      runId: RUN_ID,
      legacyId: POINT_ID_B,
      userLegacyId: USER_ID,
      seasonLegacyId: SEASON_ID,
      earnedAt: 1_700_000_000_001,
      adjustment: null,
      sourceRowHash: "sha256:point-b",
    });
  });
}

async function startRun(
  t: TestBackend,
  counts = {
    gameTypes: 1,
    gamePointTypes: 1,
    seasons: 1,
    points: 2,
  },
) {
  return await t.mutation(
    internal.migration.gameFoundation.startGameRun,
    {
      cutoverRunId: RUN_ID,
      operationId: GAME_OPERATIONS.start,
      sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
      expectedGameTypes: counts.gameTypes,
      expectedGamePointTypes: counts.gamePointTypes,
      expectedSeasons: counts.seasons,
      expectedPoints: counts.points,
      expectedGuesses: 0,
      expectedGamblingTypes: 0,
      expectedGamblingEntries: 0,
      expectedTagVotes: 0,
      expectedQuoteSubmissions: 0,
    },
  );
}

async function transformAll(
  t: TestBackend,
  batchSize = 100,
): Promise<void> {
  await t.mutation(
    internal.migration.gameFoundation.transformGameTypesBatch,
    {
      cutoverRunId: RUN_ID,
      operationId: GAME_OPERATIONS.gameTypes,
      batchSize,
    },
  );
  await t.mutation(
    internal.migration.gameFoundation
      .transformGamePointTypesBatch,
    {
      cutoverRunId: RUN_ID,
      operationId: GAME_OPERATIONS.gamePointTypes,
      batchSize,
    },
  );
  await t.mutation(
    internal.migration.gameFoundation.transformSeasonsBatch,
    {
      cutoverRunId: RUN_ID,
      operationId: GAME_OPERATIONS.seasons,
      batchSize,
    },
  );
  await t.mutation(
    internal.migration.gameFoundation.transformPointsBatch,
    {
      cutoverRunId: RUN_ID,
      operationId: GAME_OPERATIONS.points,
      batchSize,
    },
  );
}

describe("game foundation migration slice", () => {
  test("creates the points checkpoint while leaving games open", async () => {
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
    await expectDomainError(
      t.mutation(
        internal.migration.gameFoundation.transformPointsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.points,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    await t.mutation(
      internal.migration.gameFoundation.transformGameTypesBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: GAME_OPERATIONS.gameTypes,
        batchSize: 10,
      },
    );
    await t.mutation(
      internal.migration.gameFoundation
        .transformGamePointTypesBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: GAME_OPERATIONS.gamePointTypes,
        batchSize: 10,
      },
    );
    await t.mutation(
      internal.migration.gameFoundation.transformSeasonsBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: GAME_OPERATIONS.seasons,
        batchSize: 10,
      },
    );
    await expect(
      t.mutation(
        internal.migration.gameFoundation.transformPointsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.points,
          batchSize: 1,
        },
      ),
    ).resolves.toMatchObject({
      status: "running",
      processedCount: 1,
    });
    await expect(
      t.mutation(
        internal.migration.gameFoundation.transformPointsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.points,
          batchSize: 1,
        },
      ),
    ).resolves.toMatchObject({
      status: "completed",
      processedCount: 2,
    });
    await expect(
      t.mutation(
        internal.migration.gameFoundation.transformPointsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.points,
          batchSize: 1,
        },
      ),
    ).resolves.toMatchObject({
      status: "completed",
      processedCount: 2,
    });

    const snapshot = await t.run(async (ctx) => {
      const gameType = await ctx.db
        .query("gameTypes")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", 1),
        )
        .unique();
      const pointType = await ctx.db
        .query("gamePointTypes")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", 2),
        )
        .unique();
      const season = await ctx.db
        .query("seasons")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", SEASON_ID),
        )
        .unique();
      if (!season) {
        throw new Error("Expected season");
      }
      const points = await ctx.db
        .query("points")
        .withIndex("by_seasonId", (query) =>
          query.eq("seasonId", season._id),
        )
        .take(10);
      const checkpoint = await ctx.db
        .query("migrationCheckpoints")
        .withIndex("by_runId_and_operation", (query) =>
          query
            .eq("runId", RUN_ID)
            .eq("operation", GAME_OPERATIONS.points),
        )
        .unique();
      const domain = await ctx.db
        .query("migrationDomainRuns")
        .withIndex("by_runId_and_domain", (query) =>
          query.eq("runId", RUN_ID).eq("domain", "games"),
        )
        .unique();
      return {
        gameType,
        pointType,
        season,
        points,
        checkpoint,
        domain,
      };
    });
    expect(snapshot.gameType?.normalizedLookupId).toBe(
      "prediction",
    );
    expect(snapshot.pointType?.normalizedLookupId).toBe(
      "correct-guess",
    );
    expect(snapshot.season).toMatchObject({
      startedOn: "2025-01-01",
      endedOn: "2025-12-31",
    });
    expect(snapshot.points).toHaveLength(2);
    expect(
      snapshot.points.find((point) => point.legacyId === POINT_ID_B)
        ?.adjustment,
    ).toBeNull();
    expect(snapshot.checkpoint?.status).toBe("completed");
    expect(snapshot.domain?.status).toBe("running");
  });

  test("requires reconciled identity and reviews plus valid gates", async () => {
    const missing = createTestBackend();
    await initializeAtS1(missing);
    await expectDomainError(startRun(missing), "CONFLICT");

    const transformed = createTestBackend();
    await initializeAtS1(transformed);
    await seedPrerequisites(transformed, "transformed");
    await expectDomainError(startRun(transformed), "CONFLICT");

    const t = createTestBackend();
    await initializeAtS1(t);
    await seedPrerequisites(t);
    await expectDomainError(
      t.mutation(
        internal.migration.gameFoundation.startGameRun,
        {
          cutoverRunId: RUN_ID,
          operationId: "games.wrong",
          sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
          expectedGameTypes: 0,
          expectedGamePointTypes: 0,
          expectedSeasons: 0,
          expectedPoints: 0,
          expectedGuesses: 0,
          expectedGamblingTypes: 0,
          expectedGamblingEntries: 0,
          expectedTagVotes: 0,
          expectedQuoteSubmissions: 0,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      startRun(t, {
        gameTypes: -1,
        gamePointTypes: 0,
        seasons: 0,
        points: 0,
      }),
      "VALIDATION_FAILED",
    );
    await startRun(t, {
      gameTypes: 0,
      gamePointTypes: 0,
      seasons: 0,
      points: 0,
    });
    await expectDomainError(
      t.mutation(
        internal.migration.gameFoundation.transformGameTypesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.points,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.gameFoundation.transformGameTypesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.gameTypes,
          batchSize: 101,
        },
      ),
      "VALIDATION_FAILED",
    );
    await transformAll(t);
    await t.mutation(
      internal.migration.gameFoundation.transformGameTypesBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: GAME_OPERATIONS.gameTypes,
        batchSize: 10,
      },
    );
    await t.mutation(
      internal.migration.gameFoundation
        .transformGamePointTypesBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: GAME_OPERATIONS.gamePointTypes,
        batchSize: 10,
      },
    );
    await t.mutation(
      internal.migration.gameFoundation.transformSeasonsBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: GAME_OPERATIONS.seasons,
        batchSize: 10,
      },
    );
  });

  test("reuses exact canonical foundation records", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await seedPrerequisites(t);
    await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", USER_ID),
        )
        .unique();
      if (!user) {
        throw new Error("Expected user");
      }
      const gameTypeId = await ctx.db.insert("gameTypes", {
        legacyId: 1,
        title: "Prediction Game",
        description: "Synthetic game",
        lookupId: "  PRＥDICTION  ",
        normalizedLookupId: "prediction",
      });
      const pointTypeId = await ctx.db.insert("gamePointTypes", {
        legacyId: 2,
        lookupId: "  CORRECT-GUESS  ",
        normalizedLookupId: "correct-guess",
        title: "Correct Guess",
        description: "Synthetic points",
        points: 5,
        gameTypeId,
      });
      const seasonId = await ctx.db.insert("seasons", {
        legacyId: SEASON_ID,
        title: "Synthetic Season",
        description: "Season description",
        gameTypeId,
        startedOn: "2025-01-01",
        endedOn: "2025-12-31",
      });
      await ctx.db.insert("points", {
        legacyId: POINT_ID_A,
        userId: user._id,
        seasonId,
        reason: "Correct guess",
        earnedAt: 1_700_000_000_000,
        adjustment: 1,
        gamePointTypeId: pointTypeId,
      });
      await ctx.db.insert("points", {
        legacyId: POINT_ID_B,
        userId: user._id,
        seasonId,
        earnedAt: 1_700_000_000_001,
        adjustment: null,
      });
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
        .take(10);
    });
    expect(checkpoints).toHaveLength(4);
    expect(
      checkpoints.every(
        (checkpoint) =>
          checkpoint.insertedCount === 0 &&
          checkpoint.reusedCount === checkpoint.processedCount,
      ),
    ).toBe(true);
  });

  test("rolls back normalized-key collisions and invalid dates", async () => {
    const collision = createTestBackend();
    await initializeAtS1(collision);
    await seedPrerequisites(collision);
    await collision.run(async (ctx) => {
      await ctx.db.insert("migrationRawGameTypes", {
        runId: RUN_ID,
        legacyId: 1,
        title: "First",
        lookupId: "prediction",
        sourceRowHash: "sha256:first",
      });
      await ctx.db.insert("migrationRawGameTypes", {
        runId: RUN_ID,
        legacyId: 2,
        title: "Second",
        lookupId: "  PRＥDICTION  ",
        sourceRowHash: "sha256:second",
      });
    });
    await startRun(collision, {
      gameTypes: 2,
      gamePointTypes: 0,
      seasons: 0,
      points: 0,
    });
    await expectDomainError(
      collision.mutation(
        internal.migration.gameFoundation.transformGameTypesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.gameTypes,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    const gameTypes = await collision.run(async (ctx) => {
      return await ctx.db.query("gameTypes").take(10);
    });
    expect(gameTypes).toHaveLength(0);

    const invalidDate = createTestBackend();
    await initializeAtS1(invalidDate);
    await seedPrerequisites(invalidDate);
    await invalidDate.run(async (ctx) => {
      await ctx.db.insert("migrationRawGameTypes", {
        runId: RUN_ID,
        legacyId: 1,
        title: "Game",
        lookupId: "game",
        sourceRowHash: "sha256:game",
      });
      await ctx.db.insert("migrationRawSeasons", {
        runId: RUN_ID,
        legacyId: SEASON_ID,
        title: "Season",
        gameTypeLegacyId: 1,
        startedOn: "2025-02-30",
        sourceRowHash: "sha256:season",
      });
    });
    await startRun(invalidDate, {
      gameTypes: 1,
      gamePointTypes: 0,
      seasons: 1,
      points: 0,
    });
    await invalidDate.mutation(
      internal.migration.gameFoundation.transformGameTypesBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: GAME_OPERATIONS.gameTypes,
        batchSize: 10,
      },
    );
    await expectDomainError(
      invalidDate.mutation(
        internal.migration.gameFoundation.transformSeasonsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.seasons,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
  });

  test("preserves absent optional foundation fields", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await seedPrerequisites(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("migrationRawGameTypes", {
        runId: RUN_ID,
        legacyId: 1,
        title: "Game",
        lookupId: "game",
        sourceRowHash: "sha256:game",
      });
      await ctx.db.insert("migrationRawGamePointTypes", {
        runId: RUN_ID,
        legacyId: 2,
        lookupId: "point",
        title: "Point",
        points: 1,
        gameTypeLegacyId: 1,
        sourceRowHash: "sha256:point-type",
      });
      await ctx.db.insert("migrationRawSeasons", {
        runId: RUN_ID,
        legacyId: SEASON_ID,
        title: "Season",
        gameTypeLegacyId: 1,
        sourceRowHash: "sha256:season",
      });
    });
    await startRun(t, {
      gameTypes: 1,
      gamePointTypes: 1,
      seasons: 1,
      points: 0,
    });
    await transformAll(t);
    const documents = await t.run(async (ctx) => {
      const gameType = await ctx.db
        .query("gameTypes")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", 1),
        )
        .unique();
      const pointType = await ctx.db
        .query("gamePointTypes")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", 2),
        )
        .unique();
      const season = await ctx.db
        .query("seasons")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", SEASON_ID),
        )
        .unique();
      return { gameType, pointType, season };
    });
    expect(documents.gameType?.description).toBeUndefined();
    expect(documents.pointType?.description).toBeUndefined();
    expect(documents.season?.description).toBeUndefined();
    expect(documents.season?.startedOn).toBeUndefined();
    expect(documents.season?.endedOn).toBeUndefined();
  });

  test("rejects SQL-bound violations and missing parents in order", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await seedPrerequisites(t);
    const rawIds = await t.run(async (ctx) => {
      const gameType = await ctx.db.insert(
        "migrationRawGameTypes",
        {
          runId: RUN_ID,
          legacyId: 256,
          title: "Game",
          lookupId: "game",
          sourceRowHash: "sha256:game",
        },
      );
      const pointType = await ctx.db.insert(
        "migrationRawGamePointTypes",
        {
          runId: RUN_ID,
          legacyId: 2,
          lookupId: "point",
          title: "Point",
          points: 32_768,
          gameTypeLegacyId: 9,
          sourceRowHash: "sha256:point-type",
        },
      );
      const season = await ctx.db.insert("migrationRawSeasons", {
        runId: RUN_ID,
        legacyId: "not-a-uuid",
        title: "Season",
        gameTypeLegacyId: 9,
        startedOn: "not-a-date",
        sourceRowHash: "sha256:season",
      });
      const point = await ctx.db.insert("migrationRawPoints", {
        runId: RUN_ID,
        legacyId: POINT_ID_A,
        userLegacyId: "missing-user",
        seasonLegacyId: SEASON_ID,
        earnedAt: 1,
        adjustment: 2_147_483_648,
        gamePointTypeLegacyId: 9,
        sourceRowHash: "sha256:point",
      });
      return { gameType, pointType, season, point };
    });
    await startRun(t, {
      gameTypes: 1,
      gamePointTypes: 1,
      seasons: 1,
      points: 1,
    });
    await expectDomainError(
      t.mutation(
        internal.migration.gameFoundation.transformGameTypesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.gameTypes,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(
        "migrationRawGameTypes",
        rawIds.gameType,
        { legacyId: 1 },
      );
    });
    await t.mutation(
      internal.migration.gameFoundation.transformGameTypesBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: GAME_OPERATIONS.gameTypes,
        batchSize: 10,
      },
    );

    await expectDomainError(
      t.mutation(
        internal.migration.gameFoundation
          .transformGamePointTypesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.gamePointTypes,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(
        "migrationRawGamePointTypes",
        rawIds.pointType,
        { points: 1 },
      );
    });
    await expectDomainError(
      t.mutation(
        internal.migration.gameFoundation
          .transformGamePointTypesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.gamePointTypes,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(
        "migrationRawGamePointTypes",
        rawIds.pointType,
        { gameTypeLegacyId: 1 },
      );
    });
    await t.mutation(
      internal.migration.gameFoundation
        .transformGamePointTypesBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: GAME_OPERATIONS.gamePointTypes,
        batchSize: 10,
      },
    );

    await expectDomainError(
      t.mutation(
        internal.migration.gameFoundation.transformSeasonsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.seasons,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("migrationRawSeasons", rawIds.season, {
        legacyId: SEASON_ID,
      });
    });
    await expectDomainError(
      t.mutation(
        internal.migration.gameFoundation.transformSeasonsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.seasons,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("migrationRawSeasons", rawIds.season, {
        startedOn: "2025-01-01",
      });
    });
    await expectDomainError(
      t.mutation(
        internal.migration.gameFoundation.transformSeasonsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.seasons,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("migrationRawSeasons", rawIds.season, {
        gameTypeLegacyId: 1,
      });
    });
    await t.mutation(
      internal.migration.gameFoundation.transformSeasonsBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: GAME_OPERATIONS.seasons,
        batchSize: 10,
      },
    );

    await expectDomainError(
      t.mutation(
        internal.migration.gameFoundation.transformPointsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.points,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("migrationRawPoints", rawIds.point, {
        adjustment: 0,
      });
    });
    await expectDomainError(
      t.mutation(
        internal.migration.gameFoundation.transformPointsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.points,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("migrationRawPoints", rawIds.point, {
        userLegacyId: USER_ID,
      });
    });
    await expectDomainError(
      t.mutation(
        internal.migration.gameFoundation.transformPointsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.points,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("migrationRawPoints", rawIds.point, {
        gamePointTypeLegacyId: 2,
      });
    });
    await t.mutation(
      internal.migration.gameFoundation.transformPointsBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: GAME_OPERATIONS.points,
        batchSize: 10,
      },
    );
  });

  test("rejects canonical game-type drift", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await seedPrerequisites(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("gameTypes", {
        legacyId: 1,
        title: "Existing",
        lookupId: "game",
        normalizedLookupId: "game",
      });
      await ctx.db.insert("migrationRawGameTypes", {
        runId: RUN_ID,
        legacyId: 1,
        title: "Incoming",
        lookupId: "game",
        sourceRowHash: "sha256:game",
      });
    });
    await startRun(t, {
      gameTypes: 1,
      gamePointTypes: 0,
      seasons: 0,
      points: 0,
    });
    await expectDomainError(
      t.mutation(
        internal.migration.gameFoundation.transformGameTypesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: GAME_OPERATIONS.gameTypes,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
  });
});
