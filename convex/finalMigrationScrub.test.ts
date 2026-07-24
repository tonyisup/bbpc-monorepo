/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { internal } from "./_generated/api.js";
import {
  FINAL_SCRUB_OPERATIONS,
  FINAL_SCRUB_SCOPE,
  FOUNDATION_SCRUB_SCOPE,
  MIGRATION_RAW_TABLES_BY_DOMAIN,
  PORTABLE_BACKUP_TABLES,
  PORTABLE_CONTROL_TABLES,
  SOURCE_SCHEMA_FINGERPRINT,
} from "./migration/constants.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "portable-scrub-test-001";
const UUIDS = {
  one: "00000000-0000-0000-0000-000000000001",
  two: "00000000-0000-0000-0000-000000000002",
  three: "00000000-0000-0000-0000-000000000003",
  four: "00000000-0000-0000-0000-000000000004",
};
const MIGRATION_DOMAINS = [
  "identity",
  "catalog",
  "episodes",
  "assignments",
  "reviews",
  "games",
  "rankings",
  "archive",
] as const;

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
    actor: "portable-scrub-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "portable-scrub-test",
  });
}

async function seedReconciledRun(
  t: TestBackend,
  domains: readonly string[] = MIGRATION_DOMAINS,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("migrationRuns", {
      runId: CUTOVER_RUN_ID,
      sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
      status: "running",
      startedAt: 1,
      updatedAt: 1,
    });
    for (const domain of domains) {
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

async function seedPortableFixture(t: TestBackend): Promise<void> {
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      legacyId: "user-1",
      name: "Canonical user",
      email: "user@example.test",
      normalizedEmail: "user@example.test",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const targetUserId = await ctx.db.insert("users", {
      legacyId: "user-2",
      name: "Target user",
      email: "target@example.test",
      normalizedEmail: "target@example.test",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("authIdentities", {
      tokenIdentifier: "issuer|subject",
      issuer: "https://issuer.example.test",
      subject: "subject",
      userId,
      verifiedEmail: "user@example.test",
      linkedAt: 1,
      lastSeenAt: 1,
    });
    await ctx.db.insert("tagVotes", {
      legacyId: UUIDS.two,
      tag: "Synthetic archive marker",
      normalizedTag: "synthetic archive marker",
      tmdbId: 123,
      isTag: true,
      createdAt: 1,
      userId,
      award: {
        kind: "legacyAwardTombstone",
        legacyPointId: UUIDS.three,
      },
    });
    await ctx.db.insert("movies", {
      legacyId: UUIDS.one,
      title: "Canonical survives",
      normalizedTitle: "canonical survives",
      year: 2024,
      url: "https://example.test/movie",
    });
    await ctx.db.insert("impersonationSessions", {
      actorUserId: userId,
      targetUserId,
      reason: "Synthetic cutover test",
      startedAt: 1,
      endsAt: 2,
    });
    await ctx.db.insert("servicePrincipals", {
      tokenIdentifier: "machine-token",
      issuer: "https://issuer.example.test",
      subject: "machine",
      name: "Local migration machine",
      status: "active",
      permissions: ["migration"],
      cutoverRunId: CUTOVER_RUN_ID,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("migrationScrubRuns", {
      runId: CUTOVER_RUN_ID,
      scope: FOUNDATION_SCRUB_SCOPE,
      status: "completed",
      identityRawRowsDeleted: 0,
      catalogRawRowsDeleted: 0,
      episodeRawRowsDeleted: 0,
      checkpointsDeleted: 0,
      startedAt: 1,
      updatedAt: 1,
      completedAt: 1,
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

    const sourceRowHash = "sha256:synthetic";
    const base = { runId: CUTOVER_RUN_ID, sourceRowHash };
    await ctx.db.insert("migrationRawUsers", {
      ...base,
      legacyId: "user-1",
    });
    await ctx.db.insert("migrationRawRoles", {
      ...base,
      legacyId: 1,
      name: "Role",
      description: "Role",
      admin: false,
    });
    await ctx.db.insert("migrationRawUserRoles", {
      ...base,
      legacyId: UUIDS.one,
      userLegacyId: "user-1",
      roleLegacyId: 1,
    });
    await ctx.db.insert("migrationRawMovies", {
      ...base,
      legacyId: UUIDS.one,
      title: "Movie",
      year: 2024,
      url: "https://example.test/movie",
    });
    await ctx.db.insert("migrationRawShows", {
      ...base,
      legacyId: UUIDS.one,
      title: "Show",
      year: 2024,
      url: "https://example.test/show",
    });
    await ctx.db.insert("migrationRawTags", {
      ...base,
      legacyId: UUIDS.one,
      name: "Tag",
      createdAt: 1,
    });
    await ctx.db.insert("migrationRawEpisodes", {
      ...base,
      legacyId: UUIDS.one,
      number: 1,
      title: "Episode",
    });
    await ctx.db.insert("migrationRawEpisodeLinks", {
      ...base,
      legacyId: UUIDS.one,
      url: "https://example.test/link",
      text: "Link",
    });
    await ctx.db.insert("migrationRawBangers", {
      ...base,
      legacyId: UUIDS.one,
      title: "Song",
      artist: "Artist",
      url: "https://example.test/song",
    });
    await ctx.db.insert("migrationRawEpisodeAudioMessages", {
      ...base,
      legacyId: 1,
      url: "https://example.test/audio",
      createdAt: 1,
      userLegacyId: "user-1",
    });
    await ctx.db.insert("migrationRawAssignments", {
      ...base,
      legacyId: UUIDS.one,
      userLegacyId: "user-1",
      episodeLegacyId: UUIDS.one,
      movieLegacyId: UUIDS.one,
      type: "movie",
      playable: true,
    });
    await ctx.db.insert("migrationRawAssignmentAudioMessages", {
      ...base,
      legacyId: 1,
      url: "https://example.test/assignment-audio",
      createdAt: 1,
      userLegacyId: "user-1",
    });
    await ctx.db.insert("migrationRawAssignmentPointLinks", {
      ...base,
      legacyId: UUIDS.one,
      assignmentLegacyId: UUIDS.one,
      userLegacyId: "user-1",
      pointLegacyId: UUIDS.one,
    });
    await ctx.db.insert("migrationRawSyllabusEntries", {
      ...base,
      legacyId: UUIDS.one,
      userLegacyId: "user-1",
      movieLegacyId: UUIDS.one,
      order: 1,
      createdAt: 1,
    });
    await ctx.db.insert("migrationRawRatings", {
      ...base,
      legacyId: UUIDS.one,
      name: "Rating",
      value: 1,
    });
    await ctx.db.insert("migrationRawReviews", {
      ...base,
      legacyId: UUIDS.one,
      movieLegacyId: UUIDS.one,
    });
    await ctx.db.insert("migrationRawAssignmentReviews", {
      ...base,
      legacyId: UUIDS.one,
      assignmentLegacyId: UUIDS.one,
      reviewLegacyId: UUIDS.one,
    });
    await ctx.db.insert("migrationRawExtraReviews", {
      ...base,
      legacyId: UUIDS.one,
      reviewLegacyId: UUIDS.one,
      episodeLegacyId: UUIDS.one,
    });
    await ctx.db.insert("migrationRawGameTypes", {
      ...base,
      legacyId: 1,
      title: "Game",
      lookupId: "game",
    });
    await ctx.db.insert("migrationRawGamePointTypes", {
      ...base,
      legacyId: 1,
      lookupId: "point",
      title: "Point",
      points: 1,
      gameTypeLegacyId: 1,
    });
    await ctx.db.insert("migrationRawSeasons", {
      ...base,
      legacyId: UUIDS.one,
      title: "Season",
      gameTypeLegacyId: 1,
    });
    await ctx.db.insert("migrationRawPoints", {
      ...base,
      legacyId: UUIDS.one,
      userLegacyId: "user-1",
      seasonLegacyId: UUIDS.one,
      earnedAt: 1,
      adjustment: null,
    });
    await ctx.db.insert("migrationRawGuesses", {
      ...base,
      legacyId: UUIDS.one,
      ratingLegacyId: UUIDS.one,
      createdAt: 1,
      userLegacyId: "user-1",
      assignmentReviewLegacyId: UUIDS.one,
      seasonLegacyId: UUIDS.one,
    });
    await ctx.db.insert("migrationRawGamblingTypes", {
      ...base,
      legacyId: UUIDS.one,
      lookupId: "gambling",
      title: "Gambling",
      multiplier: 1,
      isActive: true,
      createdAt: 1,
    });
    await ctx.db.insert("migrationRawGamblingEntries", {
      ...base,
      legacyId: UUIDS.one,
      userLegacyId: "user-1",
      points: 1,
      createdAt: 1,
      gamblingTypeLegacyId: UUIDS.one,
      status: "PENDING",
    });
    await ctx.db.insert("migrationRawTagVotes", {
      ...base,
      legacyId: UUIDS.one,
      tag: "Tag",
      tmdbId: 1,
      createdAt: 1,
    });
    await ctx.db.insert("migrationRawQuoteSubmissions", {
      ...base,
      legacyId: UUIDS.one,
      userLegacyId: "user-1",
      episodeLegacyId: UUIDS.one,
      seasonLegacyId: UUIDS.one,
      quoteText: "Quote",
      sourceTitle: "Movie",
      sourceType: "MOVIE",
      status: "PENDING",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("migrationRawRankedListTypes", {
      ...base,
      legacyId: UUIDS.one,
      name: "Movies",
      maxItems: 10,
      targetType: "MOVIE",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("migrationRawRankedLists", {
      ...base,
      legacyId: UUIDS.one,
      userLegacyId: "user-1",
      rankedListTypeLegacyId: UUIDS.one,
      status: "DRAFT",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("migrationRawRankedItems", {
      ...base,
      legacyId: UUIDS.one,
      rankedListLegacyId: UUIDS.one,
      movieLegacyId: UUIDS.one,
      rank: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("migrationRawArchivePosts", {
      ...base,
      legacyId: 1,
      postedAt: 1,
      content: "Archive content",
      title: "Archive title",
    });
  });
}

async function startFinalScrub(t: TestBackend) {
  return await t.mutation(
    internal.migration.scrub.startFinalScrub,
    {
      cutoverRunId: CUTOVER_RUN_ID,
      operationId: FINAL_SCRUB_OPERATIONS.start,
    },
  );
}

async function scrubRawDomain(
  t: TestBackend,
  domain: (typeof MIGRATION_DOMAINS)[number],
) {
  let result = await t.mutation(
    internal.migration.scrub.scrubFinalRawDomainBatch,
    {
      cutoverRunId: CUTOVER_RUN_ID,
      operationId: FINAL_SCRUB_OPERATIONS.raw[domain],
      domain,
      batchSize: 2,
    },
  );
  for (let attempt = 0; !result.done && attempt < 20; attempt += 1) {
    result = await t.mutation(
      internal.migration.scrub.scrubFinalRawDomainBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: FINAL_SCRUB_OPERATIONS.raw[domain],
        domain,
        batchSize: 2,
      },
    );
  }
  expect(result.done).toBe(true);
  return result;
}

async function scrubUntilDone(
  invoke: () => Promise<{
    deletedThisBatch: number;
    totalDeleted: number;
    done: boolean;
  }>,
) {
  let result = await invoke();
  for (let attempt = 0; !result.done && attempt < 30; attempt += 1) {
    result = await invoke();
  }
  expect(result.done).toBe(true);
  return result;
}

describe("final portable scrub", () => {
  test("classifies every schema table for portable backup", () => {
    const rawTables = Object.values(
      MIGRATION_RAW_TABLES_BY_DOMAIN,
    ).flat();
    const classifiedTables = [
      ...PORTABLE_BACKUP_TABLES,
      ...PORTABLE_CONTROL_TABLES,
      ...rawTables,
    ];

    expect(new Set(classifiedTables).size).toBe(
      classifiedTables.length,
    );
    expect(Object.keys(schema.tables).sort()).toEqual(
      [...classifiedTables].sort(),
    );
  });

  test("removes all temporary state and preserves portable data plus audit evidence", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await seedReconciledRun(t);
    await seedPortableFixture(t);

    await expect(startFinalScrub(t)).resolves.toEqual({
      runId: CUTOVER_RUN_ID,
      scope: FINAL_SCRUB_SCOPE,
      status: "running",
      created: true,
    });
    await expect(startFinalScrub(t)).resolves.toMatchObject({
      created: false,
    });
    await expectDomainError(
      t.mutation(
        internal.migration.scrub.scrubFinalMigrationMetadataBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId:
            FINAL_SCRUB_OPERATIONS.migrationMetadata,
          batchSize: 2,
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.mutation(internal.migration.scrub.finishFinalScrub, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: FINAL_SCRUB_OPERATIONS.finish,
      }),
      "CONFLICT",
    );

    const expectedRawCounts = {
      identity: 3,
      catalog: 3,
      episodes: 4,
      assignments: 4,
      reviews: 4,
      games: 9,
      rankings: 3,
      archive: 1,
    };
    for (const domain of MIGRATION_DOMAINS) {
      const result = await scrubRawDomain(t, domain);
      expect(result.totalDeleted).toBe(expectedRawCounts[domain]);
      await expect(
        t.mutation(
          internal.migration.scrub.scrubFinalRawDomainBatch,
          {
            cutoverRunId: CUTOVER_RUN_ID,
            operationId: FINAL_SCRUB_OPERATIONS.raw[domain],
            domain,
            batchSize: 1,
          },
        ),
      ).resolves.toMatchObject({
        deletedThisBatch: 0,
        totalDeleted: expectedRawCounts[domain],
        done: true,
      });
    }

    await expectDomainError(
      t.mutation(
        internal.migration.scrub.scrubFinalMigrationMetadataBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId:
            FINAL_SCRUB_OPERATIONS.migrationMetadata,
          batchSize: 2,
        },
      ),
      "CONFLICT",
    );
    const tagAwardArchive = await scrubUntilDone(() =>
      t.mutation(
        internal.migration.scrub
          .scrubFinalTagAwardArchiveBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId:
            FINAL_SCRUB_OPERATIONS.tagAwardArchive,
          batchSize: 1,
        },
      ),
    );
    expect(tagAwardArchive.totalDeleted).toBe(1);

    await expectDomainError(
      t.mutation(
        internal.migration.scrub.scrubFinalDeploymentControlBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId:
            FINAL_SCRUB_OPERATIONS.deploymentControl,
          batchSize: 1,
        },
      ),
      "CONFLICT",
    );
    const metadata = await scrubUntilDone(() =>
      t.mutation(
        internal.migration.scrub.scrubFinalMigrationMetadataBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId:
            FINAL_SCRUB_OPERATIONS.migrationMetadata,
          batchSize: 2,
        },
      ),
    );
    expect(metadata.totalDeleted).toBe(12);
    const control = await scrubUntilDone(() =>
      t.mutation(
        internal.migration.scrub.scrubFinalDeploymentControlBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId:
            FINAL_SCRUB_OPERATIONS.deploymentControl,
          batchSize: 1,
        },
      ),
    );
    expect(control.totalDeleted).toBe(2);

    const completed = await t.mutation(
      internal.migration.scrub.finishFinalScrub,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: FINAL_SCRUB_OPERATIONS.finish,
      },
    );
    expect(completed).toMatchObject({
      runId: CUTOVER_RUN_ID,
      scope: FINAL_SCRUB_SCOPE,
      status: "completed",
      rawRowsDeleted: expectedRawCounts,
      checkpointsDeleted: 2,
      domainRunsDeleted: 8,
      migrationRunsDeleted: 1,
      priorScrubRunsDeleted: 1,
      impersonationSessionsDeleted: 1,
      servicePrincipalsDeleted: 1,
      tagAwardArchiveIdsRemoved: 1,
      systemStateDeleted: true,
    });

    const retained = await t.run(async (ctx) => {
      const users = await ctx.db
        .query("users")
        .withIndex("by_legacyId")
        .take(10);
      const authIdentities = await ctx.db
        .query("authIdentities")
        .withIndex("by_tokenIdentifier")
        .take(10);
      const movies = await ctx.db
        .query("movies")
        .withIndex("by_legacyId")
        .take(10);
      const auditEvents = await ctx.db
        .query("auditEvents")
        .withIndex("by_cutoverRunId_and_createdAt", (query) =>
          query.eq("cutoverRunId", CUTOVER_RUN_ID),
        )
        .take(20);
      const tagVotes = await ctx.db
        .query("tagVotes")
        .withIndex("by_legacyId")
        .take(10);
      const systemState = await ctx.db
        .query("systemState")
        .withIndex("by_singletonKey", (query) =>
          query.eq("singletonKey", "global"),
        )
        .unique();
      const migrationRun = await ctx.db
        .query("migrationRuns")
        .withIndex("by_runId")
        .first();
      const domainRun = await ctx.db
        .query("migrationDomainRuns")
        .withIndex("by_runId_and_domain")
        .first();
      const checkpoint = await ctx.db
        .query("migrationCheckpoints")
        .withIndex("by_runId_and_operation")
        .first();
      const scrubRun = await ctx.db
        .query("migrationScrubRuns")
        .withIndex("by_runId_and_scope")
        .first();
      const rawArchivePost = await ctx.db
        .query("migrationRawArchivePosts")
        .withIndex("by_runId_and_legacyId")
        .first();
      const servicePrincipal = await ctx.db
        .query("servicePrincipals")
        .withIndex("by_status")
        .first();
      const impersonationSession = await ctx.db
        .query("impersonationSessions")
        .withIndex("by_actorUserId_and_startedAt")
        .first();
      return {
        users,
        authIdentities,
        movies,
        tagVotes,
        auditEvents,
        systemState,
        migrationRun,
        domainRun,
        checkpoint,
        scrubRun,
        rawArchivePost,
        servicePrincipal,
        impersonationSession,
      };
    });
    expect(retained.users).toHaveLength(2);
    expect(retained.authIdentities).toHaveLength(1);
    expect(retained.movies).toHaveLength(1);
    expect(retained.tagVotes).toMatchObject([
      {
        award: { kind: "legacyAwardTombstone" },
      },
    ]);
    expect(
      JSON.stringify(retained.tagVotes),
    ).not.toContain(UUIDS.three);
    expect(
      retained.auditEvents.some(
        (event) =>
          event.action === "migration.portableScrub.completed",
      ),
    ).toBe(true);
    expect(retained.systemState).toBeNull();
    expect(retained.migrationRun).toBeNull();
    expect(retained.domainRun).toBeNull();
    expect(retained.checkpoint).toBeNull();
    expect(retained.scrubRun).toBeNull();
    expect(retained.rawArchivePost).toBeNull();
    expect(retained.servicePrincipal).toBeNull();
    expect(retained.impersonationSession).toBeNull();

    await expectDomainError(
      t.mutation(internal.migration.scrub.finishFinalScrub, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: FINAL_SCRUB_OPERATIONS.finish,
      }),
      "WRITE_DISABLED",
    );
  });

  test("requires the exact reconciled run and validates operations and batches", async () => {
    const missingRun = createTestBackend();
    await initializeAtS1(missingRun);
    await expectDomainError(startFinalScrub(missingRun), "CONFLICT");

    const missingDomain = createTestBackend();
    await initializeAtS1(missingDomain);
    await seedReconciledRun(
      missingDomain,
      MIGRATION_DOMAINS.slice(0, -1),
    );
    await expectDomainError(
      startFinalScrub(missingDomain),
      "CONFLICT",
    );

    const t = createTestBackend();
    await initializeAtS1(t);
    await seedReconciledRun(t);
    await expectDomainError(
      t.mutation(
        internal.migration.scrub.scrubFinalRawDomainBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: FINAL_SCRUB_OPERATIONS.raw.identity,
          domain: "identity",
          batchSize: 1,
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.mutation(internal.migration.scrub.startFinalScrub, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: FINAL_SCRUB_OPERATIONS.finish,
      }),
      "VALIDATION_FAILED",
    );
    await startFinalScrub(t);
    await expectDomainError(
      t.mutation(
        internal.migration.scrub.scrubFinalMigrationMetadataBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId:
            FINAL_SCRUB_OPERATIONS.migrationMetadata,
          batchSize: 1,
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.scrub.scrubFinalRawDomainBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: FINAL_SCRUB_OPERATIONS.raw.catalog,
          domain: "identity",
          batchSize: 1,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.scrub.scrubFinalRawDomainBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: FINAL_SCRUB_OPERATIONS.raw.identity,
          domain: "identity",
          batchSize: 0,
        },
      ),
      "VALIDATION_FAILED",
    );

    const completed = createTestBackend();
    await initializeAtS1(completed);
    await seedReconciledRun(completed);
    await completed.run(async (ctx) => {
      await ctx.db.insert("migrationScrubRuns", {
        runId: CUTOVER_RUN_ID,
        scope: FINAL_SCRUB_SCOPE,
        status: "completed",
        identityRawRowsDeleted: 0,
        catalogRawRowsDeleted: 0,
        episodeRawRowsDeleted: 0,
        checkpointsDeleted: 0,
        startedAt: 1,
        updatedAt: 1,
        completedAt: 1,
      });
    });
    await expectDomainError(
      startFinalScrub(completed),
      "CONFLICT",
    );
  });

  test("defaults legacy scrub counters when no temporary rows exist", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("migrationScrubRuns", {
        runId: CUTOVER_RUN_ID,
        scope: FINAL_SCRUB_SCOPE,
        status: "running",
        identityRawRowsDeleted: 0,
        catalogRawRowsDeleted: 0,
        episodeRawRowsDeleted: 0,
        checkpointsDeleted: 0,
        startedAt: 1,
        updatedAt: 1,
      });
    });
    for (const domain of MIGRATION_DOMAINS) {
      await expect(
        t.mutation(
          internal.migration.scrub.scrubFinalRawDomainBatch,
          {
            cutoverRunId: CUTOVER_RUN_ID,
            operationId: FINAL_SCRUB_OPERATIONS.raw[domain],
            domain,
            batchSize: 1,
          },
        ),
      ).resolves.toMatchObject({
        deletedThisBatch: 0,
        totalDeleted: 0,
        done: true,
      });
    }
    await expect(
      t.mutation(
        internal.migration.scrub.scrubFinalMigrationMetadataBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId:
            FINAL_SCRUB_OPERATIONS.migrationMetadata,
          batchSize: 1,
        },
      ),
    ).resolves.toMatchObject({
      deletedThisBatch: 0,
      totalDeleted: 0,
      done: true,
    });
    await expect(
      t.mutation(
        internal.migration.scrub.scrubFinalDeploymentControlBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId:
            FINAL_SCRUB_OPERATIONS.deploymentControl,
          batchSize: 1,
        },
      ),
    ).resolves.toMatchObject({
      deletedThisBatch: 0,
      totalDeleted: 0,
      done: true,
    });
    await expect(
      t.mutation(internal.migration.scrub.finishFinalScrub, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: FINAL_SCRUB_OPERATIONS.finish,
      }),
    ).resolves.toMatchObject({
      rawRowsDeleted: { identity: 0 },
      checkpointsDeleted: 0,
      domainRunsDeleted: 0,
      migrationRunsDeleted: 0,
      priorScrubRunsDeleted: 0,
      impersonationSessionsDeleted: 0,
      servicePrincipalsDeleted: 0,
      systemStateDeleted: true,
    });
  });
});
