/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { internal } from "./_generated/api.js";
import {
  CATALOG_OPERATIONS,
  CATALOG_RECONCILIATION_OPERATIONS,
  SOURCE_SCHEMA_FINGERPRINT,
} from "./migration/constants.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "catalog-migration-test-001";
const MOVIE_ID_A = "00000000-0000-0000-0000-000000000011";
const MOVIE_ID_B = "00000000-0000-0000-0000-000000000012";
const SHOW_ID = "00000000-0000-0000-0000-000000000021";
const TAG_ID = "00000000-0000-0000-0000-000000000031";

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
    actor: "catalog-migration-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "catalog-migration-test",
  });
}

async function startRun(
  t: TestBackend,
  counts: { movies: number; shows: number; tags: number },
) {
  return await t.mutation(
    internal.migration.catalog.startCatalogRun,
    {
      cutoverRunId: CUTOVER_RUN_ID,
      operationId: CATALOG_OPERATIONS.start,
      sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
      expectedMovies: counts.movies,
      expectedShows: counts.shows,
      expectedTags: counts.tags,
    },
  );
}

async function transformAll(
  t: TestBackend,
  batchSize = 100,
): Promise<void> {
  await t.mutation(
    internal.migration.catalog.transformMoviesBatch,
    {
      cutoverRunId: CUTOVER_RUN_ID,
      operationId: CATALOG_OPERATIONS.movies,
      batchSize,
    },
  );
  await t.mutation(
    internal.migration.catalog.transformShowsBatch,
    {
      cutoverRunId: CUTOVER_RUN_ID,
      operationId: CATALOG_OPERATIONS.shows,
      batchSize,
    },
  );
  await t.mutation(
    internal.migration.catalog.transformTagsBatch,
    {
      cutoverRunId: CUTOVER_RUN_ID,
      operationId: CATALOG_OPERATIONS.tags,
      batchSize,
    },
  );
}

async function reconcileAll(
  t: TestBackend,
  batchSize = 100,
): Promise<void> {
  await t.mutation(
    internal.migration.catalogReconciliation.reconcileMoviesBatch,
    {
      cutoverRunId: CUTOVER_RUN_ID,
      operationId: CATALOG_RECONCILIATION_OPERATIONS.movies,
      batchSize,
    },
  );
  await t.mutation(
    internal.migration.catalogReconciliation.reconcileShowsBatch,
    {
      cutoverRunId: CUTOVER_RUN_ID,
      operationId: CATALOG_RECONCILIATION_OPERATIONS.shows,
      batchSize,
    },
  );
  await t.mutation(
    internal.migration.catalogReconciliation.reconcileTagsBatch,
    {
      cutoverRunId: CUTOVER_RUN_ID,
      operationId: CATALOG_RECONCILIATION_OPERATIONS.tags,
      batchSize,
    },
  );
}

describe("catalog migration slice", () => {
  test("preserves duplicate catalog rows and completes only its domain", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("migrationRawMovies", {
        runId: CUTOVER_RUN_ID,
        legacyId: MOVIE_ID_A.toUpperCase(),
        title: "  MＯVIE  ",
        year: 2024,
        poster: "https://example.test/movie-a.jpg",
        url: "https://example.test/movie",
        tmdbId: 41,
        sourceRowHash: "sha256:movie-a",
      });
      await ctx.db.insert("migrationRawMovies", {
        runId: CUTOVER_RUN_ID,
        legacyId: MOVIE_ID_B,
        title: "movie",
        year: 2024,
        url: "https://example.test/movie",
        sourceRowHash: "sha256:movie-b",
      });
      await ctx.db.insert("migrationRawShows", {
        runId: CUTOVER_RUN_ID,
        legacyId: SHOW_ID,
        title: "Synthetic Show",
        year: 2025,
        poster: "https://example.test/show.jpg",
        url: "https://example.test/show",
        sourceRowHash: "sha256:show",
      });
      await ctx.db.insert("migrationRawTags", {
        runId: CUTOVER_RUN_ID,
        legacyId: TAG_ID,
        name: "  Scｉ-Fi  ",
        description: "Synthetic tag",
        createdAt: 1_700_000_000_000,
        sourceRowHash: "sha256:tag",
      });
    });

    await expect(
      startRun(t, { movies: 2, shows: 1, tags: 1 }),
    ).resolves.toMatchObject({
      runId: CUTOVER_RUN_ID,
      status: "running",
      created: true,
    });
    await expect(
      t.mutation(
        internal.migration.catalog.transformMoviesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_OPERATIONS.movies,
          batchSize: 1,
        },
      ),
    ).resolves.toMatchObject({
      status: "running",
      processedCount: 1,
      insertedCount: 1,
    });
    const moviesComplete = await t.mutation(
      internal.migration.catalog.transformMoviesBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: CATALOG_OPERATIONS.movies,
        batchSize: 1,
      },
    );
    expect(moviesComplete).toMatchObject({
      status: "completed",
      processedCount: 2,
      insertedCount: 2,
    });
    await expect(
      t.mutation(
        internal.migration.catalog.transformMoviesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_OPERATIONS.movies,
          batchSize: 1,
        },
      ),
    ).resolves.toEqual(moviesComplete);
    await t.mutation(
      internal.migration.catalog.transformShowsBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: CATALOG_OPERATIONS.shows,
        batchSize: 10,
      },
    );
    await t.mutation(
      internal.migration.catalog.transformTagsBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: CATALOG_OPERATIONS.tags,
        batchSize: 10,
      },
    );

    await expect(
      t.mutation(internal.migration.catalog.finishCatalogRun, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: CATALOG_OPERATIONS.finish,
      }),
    ).resolves.toEqual({
      runId: CUTOVER_RUN_ID,
      status: "transformed",
      movies: 2,
      shows: 1,
      tags: 1,
    });

    const snapshot = await t.run(async (ctx) => {
      const movies = await ctx.db
        .query("movies")
        .withIndex("by_normalizedTitle_and_year", (query) =>
          query.eq("normalizedTitle", "movie").eq("year", 2024),
        )
        .take(10);
      const shows = await ctx.db
        .query("shows")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", SHOW_ID),
        )
        .take(10);
      const tags = await ctx.db
        .query("tags")
        .withIndex("by_normalizedName", (query) =>
          query.eq("normalizedName", "sci-fi"),
        )
        .take(10);
      const globalRun = await ctx.db
        .query("migrationRuns")
        .withIndex("by_runId", (query) =>
          query.eq("runId", CUTOVER_RUN_ID),
        )
        .unique();
      const domainRun = await ctx.db
        .query("migrationDomainRuns")
        .withIndex("by_runId_and_domain", (query) =>
          query
            .eq("runId", CUTOVER_RUN_ID)
            .eq("domain", "catalog"),
        )
        .unique();
      return { movies, shows, tags, globalRun, domainRun };
    });
    expect(snapshot.movies).toHaveLength(2);
    expect(snapshot.movies.map((movie) => movie.legacyId).sort()).toEqual(
      [MOVIE_ID_A, MOVIE_ID_B],
    );
    expect(snapshot.movies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          poster: "https://example.test/movie-a.jpg",
          tmdbId: 41,
        }),
      ]),
    );
    const movieWithoutOptionals = snapshot.movies.find(
      (movie) => movie.legacyId === MOVIE_ID_B,
    );
    expect(movieWithoutOptionals).not.toHaveProperty("poster");
    expect(movieWithoutOptionals).not.toHaveProperty("tmdbId");
    expect(snapshot.shows).toEqual([
      expect.objectContaining({
        normalizedTitle: "synthetic show",
        poster: "https://example.test/show.jpg",
      }),
    ]);
    expect(snapshot.tags).toEqual([
      expect.objectContaining({
        normalizedName: "sci-fi",
        description: "Synthetic tag",
      }),
    ]);
    expect(snapshot.globalRun?.status).toBe("running");
    expect(snapshot.domainRun?.status).toBe("transformed");
  });

  test("reuses matching canonical documents and compatible runs", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("movies", {
        legacyId: MOVIE_ID_A,
        title: "Movie",
        normalizedTitle: "movie",
        year: 2020,
        url: "https://example.test/movie",
      });
      await ctx.db.insert("shows", {
        legacyId: SHOW_ID,
        title: "Show",
        normalizedTitle: "show",
        year: 2021,
        url: "https://example.test/show",
      });
      await ctx.db.insert("tags", {
        legacyId: TAG_ID,
        name: "Tag",
        normalizedName: "tag",
        createdAt: 123,
      });
      await ctx.db.insert("migrationRawMovies", {
        runId: CUTOVER_RUN_ID,
        legacyId: MOVIE_ID_A,
        title: "Movie",
        year: 2020,
        url: "https://example.test/movie",
        sourceRowHash: "sha256:movie",
      });
      await ctx.db.insert("migrationRawShows", {
        runId: CUTOVER_RUN_ID,
        legacyId: SHOW_ID,
        title: "Show",
        year: 2021,
        url: "https://example.test/show",
        sourceRowHash: "sha256:show",
      });
      await ctx.db.insert("migrationRawTags", {
        runId: CUTOVER_RUN_ID,
        legacyId: TAG_ID,
        name: "Tag",
        createdAt: 123,
        sourceRowHash: "sha256:tag",
      });
    });

    await startRun(t, { movies: 1, shows: 1, tags: 1 });
    await expect(
      startRun(t, { movies: 1, shows: 1, tags: 1 }),
    ).resolves.toMatchObject({ created: false, status: "running" });
    await expectDomainError(
      startRun(t, { movies: 2, shows: 1, tags: 1 }),
      "CONFLICT",
    );
    await expect(
      t.mutation(
        internal.migration.catalog.transformMoviesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_OPERATIONS.movies,
          batchSize: 10,
        },
      ),
    ).resolves.toMatchObject({
      status: "completed",
      insertedCount: 0,
      reusedCount: 1,
    });
    const showResult = await t.mutation(
      internal.migration.catalog.transformShowsBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: CATALOG_OPERATIONS.shows,
        batchSize: 10,
      },
    );
    expect(showResult).toMatchObject({
      insertedCount: 0,
      reusedCount: 1,
    });
    await expect(
      t.mutation(
        internal.migration.catalog.transformShowsBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_OPERATIONS.shows,
          batchSize: 10,
        },
      ),
    ).resolves.toEqual(showResult);
    const tagResult = await t.mutation(
      internal.migration.catalog.transformTagsBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: CATALOG_OPERATIONS.tags,
        batchSize: 10,
      },
    );
    expect(tagResult).toMatchObject({
      insertedCount: 0,
      reusedCount: 1,
    });
    await expect(
      t.mutation(
        internal.migration.catalog.transformTagsBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_OPERATIONS.tags,
          batchSize: 10,
        },
      ),
    ).resolves.toEqual(tagResult);
  });

  test("enforces operation, source, count, batch, and completion guards", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await expectDomainError(
      t.mutation(internal.migration.catalog.startCatalogRun, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: "catalog.wrong",
        sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
        expectedMovies: 0,
        expectedShows: 0,
        expectedTags: 0,
      }),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      startRun(t, { movies: -1, shows: 0, tags: 0 }),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.mutation(internal.migration.catalog.startCatalogRun, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: CATALOG_OPERATIONS.start,
        sourceSchemaFingerprint: "sha256:drift",
        expectedMovies: 0,
        expectedShows: 0,
        expectedTags: 0,
      }),
      "CONFLICT",
    );
    await startRun(t, { movies: 0, shows: 0, tags: 0 });
    await expectDomainError(
      t.mutation(
        internal.migration.catalog.transformMoviesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_OPERATIONS.shows,
          batchSize: 1,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.catalog.transformMoviesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_OPERATIONS.movies,
          batchSize: 0,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.mutation(internal.migration.catalog.finishCatalogRun, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: CATALOG_OPERATIONS.finish,
      }),
      "CONFLICT",
    );

    await transformAll(t);
    await t.run(async (ctx) => {
      const checkpoint = await ctx.db
        .query("migrationCheckpoints")
        .withIndex("by_runId_and_operation", (query) =>
          query
            .eq("runId", CUTOVER_RUN_ID)
            .eq("operation", CATALOG_OPERATIONS.movies),
        )
        .unique();
      if (!checkpoint) {
        throw new Error("Movie checkpoint missing");
      }
      await ctx.db.patch("migrationCheckpoints", checkpoint._id, {
        processedCount: 1,
      });
    });
    await expectDomainError(
      t.mutation(internal.migration.catalog.finishCatalogRun, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: CATALOG_OPERATIONS.finish,
      }),
      "CONFLICT",
    );
  });

  test("rejects malformed catalog source rows transactionally", async () => {
    const invalidMovie = createTestBackend();
    await initializeAtS1(invalidMovie);
    await invalidMovie.run(async (ctx) => {
      await ctx.db.insert("migrationRawMovies", {
        runId: CUTOVER_RUN_ID,
        legacyId: "not-a-uuid",
        title: "Movie",
        year: 2020,
        url: "https://example.test/movie",
        sourceRowHash: "sha256:invalid-movie",
      });
    });
    await startRun(invalidMovie, {
      movies: 1,
      shows: 0,
      tags: 0,
    });
    await expectDomainError(
      invalidMovie.mutation(
        internal.migration.catalog.transformMoviesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_OPERATIONS.movies,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );

    const invalidYear = createTestBackend();
    await initializeAtS1(invalidYear);
    await invalidYear.run(async (ctx) => {
      await ctx.db.insert("migrationRawShows", {
        runId: CUTOVER_RUN_ID,
        legacyId: SHOW_ID,
        title: "Show",
        year: 32_768,
        url: "https://example.test/show",
        sourceRowHash: "sha256:invalid-year",
      });
    });
    await startRun(invalidYear, {
      movies: 0,
      shows: 1,
      tags: 0,
    });
    await expectDomainError(
      invalidYear.mutation(
        internal.migration.catalog.transformShowsBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_OPERATIONS.shows,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );

    const invalidTmdb = createTestBackend();
    await initializeAtS1(invalidTmdb);
    await invalidTmdb.run(async (ctx) => {
      await ctx.db.insert("migrationRawMovies", {
        runId: CUTOVER_RUN_ID,
        legacyId: MOVIE_ID_A,
        title: "Movie",
        year: 2020,
        url: "https://example.test/movie",
        tmdbId: 2_147_483_648,
        sourceRowHash: "sha256:invalid-tmdb",
      });
    });
    await startRun(invalidTmdb, {
      movies: 1,
      shows: 0,
      tags: 0,
    });
    await expectDomainError(
      invalidTmdb.mutation(
        internal.migration.catalog.transformMoviesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_OPERATIONS.movies,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );

    const blankTag = createTestBackend();
    await initializeAtS1(blankTag);
    await blankTag.run(async (ctx) => {
      await ctx.db.insert("migrationRawTags", {
        runId: CUTOVER_RUN_ID,
        legacyId: TAG_ID,
        name: "   ",
        createdAt: 123,
        sourceRowHash: "sha256:blank-tag",
      });
    });
    await startRun(blankTag, {
      movies: 0,
      shows: 0,
      tags: 1,
    });
    await expectDomainError(
      blankTag.mutation(
        internal.migration.catalog.transformTagsBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_OPERATIONS.tags,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );

    const nonFiniteTag = createTestBackend();
    await initializeAtS1(nonFiniteTag);
    await nonFiniteTag.run(async (ctx) => {
      await ctx.db.insert("migrationRawTags", {
        runId: CUTOVER_RUN_ID,
        legacyId: TAG_ID,
        name: "Tag",
        createdAt: Number.POSITIVE_INFINITY,
        sourceRowHash: "sha256:non-finite-tag",
      });
    });
    await startRun(nonFiniteTag, {
      movies: 0,
      shows: 0,
      tags: 1,
    });
    await expectDomainError(
      nonFiniteTag.mutation(
        internal.migration.catalog.transformTagsBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_OPERATIONS.tags,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
  });

  test("rejects canonical conflicts and normalized tag collisions", async () => {
    const movieConflict = createTestBackend();
    await initializeAtS1(movieConflict);
    await movieConflict.run(async (ctx) => {
      await ctx.db.insert("movies", {
        legacyId: MOVIE_ID_A,
        title: "Existing",
        normalizedTitle: "existing",
        year: 2020,
        url: "https://example.test/existing",
      });
      await ctx.db.insert("migrationRawMovies", {
        runId: CUTOVER_RUN_ID,
        legacyId: MOVIE_ID_A,
        title: "Incoming",
        year: 2020,
        url: "https://example.test/incoming",
        sourceRowHash: "sha256:movie-conflict",
      });
    });
    await startRun(movieConflict, {
      movies: 1,
      shows: 0,
      tags: 0,
    });
    await expectDomainError(
      movieConflict.mutation(
        internal.migration.catalog.transformMoviesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_OPERATIONS.movies,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    const showConflict = createTestBackend();
    await initializeAtS1(showConflict);
    await showConflict.run(async (ctx) => {
      await ctx.db.insert("shows", {
        legacyId: SHOW_ID,
        title: "Existing",
        normalizedTitle: "existing",
        year: 2020,
        url: "https://example.test/existing",
      });
      await ctx.db.insert("migrationRawShows", {
        runId: CUTOVER_RUN_ID,
        legacyId: SHOW_ID,
        title: "Incoming",
        year: 2020,
        url: "https://example.test/incoming",
        sourceRowHash: "sha256:show-conflict",
      });
    });
    await startRun(showConflict, {
      movies: 0,
      shows: 1,
      tags: 0,
    });
    await expectDomainError(
      showConflict.mutation(
        internal.migration.catalog.transformShowsBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_OPERATIONS.shows,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    const tagConflict = createTestBackend();
    await initializeAtS1(tagConflict);
    await tagConflict.run(async (ctx) => {
      await ctx.db.insert("tags", {
        legacyId: "00000000-0000-0000-0000-000000000099",
        name: "Existing Tag",
        normalizedName: "tag",
        createdAt: 1,
      });
      await ctx.db.insert("migrationRawTags", {
        runId: CUTOVER_RUN_ID,
        legacyId: TAG_ID,
        name: "  TAG  ",
        createdAt: 1,
        sourceRowHash: "sha256:tag-collision",
      });
    });
    await startRun(tagConflict, {
      movies: 0,
      shows: 0,
      tags: 1,
    });
    await expectDomainError(
      tagConflict.mutation(
        internal.migration.catalog.transformTagsBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_OPERATIONS.tags,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    const tagLegacyConflict = createTestBackend();
    await initializeAtS1(tagLegacyConflict);
    await tagLegacyConflict.run(async (ctx) => {
      await ctx.db.insert("tags", {
        legacyId: TAG_ID,
        name: "Existing",
        normalizedName: "existing",
        createdAt: 1,
      });
      await ctx.db.insert("migrationRawTags", {
        runId: CUTOVER_RUN_ID,
        legacyId: TAG_ID,
        name: "Incoming",
        createdAt: 2,
        sourceRowHash: "sha256:tag-legacy-conflict",
      });
    });
    await startRun(tagLegacyConflict, {
      movies: 0,
      shows: 0,
      tags: 1,
    });
    await expectDomainError(
      tagLegacyConflict.mutation(
        internal.migration.catalog.transformTagsBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_OPERATIONS.tags,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
  });

  test("rejects missing, corrupt, and stopped migration state", async () => {
    const missing = createTestBackend();
    await initializeAtS1(missing);
    await expectDomainError(
      missing.mutation(
        internal.migration.catalog.transformMoviesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_OPERATIONS.movies,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    const corrupt = createTestBackend();
    await initializeAtS1(corrupt);
    await corrupt.run(async (ctx) => {
      await ctx.db.insert("migrationRuns", {
        runId: CUTOVER_RUN_ID,
        sourceSchemaFingerprint: "sha256:corrupt",
        status: "running",
        startedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("migrationDomainRuns", {
        runId: CUTOVER_RUN_ID,
        domain: "catalog",
        status: "running",
        expectedCounts: { movies: 0, shows: 0, tags: 0 },
        startedAt: 1,
        updatedAt: 1,
      });
    });
    await expectDomainError(
      startRun(corrupt, { movies: 0, shows: 0, tags: 0 }),
      "CONFLICT",
    );
    await expectDomainError(
      corrupt.mutation(
        internal.migration.catalog.transformMoviesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_OPERATIONS.movies,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    const stopped = createTestBackend();
    await initializeAtS1(stopped);
    await stopped.run(async (ctx) => {
      await ctx.db.insert("migrationRuns", {
        runId: CUTOVER_RUN_ID,
        sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
        status: "failed",
        startedAt: 1,
        updatedAt: 1,
      });
    });
    await expectDomainError(
      stopped.mutation(
        internal.migration.catalog.startCatalogRun,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_OPERATIONS.start,
          sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
          expectedMovies: 0,
          expectedShows: 0,
          expectedTags: 0,
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      stopped.mutation(
        internal.migration.catalog.transformMoviesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_OPERATIONS.movies,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    const orphanedDomain = createTestBackend();
    await initializeAtS1(orphanedDomain);
    await orphanedDomain.run(async (ctx) => {
      await ctx.db.insert("migrationDomainRuns", {
        runId: CUTOVER_RUN_ID,
        domain: "catalog",
        status: "running",
        expectedCounts: { movies: 0, shows: 0, tags: 0 },
        startedAt: 1,
        updatedAt: 1,
      });
    });
    await expectDomainError(
      startRun(orphanedDomain, {
        movies: 0,
        shows: 0,
        tags: 0,
      }),
      "CONFLICT",
    );

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
    });
    await expectDomainError(
      missingDomain.mutation(
        internal.migration.catalog.transformMoviesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_OPERATIONS.movies,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    const stoppedDomain = createTestBackend();
    await initializeAtS1(stoppedDomain);
    await stoppedDomain.run(async (ctx) => {
      await ctx.db.insert("migrationRuns", {
        runId: CUTOVER_RUN_ID,
        sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
        status: "running",
        startedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("migrationDomainRuns", {
        runId: CUTOVER_RUN_ID,
        domain: "catalog",
        status: "failed",
        expectedCounts: { movies: 0, shows: 0, tags: 0 },
        startedAt: 1,
        updatedAt: 1,
      });
    });
    await expectDomainError(
      stoppedDomain.mutation(
        internal.migration.catalog.transformMoviesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_OPERATIONS.movies,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    const compatibleGlobal = createTestBackend();
    await initializeAtS1(compatibleGlobal);
    await compatibleGlobal.run(async (ctx) => {
      await ctx.db.insert("migrationRuns", {
        runId: CUTOVER_RUN_ID,
        sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
        status: "running",
        startedAt: 1,
        updatedAt: 1,
      });
    });
    await expect(
      startRun(compatibleGlobal, {
        movies: 0,
        shows: 0,
        tags: 0,
      }),
    ).resolves.toMatchObject({
      created: true,
      runId: CUTOVER_RUN_ID,
    });
  });

  test("independently reconciles transformed catalog documents", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("migrationRawMovies", {
        runId: CUTOVER_RUN_ID,
        legacyId: MOVIE_ID_A,
        title: "Movie",
        year: 2020,
        poster: "https://example.test/movie.jpg",
        url: "https://example.test/movie",
        tmdbId: 42,
        sourceRowHash: "sha256:movie",
      });
      await ctx.db.insert("migrationRawShows", {
        runId: CUTOVER_RUN_ID,
        legacyId: SHOW_ID,
        title: "Show",
        year: 2021,
        poster: "https://example.test/show.jpg",
        url: "https://example.test/show",
        sourceRowHash: "sha256:show",
      });
      await ctx.db.insert("migrationRawTags", {
        runId: CUTOVER_RUN_ID,
        legacyId: TAG_ID,
        name: "Tag",
        description: "Description",
        createdAt: 123,
        sourceRowHash: "sha256:tag",
      });
    });
    await startRun(t, { movies: 1, shows: 1, tags: 1 });
    await transformAll(t);
    await t.mutation(
      internal.migration.catalog.finishCatalogRun,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: CATALOG_OPERATIONS.finish,
      },
    );

    await reconcileAll(t);
    const completedMovieCheck = await t.mutation(
      internal.migration.catalogReconciliation.reconcileMoviesBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: CATALOG_RECONCILIATION_OPERATIONS.movies,
        batchSize: 10,
      },
    );
    expect(completedMovieCheck).toEqual({
      operation: CATALOG_RECONCILIATION_OPERATIONS.movies,
      status: "completed",
      checkedCount: 1,
    });
    await expect(
      t.mutation(
        internal.migration.catalogReconciliation
          .reconcileShowsBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_RECONCILIATION_OPERATIONS.shows,
          batchSize: 10,
        },
      ),
    ).resolves.toMatchObject({
      status: "completed",
      checkedCount: 1,
    });
    await expect(
      t.mutation(
        internal.migration.catalogReconciliation.reconcileTagsBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_RECONCILIATION_OPERATIONS.tags,
          batchSize: 10,
        },
      ),
    ).resolves.toMatchObject({
      status: "completed",
      checkedCount: 1,
    });
    const result = await t.mutation(
      internal.migration.catalogReconciliation
        .finishCatalogReconciliation,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: CATALOG_RECONCILIATION_OPERATIONS.finish,
      },
    );
    expect(result).toEqual({
      runId: CUTOVER_RUN_ID,
      status: "reconciled",
      movies: 1,
      shows: 1,
      tags: 1,
    });
    await expect(
      t.mutation(
        internal.migration.catalogReconciliation
          .finishCatalogReconciliation,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_RECONCILIATION_OPERATIONS.finish,
        },
      ),
    ).resolves.toEqual(result);
  });

  test("rolls back reconciliation when canonical data drifted", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("migrationRawMovies", {
        runId: CUTOVER_RUN_ID,
        legacyId: MOVIE_ID_A,
        title: "Movie",
        year: 2020,
        url: "https://example.test/movie",
        sourceRowHash: "sha256:movie",
      });
      await ctx.db.insert("migrationRawShows", {
        runId: CUTOVER_RUN_ID,
        legacyId: SHOW_ID,
        title: "Show",
        year: 2021,
        url: "https://example.test/show",
        sourceRowHash: "sha256:show",
      });
      await ctx.db.insert("migrationRawTags", {
        runId: CUTOVER_RUN_ID,
        legacyId: TAG_ID,
        name: "Tag",
        createdAt: 123,
        sourceRowHash: "sha256:tag",
      });
    });
    await startRun(t, { movies: 1, shows: 1, tags: 1 });
    await transformAll(t);
    await t.mutation(
      internal.migration.catalog.finishCatalogRun,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: CATALOG_OPERATIONS.finish,
      },
    );
    await t.run(async (ctx) => {
      const movie = await ctx.db
        .query("movies")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", MOVIE_ID_A),
        )
        .unique();
      if (!movie) {
        throw new Error("Movie missing");
      }
      await ctx.db.patch("movies", movie._id, {
        title: "Drifted",
      });
      const show = await ctx.db
        .query("shows")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", SHOW_ID),
        )
        .unique();
      const tag = await ctx.db
        .query("tags")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", TAG_ID),
        )
        .unique();
      if (!show || !tag) {
        throw new Error("Catalog reconciliation fixture missing");
      }
      await ctx.db.patch("shows", show._id, {
        title: "Drifted",
      });
      await ctx.db.patch("tags", tag._id, {
        name: "Drifted",
      });
    });

    await expectDomainError(
      t.mutation(
        internal.migration.catalogReconciliation
          .reconcileMoviesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_RECONCILIATION_OPERATIONS.movies,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.catalogReconciliation
          .reconcileShowsBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_RECONCILIATION_OPERATIONS.shows,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.catalogReconciliation.reconcileTagsBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_RECONCILIATION_OPERATIONS.tags,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    const checkpoint = await t.run(async (ctx) => {
      return await ctx.db
        .query("migrationCheckpoints")
        .withIndex("by_runId_and_operation", (query) =>
          query
            .eq("runId", CUTOVER_RUN_ID)
            .eq(
              "operation",
              CATALOG_RECONCILIATION_OPERATIONS.movies,
            ),
        )
        .unique();
    });
    expect(checkpoint).toBeNull();
  });

  test("guards reconciliation state, operation, batch, and counts", async () => {
    const missing = createTestBackend();
    await initializeAtS1(missing);
    await expectDomainError(
      missing.mutation(
        internal.migration.catalogReconciliation
          .reconcileMoviesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_RECONCILIATION_OPERATIONS.movies,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    const t = createTestBackend();
    await initializeAtS1(t);
    await startRun(t, { movies: 0, shows: 0, tags: 0 });
    await expectDomainError(
      t.mutation(
        internal.migration.catalogReconciliation
          .reconcileMoviesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_RECONCILIATION_OPERATIONS.movies,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    await transformAll(t);
    await t.mutation(
      internal.migration.catalog.finishCatalogRun,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: CATALOG_OPERATIONS.finish,
      },
    );
    await expectDomainError(
      t.mutation(
        internal.migration.catalogReconciliation
          .reconcileMoviesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_RECONCILIATION_OPERATIONS.shows,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.catalogReconciliation
          .reconcileMoviesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_RECONCILIATION_OPERATIONS.movies,
          batchSize: 0,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.catalogReconciliation
          .finishCatalogReconciliation,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_RECONCILIATION_OPERATIONS.finish,
        },
      ),
      "CONFLICT",
    );
    await reconcileAll(t);
    await t.run(async (ctx) => {
      const checkpoint = await ctx.db
        .query("migrationCheckpoints")
        .withIndex("by_runId_and_operation", (query) =>
          query
            .eq("runId", CUTOVER_RUN_ID)
            .eq(
              "operation",
              CATALOG_RECONCILIATION_OPERATIONS.movies,
            ),
        )
        .unique();
      if (!checkpoint) {
        throw new Error("Movie reconciliation checkpoint missing");
      }
      await ctx.db.patch("migrationCheckpoints", checkpoint._id, {
        reusedCount: 1,
      });
    });
    await expectDomainError(
      t.mutation(
        internal.migration.catalogReconciliation
          .finishCatalogReconciliation,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: CATALOG_RECONCILIATION_OPERATIONS.finish,
        },
      ),
      "CONFLICT",
    );
  });
});
