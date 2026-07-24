/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { internal } from "./_generated/api.js";
import {
  RANKING_OPERATIONS,
  RANKING_RECONCILIATION_OPERATIONS,
  SOURCE_SCHEMA_FINGERPRINT,
} from "./migration/constants.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const RUN_ID = "ranking-test-001";
const USER_ID = "legacy-ranking-user";
const MOVIE_ID = "00000000-0000-0000-0000-000000000101";
const SHOW_ID = "00000000-0000-0000-0000-000000000102";
const EPISODE_ID = "00000000-0000-0000-0000-000000000103";
const MOVIE_TYPE_ID =
  "00000000-0000-0000-0000-000000000201";
const SHOW_TYPE_ID = "00000000-0000-0000-0000-000000000202";
const EPISODE_TYPE_ID =
  "00000000-0000-0000-0000-000000000203";
const MOVIE_LIST_ID =
  "00000000-0000-0000-0000-000000000301";
const SHOW_LIST_ID = "00000000-0000-0000-0000-000000000302";
const EPISODE_LIST_ID =
  "00000000-0000-0000-0000-000000000303";
const MOVIE_ITEM_ID =
  "00000000-0000-0000-0000-000000000401";
const SHOW_ITEM_ID = "00000000-0000-0000-0000-000000000402";
const EPISODE_ITEM_ID =
  "00000000-0000-0000-0000-000000000403";

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
    actor: "ranking-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "ranking-test",
  });
}

async function seedPrerequisites(
  t: TestBackend,
  statuses: {
    identity: "reconciled" | "transformed";
    catalog: "reconciled" | "transformed";
    episodes: "reconciled" | "transformed";
  } = {
    identity: "reconciled",
    catalog: "reconciled",
    episodes: "reconciled",
  },
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("migrationRuns", {
      runId: RUN_ID,
      sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
      status: "running",
      startedAt: 1,
      updatedAt: 1,
    });
    for (const domain of [
      "identity",
      "catalog",
      "episodes",
    ] as const) {
      await ctx.db.insert("migrationDomainRuns", {
        runId: RUN_ID,
        domain,
        status: statuses[domain],
        expectedCounts: {},
        startedAt: 1,
        updatedAt: 1,
      });
    }
    await ctx.db.insert("users", {
      legacyId: USER_ID,
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("movies", {
      legacyId: MOVIE_ID,
      title: "Movie",
      normalizedTitle: "movie",
      year: 2025,
      url: "https://example.invalid/movie",
    });
    await ctx.db.insert("shows", {
      legacyId: SHOW_ID,
      title: "Show",
      normalizedTitle: "show",
      year: 2025,
      url: "https://example.invalid/show",
    });
    await ctx.db.insert("episodes", {
      legacyId: EPISODE_ID,
      number: 1,
      title: "Episode",
    });
  });
}

async function seedRawRows(t: TestBackend): Promise<void> {
  await t.run(async (ctx) => {
    for (const row of [
      {
        legacyId: MOVIE_TYPE_ID,
        name: "Movies",
        description: "Movie rankings",
        targetType: "MOVIE" as const,
      },
      {
        legacyId: SHOW_TYPE_ID,
        name: "Shows",
        description: undefined,
        targetType: "SHOW" as const,
      },
      {
        legacyId: EPISODE_TYPE_ID,
        name: "Episodes",
        description: "Episode rankings",
        targetType: "EPISODE" as const,
      },
    ]) {
      await ctx.db.insert("migrationRawRankedListTypes", {
        runId: RUN_ID,
        legacyId: row.legacyId,
        name: row.name,
        ...(row.description === undefined
          ? {}
          : { description: row.description }),
        maxItems: 3,
        targetType: row.targetType,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_001,
        sourceRowHash: `sha256:type-${row.legacyId}`,
      });
    }
    for (const row of [
      {
        legacyId: MOVIE_LIST_ID,
        typeId: MOVIE_TYPE_ID,
        status: "PUBLISHED" as const,
        title: "Favorite Movies",
      },
      {
        legacyId: SHOW_LIST_ID,
        typeId: SHOW_TYPE_ID,
        status: "DRAFT" as const,
        title: undefined,
      },
      {
        legacyId: EPISODE_LIST_ID,
        typeId: EPISODE_TYPE_ID,
        status: "DRAFT" as const,
        title: "Favorite Episodes",
      },
    ]) {
      await ctx.db.insert("migrationRawRankedLists", {
        runId: RUN_ID,
        legacyId: row.legacyId,
        userLegacyId: USER_ID,
        rankedListTypeLegacyId: row.typeId,
        status: row.status,
        ...(row.title === undefined ? {} : { title: row.title }),
        createdAt: 1_700_000_000_100,
        updatedAt: 1_700_000_000_101,
        sourceRowHash: `sha256:list-${row.legacyId}`,
      });
    }
    await ctx.db.insert("migrationRawRankedItems", {
      runId: RUN_ID,
      legacyId: MOVIE_ITEM_ID,
      rankedListLegacyId: MOVIE_LIST_ID,
      movieLegacyId: MOVIE_ID,
      rank: 1,
      comment: "Movie comment",
      createdAt: 1_700_000_000_200,
      updatedAt: 1_700_000_000_201,
      sourceRowHash: "sha256:movie-item",
    });
    await ctx.db.insert("migrationRawRankedItems", {
      runId: RUN_ID,
      legacyId: SHOW_ITEM_ID,
      rankedListLegacyId: SHOW_LIST_ID,
      showLegacyId: SHOW_ID,
      rank: 1,
      createdAt: 1_700_000_000_202,
      updatedAt: 1_700_000_000_203,
      sourceRowHash: "sha256:show-item",
    });
    await ctx.db.insert("migrationRawRankedItems", {
      runId: RUN_ID,
      legacyId: EPISODE_ITEM_ID,
      rankedListLegacyId: EPISODE_LIST_ID,
      episodeLegacyId: EPISODE_ID,
      rank: 1,
      comment: "Episode comment",
      createdAt: 1_700_000_000_204,
      updatedAt: 1_700_000_000_205,
      sourceRowHash: "sha256:episode-item",
    });
  });
}

async function startRun(
  t: TestBackend,
  counts = { listTypes: 3, lists: 3, items: 3 },
) {
  return await t.mutation(
    internal.migration.rankings.startRankingRun,
    {
      cutoverRunId: RUN_ID,
      operationId: RANKING_OPERATIONS.start,
      sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
      expectedListTypes: counts.listTypes,
      expectedLists: counts.lists,
      expectedItems: counts.items,
    },
  );
}

async function transformAll(
  t: TestBackend,
  batchSize = 100,
): Promise<void> {
  await t.mutation(
    internal.migration.rankings.transformListTypesBatch,
    {
      cutoverRunId: RUN_ID,
      operationId: RANKING_OPERATIONS.listTypes,
      batchSize,
    },
  );
  await t.mutation(
    internal.migration.rankings.transformListsBatch,
    {
      cutoverRunId: RUN_ID,
      operationId: RANKING_OPERATIONS.lists,
      batchSize,
    },
  );
  await t.mutation(
    internal.migration.rankings.transformItemsBatch,
    {
      cutoverRunId: RUN_ID,
      operationId: RANKING_OPERATIONS.items,
      batchSize,
    },
  );
}

async function finishTransform(t: TestBackend) {
  return await t.mutation(
    internal.migration.rankings.finishRankingRun,
    {
      cutoverRunId: RUN_ID,
      operationId: RANKING_OPERATIONS.finish,
    },
  );
}

async function reconcileAll(
  t: TestBackend,
  batchSize = 100,
): Promise<void> {
  await t.mutation(
    internal.migration.rankingReconciliation
      .reconcileListTypesBatch,
    {
      cutoverRunId: RUN_ID,
      operationId: RANKING_RECONCILIATION_OPERATIONS.listTypes,
      batchSize,
    },
  );
  await t.mutation(
    internal.migration.rankingReconciliation.reconcileListsBatch,
    {
      cutoverRunId: RUN_ID,
      operationId: RANKING_RECONCILIATION_OPERATIONS.lists,
      batchSize,
    },
  );
  await t.mutation(
    internal.migration.rankingReconciliation.reconcileItemsBatch,
    {
      cutoverRunId: RUN_ID,
      operationId: RANKING_RECONCILIATION_OPERATIONS.items,
      batchSize,
    },
  );
}

async function prepareFixture(t: TestBackend): Promise<void> {
  await initializeAtS1(t);
  await seedPrerequisites(t);
  await seedRawRows(t);
  await startRun(t);
}

describe("ranking migration slice", () => {
  test("transforms, reuses, independently reconciles, and finishes", async () => {
    const t = createTestBackend();
    await prepareFixture(t);

    await expect(
      t.mutation(
        internal.migration.rankings.transformListTypesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: RANKING_OPERATIONS.listTypes,
          batchSize: 2,
        },
      ),
    ).resolves.toMatchObject({
      status: "running",
      processedCount: 2,
    });
    await t.mutation(
      internal.migration.rankings.transformListTypesBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: RANKING_OPERATIONS.listTypes,
        batchSize: 2,
      },
    );
    await t.mutation(
      internal.migration.rankings.transformListsBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: RANKING_OPERATIONS.lists,
        batchSize: 100,
      },
    );
    await t.mutation(
      internal.migration.rankings.transformItemsBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: RANKING_OPERATIONS.items,
        batchSize: 100,
      },
    );

    const snapshot = await t.run(async (ctx) => {
      return {
        types: await ctx.db.query("rankedListTypes").take(10),
        lists: await ctx.db.query("rankedLists").take(10),
        items: await ctx.db.query("rankedItems").take(10),
      };
    });
    expect(snapshot.types).toHaveLength(3);
    expect(snapshot.lists).toHaveLength(3);
    expect(snapshot.items).toHaveLength(3);
    expect(
      snapshot.items.map((item) => item.targetType).sort(),
    ).toEqual(["episode", "movie", "show"]);
    expect(
      snapshot.lists.find(
        (list) => list.legacyId === SHOW_LIST_ID,
      )?.title,
    ).toBeUndefined();

    await t.run(async (ctx) => {
      for (const operation of [
        RANKING_OPERATIONS.listTypes,
        RANKING_OPERATIONS.lists,
        RANKING_OPERATIONS.items,
      ]) {
        const checkpoint = await ctx.db
          .query("migrationCheckpoints")
          .withIndex("by_runId_and_operation", (query) =>
            query.eq("runId", RUN_ID).eq("operation", operation),
          )
          .unique();
        if (!checkpoint) {
          throw new Error("Expected ranking checkpoint");
        }
        await ctx.db.delete("migrationCheckpoints", checkpoint._id);
      }
    });
    await transformAll(t);
    const reused = await t.run(async (ctx) => {
      return await ctx.db
        .query("migrationCheckpoints")
        .withIndex("by_runId_and_operation", (query) =>
          query.eq("runId", RUN_ID),
        )
        .take(10);
    });
    expect(
      reused.every(
        (checkpoint) =>
          checkpoint.insertedCount === 0 &&
          checkpoint.reusedCount === checkpoint.processedCount,
      ),
    ).toBe(true);
    await expect(finishTransform(t)).resolves.toMatchObject({
      runId: RUN_ID,
      status: "transformed",
      counts: { listTypes: 3, lists: 3, items: 3 },
    });

    await expectDomainError(
      t.mutation(
        internal.migration.rankingReconciliation
          .finishRankingReconciliation,
        {
          cutoverRunId: RUN_ID,
          operationId: RANKING_RECONCILIATION_OPERATIONS.finish,
        },
      ),
      "CONFLICT",
    );
    await reconcileAll(t, 1);
    await reconcileAll(t, 1);
    await reconcileAll(t, 1);
    await reconcileAll(t, 1);
    const reconciled = await t.mutation(
      internal.migration.rankingReconciliation
        .finishRankingReconciliation,
      {
        cutoverRunId: RUN_ID,
        operationId: RANKING_RECONCILIATION_OPERATIONS.finish,
      },
    );
    expect(reconciled).toMatchObject({
      runId: RUN_ID,
      status: "reconciled",
      counts: { listTypes: 3, lists: 3, items: 3 },
    });
    await expect(
      t.mutation(
        internal.migration.rankingReconciliation
          .finishRankingReconciliation,
        {
          cutoverRunId: RUN_ID,
          operationId: RANKING_RECONCILIATION_OPERATIONS.finish,
        },
      ),
    ).resolves.toEqual(reconciled);
  });

  test("requires all prerequisite domains and valid migration gates", async () => {
    const missing = createTestBackend();
    await initializeAtS1(missing);
    await expectDomainError(startRun(missing), "CONFLICT");

    const transformed = createTestBackend();
    await initializeAtS1(transformed);
    await seedPrerequisites(transformed, {
      identity: "reconciled",
      catalog: "reconciled",
      episodes: "transformed",
    });
    await expectDomainError(startRun(transformed), "CONFLICT");

    const t = createTestBackend();
    await initializeAtS1(t);
    await seedPrerequisites(t);
    await expectDomainError(
      t.mutation(internal.migration.rankings.startRankingRun, {
        cutoverRunId: RUN_ID,
        operationId: RANKING_OPERATIONS.start,
        sourceSchemaFingerprint: "wrong",
        expectedListTypes: 0,
        expectedLists: 0,
        expectedItems: 0,
      }),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      startRun(t, { listTypes: -1, lists: 0, items: 0 }),
      "VALIDATION_FAILED",
    );
    await startRun(t, { listTypes: 0, lists: 0, items: 0 });
    await expectDomainError(
      t.mutation(
        internal.migration.rankings.transformListTypesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: RANKING_OPERATIONS.items,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.rankings.transformListTypesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: RANKING_OPERATIONS.listTypes,
          batchSize: 101,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(finishTransform(t), "CONFLICT");
  });

  test("rejects target-shape, target-type, and rank violations", async () => {
    const none = createTestBackend();
    await initializeAtS1(none);
    await seedPrerequisites(none);
    await startRun(none, { listTypes: 1, lists: 1, items: 1 });
    const itemId = await none.run(async (ctx) => {
      await ctx.db.insert("migrationRawRankedListTypes", {
        runId: RUN_ID,
        legacyId: MOVIE_TYPE_ID,
        name: "Movies",
        maxItems: 1,
        targetType: "MOVIE",
        createdAt: 1,
        updatedAt: 1,
        sourceRowHash: "sha256:type",
      });
      await ctx.db.insert("migrationRawRankedLists", {
        runId: RUN_ID,
        legacyId: MOVIE_LIST_ID,
        userLegacyId: USER_ID,
        rankedListTypeLegacyId: MOVIE_TYPE_ID,
        status: "DRAFT",
        createdAt: 1,
        updatedAt: 1,
        sourceRowHash: "sha256:list",
      });
      return await ctx.db.insert("migrationRawRankedItems", {
        runId: RUN_ID,
        legacyId: MOVIE_ITEM_ID,
        rankedListLegacyId: MOVIE_LIST_ID,
        rank: 1,
        createdAt: 1,
        updatedAt: 1,
        sourceRowHash: "sha256:item",
      });
    });
    await none.mutation(
      internal.migration.rankings.transformListTypesBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: RANKING_OPERATIONS.listTypes,
        batchSize: 10,
      },
    );
    await none.mutation(
      internal.migration.rankings.transformListsBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: RANKING_OPERATIONS.lists,
        batchSize: 10,
      },
    );
    await expectDomainError(
      none.mutation(
        internal.migration.rankings.transformItemsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: RANKING_OPERATIONS.items,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
    await none.run(async (ctx) => {
      await ctx.db.patch("migrationRawRankedItems", itemId, {
        showLegacyId: SHOW_ID,
      });
    });
    await expectDomainError(
      none.mutation(
        internal.migration.rankings.transformItemsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: RANKING_OPERATIONS.items,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
    await none.run(async (ctx) => {
      await ctx.db.patch("migrationRawRankedItems", itemId, {
        showLegacyId: undefined,
        movieLegacyId: MOVIE_ID,
        rank: 2,
      });
    });
    await expectDomainError(
      none.mutation(
        internal.migration.rankings.transformItemsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: RANKING_OPERATIONS.items,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
  });

  test("rolls back duplicate list/rank keys", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await seedPrerequisites(t);
    await startRun(t, { listTypes: 1, lists: 1, items: 2 });
    await t.run(async (ctx) => {
      await ctx.db.insert("migrationRawRankedListTypes", {
        runId: RUN_ID,
        legacyId: MOVIE_TYPE_ID,
        name: "Movies",
        maxItems: 3,
        targetType: "MOVIE",
        createdAt: 1,
        updatedAt: 1,
        sourceRowHash: "sha256:type",
      });
      await ctx.db.insert("migrationRawRankedLists", {
        runId: RUN_ID,
        legacyId: MOVIE_LIST_ID,
        userLegacyId: USER_ID,
        rankedListTypeLegacyId: MOVIE_TYPE_ID,
        status: "DRAFT",
        createdAt: 1,
        updatedAt: 1,
        sourceRowHash: "sha256:list",
      });
      for (const legacyId of [
        MOVIE_ITEM_ID,
        "00000000-0000-0000-0000-000000000404",
      ]) {
        await ctx.db.insert("migrationRawRankedItems", {
          runId: RUN_ID,
          legacyId,
          rankedListLegacyId: MOVIE_LIST_ID,
          movieLegacyId: MOVIE_ID,
          rank: 1,
          createdAt: 1,
          updatedAt: 1,
          sourceRowHash: `sha256:${legacyId}`,
        });
      }
    });
    await t.mutation(
      internal.migration.rankings.transformListTypesBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: RANKING_OPERATIONS.listTypes,
        batchSize: 10,
      },
    );
    await t.mutation(
      internal.migration.rankings.transformListsBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: RANKING_OPERATIONS.lists,
        batchSize: 10,
      },
    );
    await expectDomainError(
      t.mutation(
        internal.migration.rankings.transformItemsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: RANKING_OPERATIONS.items,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    expect(
      await t.run(async (ctx) =>
        await ctx.db.query("rankedItems").take(10),
      ),
    ).toHaveLength(0);
  });

  test("rejects malformed values, missing parents, and canonical drift", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await seedPrerequisites(t);
    await startRun(t, { listTypes: 1, lists: 1, items: 0 });
    const typeId = await t.run(async (ctx) => {
      return await ctx.db.insert("migrationRawRankedListTypes", {
        runId: RUN_ID,
        legacyId: "not-a-uuid",
        name: "Movies",
        maxItems: 101,
        targetType: "MOVIE",
        createdAt: 1,
        updatedAt: 1,
        sourceRowHash: "sha256:type",
      });
    });
    await expectDomainError(
      t.mutation(
        internal.migration.rankings.transformListTypesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: RANKING_OPERATIONS.listTypes,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("migrationRawRankedListTypes", typeId, {
        legacyId: MOVIE_TYPE_ID,
      });
    });
    await expectDomainError(
      t.mutation(
        internal.migration.rankings.transformListTypesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: RANKING_OPERATIONS.listTypes,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("migrationRawRankedListTypes", typeId, {
        maxItems: 3,
      });
    });
    await t.mutation(
      internal.migration.rankings.transformListTypesBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: RANKING_OPERATIONS.listTypes,
        batchSize: 10,
      },
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("migrationRawRankedLists", {
        runId: RUN_ID,
        legacyId: MOVIE_LIST_ID,
        userLegacyId: "missing-user",
        rankedListTypeLegacyId: MOVIE_TYPE_ID,
        status: "DRAFT",
        createdAt: 1,
        updatedAt: 1,
        sourceRowHash: "sha256:list",
      });
    });
    await expectDomainError(
      t.mutation(
        internal.migration.rankings.transformListsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: RANKING_OPERATIONS.lists,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    const drift = createTestBackend();
    await prepareFixture(drift);
    await transformAll(drift);
    await finishTransform(drift);
    await drift.run(async (ctx) => {
      const item = await ctx.db
        .query("rankedItems")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", MOVIE_ITEM_ID),
        )
        .unique();
      if (!item) {
        throw new Error("Expected movie item");
      }
      await ctx.db.patch("rankedItems", item._id, {
        comment: "Drifted",
      });
    });
    await expectDomainError(
      drift.mutation(
        internal.migration.rankingReconciliation
          .reconcileItemsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: RANKING_RECONCILIATION_OPERATIONS.items,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
  });

  test("reconciliation rejects every missing parent and source drift class", async () => {
    const t = createTestBackend();
    await prepareFixture(t);
    await transformAll(t);
    await finishTransform(t);

    const documents = await t.run(async (ctx) => {
      const movieList = await ctx.db
        .query("migrationRawRankedLists")
        .withIndex("by_runId_and_legacyId", (query) =>
          query.eq("runId", RUN_ID).eq("legacyId", MOVIE_LIST_ID),
        )
        .unique();
      const movieItem = await ctx.db
        .query("migrationRawRankedItems")
        .withIndex("by_runId_and_legacyId", (query) =>
          query.eq("runId", RUN_ID).eq("legacyId", MOVIE_ITEM_ID),
        )
        .unique();
      const showItem = await ctx.db
        .query("migrationRawRankedItems")
        .withIndex("by_runId_and_legacyId", (query) =>
          query.eq("runId", RUN_ID).eq("legacyId", SHOW_ITEM_ID),
        )
        .unique();
      const episodeItem = await ctx.db
        .query("migrationRawRankedItems")
        .withIndex("by_runId_and_legacyId", (query) =>
          query.eq("runId", RUN_ID).eq("legacyId", EPISODE_ITEM_ID),
        )
        .unique();
      const canonicalMovieList = await ctx.db
        .query("rankedLists")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", MOVIE_LIST_ID),
        )
        .unique();
      const canonicalMovieType = await ctx.db
        .query("rankedListTypes")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", MOVIE_TYPE_ID),
        )
        .unique();
      if (
        !movieList ||
        !movieItem ||
        !showItem ||
        !episodeItem ||
        !canonicalMovieList ||
        !canonicalMovieType
      ) {
        throw new Error("Expected complete ranking fixture");
      }
      return {
        movieList,
        movieItem,
        showItem,
        episodeItem,
        canonicalMovieList,
        canonicalMovieType,
      };
    });
    const reconcileLists = () =>
      t.mutation(
        internal.migration.rankingReconciliation
          .reconcileListsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: RANKING_RECONCILIATION_OPERATIONS.lists,
          batchSize: 10,
        },
      );
    const reconcileItems = () =>
      t.mutation(
        internal.migration.rankingReconciliation
          .reconcileItemsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: RANKING_RECONCILIATION_OPERATIONS.items,
          batchSize: 10,
        },
      );

    await t.run(async (ctx) => {
      await ctx.db.patch(
        "migrationRawRankedLists",
        documents.movieList._id,
        { userLegacyId: "missing-user" },
      );
    });
    await expectDomainError(reconcileLists(), "CONFLICT");
    await t.run(async (ctx) => {
      await ctx.db.patch(
        "migrationRawRankedLists",
        documents.movieList._id,
        {
          userLegacyId: USER_ID,
          rankedListTypeLegacyId:
            "00000000-0000-0000-0000-000000000299",
        },
      );
    });
    await expectDomainError(reconcileLists(), "CONFLICT");
    await t.run(async (ctx) => {
      await ctx.db.patch(
        "migrationRawRankedLists",
        documents.movieList._id,
        { rankedListTypeLegacyId: MOVIE_TYPE_ID },
      );
      await ctx.db.patch(
        "migrationRawRankedItems",
        documents.movieItem._id,
        {
          rankedListLegacyId:
            "00000000-0000-0000-0000-000000000399",
        },
      );
    });
    await expectDomainError(reconcileItems(), "CONFLICT");
    await t.run(async (ctx) => {
      await ctx.db.patch(
        "migrationRawRankedItems",
        documents.movieItem._id,
        {
          rankedListLegacyId: MOVIE_LIST_ID,
          movieLegacyId:
            "00000000-0000-0000-0000-000000000199",
        },
      );
    });
    await expectDomainError(reconcileItems(), "CONFLICT");
    await t.run(async (ctx) => {
      await ctx.db.patch(
        "migrationRawRankedItems",
        documents.movieItem._id,
        { movieLegacyId: MOVIE_ID },
      );
      await ctx.db.patch(
        "migrationRawRankedItems",
        documents.showItem._id,
        {
          showLegacyId:
            "00000000-0000-0000-0000-000000000198",
        },
      );
    });
    await expectDomainError(reconcileItems(), "CONFLICT");
    await t.run(async (ctx) => {
      await ctx.db.patch(
        "migrationRawRankedItems",
        documents.showItem._id,
        { showLegacyId: SHOW_ID },
      );
      await ctx.db.patch(
        "migrationRawRankedItems",
        documents.episodeItem._id,
        {
          episodeLegacyId:
            "00000000-0000-0000-0000-000000000197",
        },
      );
    });
    await expectDomainError(reconcileItems(), "CONFLICT");
    await t.run(async (ctx) => {
      await ctx.db.patch(
        "migrationRawRankedItems",
        documents.episodeItem._id,
        { episodeLegacyId: EPISODE_ID },
      );
      await ctx.db.patch(
        "migrationRawRankedItems",
        documents.movieItem._id,
        { showLegacyId: SHOW_ID },
      );
    });
    await expectDomainError(reconcileItems(), "CONFLICT");
    await t.run(async (ctx) => {
      await ctx.db.patch(
        "migrationRawRankedItems",
        documents.movieItem._id,
        { movieLegacyId: undefined },
      );
    });
    await expectDomainError(reconcileItems(), "CONFLICT");
    await t.run(async (ctx) => {
      await ctx.db.patch(
        "migrationRawRankedItems",
        documents.movieItem._id,
        {
          movieLegacyId: MOVIE_ID,
          showLegacyId: undefined,
        },
      );
      await ctx.db.patch(
        "rankedLists",
        documents.canonicalMovieList._id,
        { title: "Drifted" },
      );
    });
    await expectDomainError(reconcileLists(), "CONFLICT");
    await t.run(async (ctx) => {
      await ctx.db.patch(
        "rankedListTypes",
        documents.canonicalMovieType._id,
        { name: "Drifted" },
      );
    });
    await expectDomainError(
      t.mutation(
        internal.migration.rankingReconciliation
          .reconcileListTypesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId:
            RANKING_RECONCILIATION_OPERATIONS.listTypes,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    await t.run(async (ctx) => {
      await ctx.db.delete(
        "rankedListTypes",
        documents.canonicalMovieType._id,
      );
    });
    await expectDomainError(reconcileItems(), "CONFLICT");
  });
});
