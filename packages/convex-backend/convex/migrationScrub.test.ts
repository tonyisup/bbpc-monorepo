/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { internal } from "./_generated/api.js";
import {
  FOUNDATION_SCRUB_OPERATIONS,
  FOUNDATION_SCRUB_SCOPE,
  SOURCE_SCHEMA_FINGERPRINT,
} from "./migration/constants.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "foundation-scrub-test-001";

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
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "foundation-scrub-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "foundation-scrub-test",
  });
}

async function seedReconciledFoundation(
  t: TestBackend,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("migrationRuns", {
      runId: CUTOVER_RUN_ID,
      sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
      status: "running",
      startedAt: 1,
      updatedAt: 1,
    });
    for (const domain of ["identity", "catalog", "episodes"]) {
      await ctx.db.insert("migrationDomainRuns", {
        runId: CUTOVER_RUN_ID,
        domain,
        status: "reconciled",
        expectedCounts: {},
        startedAt: 1,
        updatedAt: 1,
      });
    }
  });
}

async function startScrub(t: TestBackend) {
  return await t.mutation(
    internal.migration.scrub.startFoundationScrub,
    {
      cutoverRunId: CUTOVER_RUN_ID,
      operationId: FOUNDATION_SCRUB_OPERATIONS.start,
    },
  );
}

async function runUntilDone(
  invoke: () => Promise<{
    deletedThisBatch: number;
    totalDeleted: number;
    done: boolean;
  }>,
): Promise<{
  deletedThisBatch: number;
  totalDeleted: number;
  done: boolean;
}> {
  let result = await invoke();
  for (let attempt = 0; !result.done && attempt < 20; attempt += 1) {
    result = await invoke();
  }
  expect(result.done).toBe(true);
  return result;
}

describe("foundation raw staging scrub", () => {
  test("deletes only ephemeral staging and checkpoints in bounded batches", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await seedReconciledFoundation(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("movies", {
        legacyId: "00000000-0000-0000-0000-000000000001",
        title: "Canonical survives",
        normalizedTitle: "canonical survives",
        year: 2024,
        url: "https://example.test/movie",
      });
      await ctx.db.insert("migrationRawUsers", {
        runId: CUTOVER_RUN_ID,
        legacyId: "user",
        sourceRowHash: "sha256:user",
      });
      await ctx.db.insert("migrationRawRoles", {
        runId: CUTOVER_RUN_ID,
        legacyId: 1,
        name: "Role",
        description: "Role",
        admin: false,
        sourceRowHash: "sha256:role",
      });
      await ctx.db.insert("migrationRawUserRoles", {
        runId: CUTOVER_RUN_ID,
        legacyId: "00000000-0000-0000-0000-000000000011",
        userLegacyId: "user",
        roleLegacyId: 1,
        sourceRowHash: "sha256:user-role",
      });
      await ctx.db.insert("migrationRawMovies", {
        runId: CUTOVER_RUN_ID,
        legacyId: "00000000-0000-0000-0000-000000000021",
        title: "Movie",
        year: 2024,
        url: "https://example.test/movie",
        sourceRowHash: "sha256:movie",
      });
      await ctx.db.insert("migrationRawShows", {
        runId: CUTOVER_RUN_ID,
        legacyId: "00000000-0000-0000-0000-000000000022",
        title: "Show",
        year: 2024,
        url: "https://example.test/show",
        sourceRowHash: "sha256:show",
      });
      await ctx.db.insert("migrationRawTags", {
        runId: CUTOVER_RUN_ID,
        legacyId: "00000000-0000-0000-0000-000000000023",
        name: "Tag",
        createdAt: 1,
        sourceRowHash: "sha256:tag",
      });
      await ctx.db.insert("migrationRawEpisodes", {
        runId: CUTOVER_RUN_ID,
        legacyId: "00000000-0000-0000-0000-000000000031",
        number: 1,
        title: "Episode",
        sourceRowHash: "sha256:episode",
      });
      await ctx.db.insert("migrationRawEpisodeLinks", {
        runId: CUTOVER_RUN_ID,
        legacyId: "00000000-0000-0000-0000-000000000032",
        url: "https://example.test/link",
        text: "Link",
        sourceRowHash: "sha256:episode-link",
      });
      await ctx.db.insert("migrationRawBangers", {
        runId: CUTOVER_RUN_ID,
        legacyId: "00000000-0000-0000-0000-000000000033",
        title: "Song",
        artist: "Artist",
        url: "https://example.test/song",
        sourceRowHash: "sha256:banger",
      });
      await ctx.db.insert("migrationRawEpisodeAudioMessages", {
        runId: CUTOVER_RUN_ID,
        legacyId: 1,
        url: "https://example.test/audio",
        createdAt: 1,
        userLegacyId: "user",
        sourceRowHash: "sha256:audio",
      });
      for (const operation of ["transform", "reconcile"]) {
        await ctx.db.insert("migrationCheckpoints", {
          runId: CUTOVER_RUN_ID,
          operation,
          status: "completed",
          processedCount: 1,
          insertedCount: 1,
          reusedCount: 0,
          updatedAt: 1,
        });
      }
    });

    await expect(startScrub(t)).resolves.toEqual({
      runId: CUTOVER_RUN_ID,
      scope: FOUNDATION_SCRUB_SCOPE,
      status: "running",
      created: true,
    });
    await expect(startScrub(t)).resolves.toMatchObject({
      status: "running",
      created: false,
    });
    const identity = await runUntilDone(() =>
      t.mutation(internal.migration.scrub.scrubIdentityRawBatch, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: FOUNDATION_SCRUB_OPERATIONS.identity,
        batchSize: 1,
      }),
    );
    const catalog = await runUntilDone(() =>
      t.mutation(internal.migration.scrub.scrubCatalogRawBatch, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: FOUNDATION_SCRUB_OPERATIONS.catalog,
        batchSize: 1,
      }),
    );
    const episodes = await runUntilDone(() =>
      t.mutation(internal.migration.scrub.scrubEpisodeRawBatch, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: FOUNDATION_SCRUB_OPERATIONS.episodes,
        batchSize: 1,
      }),
    );
    const checkpoints = await runUntilDone(() =>
      t.mutation(internal.migration.scrub.scrubCheckpointsBatch, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: FOUNDATION_SCRUB_OPERATIONS.checkpoints,
        batchSize: 1,
      }),
    );
    expect(identity.totalDeleted).toBe(3);
    expect(catalog.totalDeleted).toBe(3);
    expect(episodes.totalDeleted).toBe(4);
    expect(checkpoints.totalDeleted).toBe(2);

    const completed = await t.mutation(
      internal.migration.scrub.finishFoundationScrub,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: FOUNDATION_SCRUB_OPERATIONS.finish,
      },
    );
    expect(completed).toEqual({
      runId: CUTOVER_RUN_ID,
      scope: FOUNDATION_SCRUB_SCOPE,
      status: "completed",
      identityRawRowsDeleted: 3,
      catalogRawRowsDeleted: 3,
      episodeRawRowsDeleted: 4,
      checkpointsDeleted: 2,
    });
    await expect(
      t.mutation(
        internal.migration.scrub.scrubIdentityRawBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: FOUNDATION_SCRUB_OPERATIONS.identity,
          batchSize: 1,
        },
      ),
    ).resolves.toMatchObject({
      deletedThisBatch: 0,
      done: true,
      totalDeleted: 3,
    });
    await expect(
      t.mutation(
        internal.migration.scrub.scrubCatalogRawBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: FOUNDATION_SCRUB_OPERATIONS.catalog,
          batchSize: 1,
        },
      ),
    ).resolves.toMatchObject({
      deletedThisBatch: 0,
      done: true,
      totalDeleted: 3,
    });
    await expect(
      t.mutation(
        internal.migration.scrub.scrubEpisodeRawBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: FOUNDATION_SCRUB_OPERATIONS.episodes,
          batchSize: 1,
        },
      ),
    ).resolves.toMatchObject({
      deletedThisBatch: 0,
      done: true,
      totalDeleted: 4,
    });
    await expect(
      t.mutation(
        internal.migration.scrub.scrubCheckpointsBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: FOUNDATION_SCRUB_OPERATIONS.checkpoints,
          batchSize: 1,
        },
      ),
    ).resolves.toMatchObject({
      deletedThisBatch: 0,
      done: true,
      totalDeleted: 2,
    });
    await expect(startScrub(t)).resolves.toMatchObject({
      status: "completed",
      created: false,
    });
    await expect(
      t.mutation(
        internal.migration.scrub.finishFoundationScrub,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: FOUNDATION_SCRUB_OPERATIONS.finish,
        },
      ),
    ).resolves.toEqual(completed);

    const retained = await t.run(async (ctx) => {
      const movies = await ctx.db
        .query("movies")
        .withIndex("by_legacyId")
        .take(10);
      const domainRuns = await ctx.db
        .query("migrationDomainRuns")
        .withIndex("by_runId_and_domain", (query) =>
          query.eq("runId", CUTOVER_RUN_ID),
        )
        .take(10);
      const migrationRun = await ctx.db
        .query("migrationRuns")
        .withIndex("by_runId", (query) =>
          query.eq("runId", CUTOVER_RUN_ID),
        )
        .unique();
      return { movies, domainRuns, migrationRun };
    });
    expect(retained.movies).toHaveLength(1);
    expect(retained.domainRuns).toHaveLength(3);
    expect(retained.migrationRun).not.toBeNull();
  });

  test("requires all reconciled domains and an explicit scrub run", async () => {
    const missingRun = createTestBackend();
    await initializeAtS1(missingRun);
    await expectDomainError(startScrub(missingRun), "CONFLICT");

    const missingDomain = createTestBackend();
    await initializeAtS1(missingDomain);
    await missingDomain.run(async (ctx) => {
      await ctx.db.insert("migrationRuns", {
        runId: CUTOVER_RUN_ID,
        sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
        status: "running",
        startedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("migrationDomainRuns", {
        runId: CUTOVER_RUN_ID,
        domain: "identity",
        status: "reconciled",
        expectedCounts: {},
        startedAt: 1,
        updatedAt: 1,
      });
    });
    await expectDomainError(startScrub(missingDomain), "CONFLICT");

    const t = createTestBackend();
    await initializeAtS1(t);
    await seedReconciledFoundation(t);
    await expectDomainError(
      t.mutation(internal.migration.scrub.startFoundationScrub, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: FOUNDATION_SCRUB_OPERATIONS.catalog,
      }),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.scrub.scrubIdentityRawBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: FOUNDATION_SCRUB_OPERATIONS.identity,
          batchSize: 1,
        },
      ),
      "CONFLICT",
    );
    await startScrub(t);
    await expectDomainError(
      t.mutation(
        internal.migration.scrub.scrubIdentityRawBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: FOUNDATION_SCRUB_OPERATIONS.identity,
          batchSize: 0,
        },
      ),
      "VALIDATION_FAILED",
    );
  });

  test("refuses completion while current or other-run staging remains", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await seedReconciledFoundation(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("migrationRawUsers", {
        runId: "other-run",
        legacyId: "other",
        sourceRowHash: "sha256:other",
      });
      await ctx.db.insert("migrationCheckpoints", {
        runId: "other-run",
        operation: "other",
        status: "completed",
        processedCount: 0,
        insertedCount: 0,
        reusedCount: 0,
        updatedAt: 1,
      });
    });
    await startScrub(t);
    await expectDomainError(
      t.mutation(
        internal.migration.scrub.finishFoundationScrub,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: FOUNDATION_SCRUB_OPERATIONS.finish,
        },
      ),
      "CONFLICT",
    );
  });
});
