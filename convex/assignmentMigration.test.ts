/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { internal } from "./_generated/api.js";
import {
  ASSIGNMENT_OPERATIONS,
  ASSIGNMENT_RECONCILIATION_OPERATIONS,
  GAME_OPERATIONS,
  SOURCE_SCHEMA_FINGERPRINT,
} from "./migration/constants.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const RUN_ID = "assignment-migration-test-001";
const USER_ID = "legacy-assignment-user";
const ASSIGNMENT_ID =
  "00000000-0000-0000-0000-000000000201";
const ASSIGNMENT_ID_B =
  "00000000-0000-0000-0000-000000000202";
const EPISODE_ID =
  "00000000-0000-0000-0000-000000000211";
const MOVIE_ID = "00000000-0000-0000-0000-000000000221";
const SYLLABUS_ID =
  "00000000-0000-0000-0000-000000000231";
const POINT_ID = "00000000-0000-0000-0000-000000000241";
const POINT_LINK_ID =
  "00000000-0000-0000-0000-000000000251";
const POINT_LINK_ID_B =
  "00000000-0000-0000-0000-000000000252";
const SEASON_ID = "00000000-0000-0000-0000-000000000261";

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
    actor: "assignment-migration-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "assignment-migration-test",
  });
}

async function seedDomainPrerequisites(
  t: TestBackend,
  status: "reconciled" | "transformed" = "reconciled",
): Promise<void> {
  await t.run(async (ctx) => {
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
        status,
        expectedCounts: {},
        startedAt: 1,
        updatedAt: 1,
      });
    }
  });
}

async function seedCanonicalParents(t: TestBackend) {
  return await t.run(async (ctx) => {
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
    const gameTypeId = await ctx.db.insert("gameTypes", {
      legacyId: 1,
      title: "Synthetic Game",
      lookupId: "synthetic",
      normalizedLookupId: "synthetic",
    });
    const seasonId = await ctx.db.insert("seasons", {
      legacyId: SEASON_ID,
      title: "Synthetic Season",
      gameTypeId,
    });
    const pointId = await ctx.db.insert("points", {
      legacyId: POINT_ID,
      userId,
      seasonId,
      earnedAt: 1_700_000_000_000,
      adjustment: null,
    });
    return { userId, episodeId, movieId, pointId };
  });
}

async function seedRawRows(t: TestBackend): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("migrationRawAssignments", {
      runId: RUN_ID,
      legacyId: ASSIGNMENT_ID.toUpperCase(),
      slug: "  ASSIGNMENT-２０１  ",
      userLegacyId: USER_ID,
      episodeLegacyId: EPISODE_ID,
      movieLegacyId: MOVIE_ID,
      type: "HOMEWORK",
      playable: true,
      sourceRowHash: "sha256:assignment",
    });
    await ctx.db.insert("migrationRawAssignmentAudioMessages", {
      runId: RUN_ID,
      legacyId: 7,
      url: "https://example.test/audio",
      createdAt: 1_700_000_000_001,
      userLegacyId: USER_ID,
      assignmentLegacyId: ASSIGNMENT_ID,
      fileKey: "assignment/seven",
      sourceRowHash: "sha256:audio",
    });
    await ctx.db.insert("migrationRawSyllabusEntries", {
      runId: RUN_ID,
      legacyId: SYLLABUS_ID,
      userLegacyId: USER_ID,
      movieLegacyId: MOVIE_ID,
      order: 3,
      createdAt: 1_700_000_000_002,
      assignmentLegacyId: ASSIGNMENT_ID,
      notes: "Synthetic notes",
      sourceRowHash: "sha256:syllabus",
    });
    await ctx.db.insert("migrationRawAssignmentPointLinks", {
      runId: RUN_ID,
      legacyId: POINT_LINK_ID,
      assignmentLegacyId: ASSIGNMENT_ID,
      userLegacyId: USER_ID,
      pointLegacyId: POINT_ID,
      sourceRowHash: "sha256:point-link",
    });
  });
}

async function startRun(
  t: TestBackend,
  counts = {
    assignments: 1,
    audioMessages: 1,
    syllabusEntries: 1,
    pointLinks: 1,
  },
) {
  return await t.mutation(
    internal.migration.assignments.startAssignmentRun,
    {
      cutoverRunId: RUN_ID,
      operationId: ASSIGNMENT_OPERATIONS.start,
      sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
      expectedAssignments: counts.assignments,
      expectedAudioMessages: counts.audioMessages,
      expectedSyllabusEntries: counts.syllabusEntries,
      expectedPointLinks: counts.pointLinks,
    },
  );
}

async function seedGamePointsCheckpoint(
  t: TestBackend,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("migrationCheckpoints", {
      runId: RUN_ID,
      operation: GAME_OPERATIONS.points,
      status: "completed",
      processedCount: 1,
      insertedCount: 1,
      reusedCount: 0,
      updatedAt: 1,
    });
  });
}

async function transformCore(t: TestBackend): Promise<void> {
  await t.mutation(
    internal.migration.assignments.transformAssignmentsBatch,
    {
      cutoverRunId: RUN_ID,
      operationId: ASSIGNMENT_OPERATIONS.assignments,
      batchSize: 100,
    },
  );
  await t.mutation(
    internal.migration.assignments
      .transformAssignmentAudioMessagesBatch,
    {
      cutoverRunId: RUN_ID,
      operationId: ASSIGNMENT_OPERATIONS.audioMessages,
      batchSize: 100,
    },
  );
  await t.mutation(
    internal.migration.assignments.transformSyllabusEntriesBatch,
    {
      cutoverRunId: RUN_ID,
      operationId: ASSIGNMENT_OPERATIONS.syllabusEntries,
      batchSize: 100,
    },
  );
}

async function transformPointLinks(t: TestBackend): Promise<void> {
  await t.mutation(
    internal.migration.assignments
      .transformAssignmentPointLinksBatch,
    {
      cutoverRunId: RUN_ID,
      operationId: ASSIGNMENT_OPERATIONS.pointLinks,
      batchSize: 100,
    },
  );
}

async function reconcileAll(t: TestBackend): Promise<void> {
  await t.mutation(
    internal.migration.assignmentReconciliation
      .reconcileAssignmentsBatch,
    {
      cutoverRunId: RUN_ID,
      operationId:
        ASSIGNMENT_RECONCILIATION_OPERATIONS.assignments,
      batchSize: 100,
    },
  );
  await t.mutation(
    internal.migration.assignmentReconciliation
      .reconcileAssignmentAudioMessagesBatch,
    {
      cutoverRunId: RUN_ID,
      operationId:
        ASSIGNMENT_RECONCILIATION_OPERATIONS.audioMessages,
      batchSize: 100,
    },
  );
  await t.mutation(
    internal.migration.assignmentReconciliation
      .reconcileSyllabusEntriesBatch,
    {
      cutoverRunId: RUN_ID,
      operationId:
        ASSIGNMENT_RECONCILIATION_OPERATIONS.syllabusEntries,
      batchSize: 100,
    },
  );
  await t.mutation(
    internal.migration.assignmentReconciliation
      .reconcileAssignmentPointLinksBatch,
    {
      cutoverRunId: RUN_ID,
      operationId:
        ASSIGNMENT_RECONCILIATION_OPERATIONS.pointLinks,
      batchSize: 100,
    },
  );
}

describe("assignment migration slice", () => {
  test("keeps the domain open until game points exist, then reconciles", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await seedDomainPrerequisites(t);
    await seedCanonicalParents(t);
    await seedRawRows(t);

    await expect(startRun(t)).resolves.toMatchObject({
      runId: RUN_ID,
      created: true,
      status: "running",
    });
    await expect(startRun(t)).resolves.toMatchObject({
      created: false,
    });
    await expectDomainError(
      t.mutation(
        internal.migration.assignments
          .transformAssignmentAudioMessagesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: ASSIGNMENT_OPERATIONS.audioMessages,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    await transformCore(t);
    await expectDomainError(
      t.mutation(
        internal.migration.assignments
          .transformAssignmentPointLinksBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: ASSIGNMENT_OPERATIONS.pointLinks,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    const openState = await t.run(async (ctx) => {
      const domain = await ctx.db
        .query("migrationDomainRuns")
        .withIndex("by_runId_and_domain", (query) =>
          query
            .eq("runId", RUN_ID)
            .eq("domain", "assignments"),
        )
        .unique();
      const coreCheckpoint = await ctx.db
        .query("migrationCheckpoints")
        .withIndex("by_runId_and_operation", (query) =>
          query
            .eq("runId", RUN_ID)
            .eq(
              "operation",
              ASSIGNMENT_OPERATIONS.assignments,
            ),
        )
        .unique();
      return { domain, coreCheckpoint };
    });
    expect(openState.domain?.status).toBe("running");
    expect(openState.coreCheckpoint?.status).toBe("completed");

    await seedGamePointsCheckpoint(t);
    await transformPointLinks(t);
    const transformed = await t.mutation(
      internal.migration.assignments.finishAssignmentRun,
      {
        cutoverRunId: RUN_ID,
        operationId: ASSIGNMENT_OPERATIONS.finish,
      },
    );
    expect(transformed).toEqual({
      runId: RUN_ID,
      status: "transformed",
      assignments: 1,
      audioMessages: 1,
      syllabusEntries: 1,
      pointLinks: 1,
    });

    const snapshot = await t.run(async (ctx) => {
      const assignment = await ctx.db
        .query("assignments")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", ASSIGNMENT_ID),
        )
        .unique();
      const audio = await ctx.db
        .query("assignmentAudioMessages")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", 7),
        )
        .unique();
      const syllabus = await ctx.db
        .query("syllabusEntries")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", SYLLABUS_ID),
        )
        .unique();
      const pointLink = await ctx.db
        .query("assignmentPointLinks")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", POINT_LINK_ID),
        )
        .unique();
      return { assignment, audio, syllabus, pointLink };
    });
    expect(snapshot.assignment).toMatchObject({
      slug: "  ASSIGNMENT-２０１  ",
      normalizedSlug: "assignment-201",
      type: "HOMEWORK",
      playable: true,
    });
    expect(snapshot.audio?.assignmentId).toBe(
      snapshot.assignment?._id,
    );
    expect(snapshot.syllabus?.assignmentId).toBe(
      snapshot.assignment?._id,
    );
    expect(snapshot.pointLink?.assignmentId).toBe(
      snapshot.assignment?._id,
    );

    await reconcileAll(t);
    const reconciled = await t.mutation(
      internal.migration.assignmentReconciliation
        .finishAssignmentReconciliation,
      {
        cutoverRunId: RUN_ID,
        operationId:
          ASSIGNMENT_RECONCILIATION_OPERATIONS.finish,
      },
    );
    expect(reconciled).toEqual({
      runId: RUN_ID,
      status: "reconciled",
      assignments: 1,
      audioMessages: 1,
      syllabusEntries: 1,
      pointLinks: 1,
    });
    await expect(
      t.mutation(
        internal.migration.assignmentReconciliation
          .finishAssignmentReconciliation,
        {
          cutoverRunId: RUN_ID,
          operationId:
            ASSIGNMENT_RECONCILIATION_OPERATIONS.finish,
        },
      ),
    ).resolves.toEqual(reconciled);
  });

  test("reuses exact canonical records and completed checkpoints", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await seedDomainPrerequisites(t);
    const parents = await seedCanonicalParents(t);
    await t.run(async (ctx) => {
      const assignmentId = await ctx.db.insert("assignments", {
        legacyId: ASSIGNMENT_ID,
        userId: parents.userId,
        episodeId: parents.episodeId,
        movieId: parents.movieId,
        type: "HOMEWORK",
        playable: true,
        slug: "  ASSIGNMENT-２０１  ",
        normalizedSlug: "assignment-201",
      });
      await ctx.db.insert("assignmentAudioMessages", {
        legacyId: 7,
        url: "https://example.test/audio",
        createdAt: 1_700_000_000_001,
        userId: parents.userId,
        assignmentId,
        fileKey: "assignment/seven",
      });
      await ctx.db.insert("syllabusEntries", {
        legacyId: SYLLABUS_ID,
        userId: parents.userId,
        movieId: parents.movieId,
        order: 3,
        createdAt: 1_700_000_000_002,
        assignmentId,
        notes: "Synthetic notes",
      });
      await ctx.db.insert("assignmentPointLinks", {
        legacyId: POINT_LINK_ID,
        assignmentId,
        userId: parents.userId,
        pointId: parents.pointId,
      });
    });
    await seedRawRows(t);
    await startRun(t);
    await transformCore(t);
    await seedGamePointsCheckpoint(t);
    await transformPointLinks(t);

    const checkpoints = await t.run(async (ctx) => {
      return await ctx.db
        .query("migrationCheckpoints")
        .withIndex("by_runId_and_operation", (query) =>
          query.eq("runId", RUN_ID),
        )
        .take(10);
    });
    const assignmentCheckpoints = checkpoints.filter((checkpoint) =>
      checkpoint.operation.startsWith("assignments."),
    );
    expect(assignmentCheckpoints).toHaveLength(4);
    expect(
      assignmentCheckpoints.every(
        (checkpoint) =>
          checkpoint.insertedCount === 0 &&
          checkpoint.reusedCount === 1,
      ),
    ).toBe(true);
    await expect(
      t.mutation(
        internal.migration.assignments
          .transformAssignmentAudioMessagesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: ASSIGNMENT_OPERATIONS.audioMessages,
          batchSize: 1,
        },
      ),
    ).resolves.toMatchObject({
      status: "completed",
      reusedCount: 1,
    });
  });

  test("enforces prerequisites, operation IDs, bounds, and counts", async () => {
    const missing = createTestBackend();
    await initializeAtS1(missing);
    await expectDomainError(startRun(missing), "CONFLICT");

    const transformedOnly = createTestBackend();
    await initializeAtS1(transformedOnly);
    await seedDomainPrerequisites(transformedOnly, "transformed");
    await expectDomainError(
      startRun(transformedOnly),
      "CONFLICT",
    );

    const t = createTestBackend();
    await initializeAtS1(t);
    await seedDomainPrerequisites(t);
    await expectDomainError(
      t.mutation(
        internal.migration.assignments.startAssignmentRun,
        {
          cutoverRunId: RUN_ID,
          operationId: "assignments.wrong",
          sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
          expectedAssignments: 0,
          expectedAudioMessages: 0,
          expectedSyllabusEntries: 0,
          expectedPointLinks: 0,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      startRun(t, {
        assignments: -1,
        audioMessages: 0,
        syllabusEntries: 0,
        pointLinks: 0,
      }),
      "VALIDATION_FAILED",
    );
    await startRun(t, {
      assignments: 1,
      audioMessages: 0,
      syllabusEntries: 0,
      pointLinks: 0,
    });
    await expectDomainError(
      t.mutation(
        internal.migration.assignments.transformAssignmentsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: ASSIGNMENT_OPERATIONS.audioMessages,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.assignments.transformAssignmentsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: ASSIGNMENT_OPERATIONS.assignments,
          batchSize: 101,
        },
      ),
      "VALIDATION_FAILED",
    );
    await t.mutation(
      internal.migration.assignments.transformAssignmentsBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: ASSIGNMENT_OPERATIONS.assignments,
        batchSize: 10,
      },
    );
    await t.mutation(
      internal.migration.assignments
        .transformAssignmentAudioMessagesBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: ASSIGNMENT_OPERATIONS.audioMessages,
        batchSize: 10,
      },
    );
    await t.mutation(
      internal.migration.assignments
        .transformSyllabusEntriesBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: ASSIGNMENT_OPERATIONS.syllabusEntries,
        batchSize: 10,
      },
    );
    await seedGamePointsCheckpoint(t);
    await transformPointLinks(t);
    await expectDomainError(
      t.mutation(
        internal.migration.assignments.finishAssignmentRun,
        {
          cutoverRunId: RUN_ID,
          operationId: ASSIGNMENT_OPERATIONS.finish,
        },
      ),
      "CONFLICT",
    );
  });

  test("rolls back normalized slug, ordering, and relationship collisions", async () => {
    const slug = createTestBackend();
    await initializeAtS1(slug);
    await seedDomainPrerequisites(slug);
    const slugParents = await seedCanonicalParents(slug);
    await slug.run(async (ctx) => {
      await ctx.db.insert("assignments", {
        legacyId: ASSIGNMENT_ID_B,
        userId: slugParents.userId,
        episodeId: slugParents.episodeId,
        movieId: slugParents.movieId,
        type: "HOMEWORK",
        playable: true,
        slug: "assignment-201",
        normalizedSlug: "assignment-201",
      });
      await ctx.db.insert("migrationRawAssignments", {
        runId: RUN_ID,
        legacyId: ASSIGNMENT_ID,
        slug: "  ASSIGNMENT-２０１  ",
        userLegacyId: USER_ID,
        episodeLegacyId: EPISODE_ID,
        movieLegacyId: MOVIE_ID,
        type: "HOMEWORK",
        playable: true,
        sourceRowHash: "sha256:slug-collision",
      });
    });
    await startRun(slug, {
      assignments: 1,
      audioMessages: 0,
      syllabusEntries: 0,
      pointLinks: 0,
    });
    await expectDomainError(
      slug.mutation(
        internal.migration.assignments.transformAssignmentsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: ASSIGNMENT_OPERATIONS.assignments,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    const ordering = createTestBackend();
    await initializeAtS1(ordering);
    await seedDomainPrerequisites(ordering);
    const orderParents = await seedCanonicalParents(ordering);
    await ordering.run(async (ctx) => {
      const assignmentId = await ctx.db.insert("assignments", {
        legacyId: ASSIGNMENT_ID,
        userId: orderParents.userId,
        episodeId: orderParents.episodeId,
        movieId: orderParents.movieId,
        type: "HOMEWORK",
        playable: true,
      });
      await ctx.db.insert("syllabusEntries", {
        legacyId: ASSIGNMENT_ID_B,
        userId: orderParents.userId,
        movieId: orderParents.movieId,
        order: 3,
        createdAt: 1,
      });
      await ctx.db.insert("migrationRawSyllabusEntries", {
        runId: RUN_ID,
        legacyId: SYLLABUS_ID,
        userLegacyId: USER_ID,
        movieLegacyId: MOVIE_ID,
        order: 3,
        createdAt: 2,
        assignmentLegacyId: ASSIGNMENT_ID,
        sourceRowHash: "sha256:order-collision",
      });
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
      void assignmentId;
    });
    await startRun(ordering, {
      assignments: 1,
      audioMessages: 0,
      syllabusEntries: 1,
      pointLinks: 0,
    });
    await expectDomainError(
      ordering.mutation(
        internal.migration.assignments
          .transformSyllabusEntriesBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: ASSIGNMENT_OPERATIONS.syllabusEntries,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    const links = createTestBackend();
    await initializeAtS1(links);
    await seedDomainPrerequisites(links);
    await seedCanonicalParents(links);
    await links.run(async (ctx) => {
      await ctx.db.insert("migrationRawAssignments", {
        runId: RUN_ID,
        legacyId: ASSIGNMENT_ID,
        userLegacyId: USER_ID,
        episodeLegacyId: EPISODE_ID,
        movieLegacyId: MOVIE_ID,
        type: "HOMEWORK",
        playable: true,
        sourceRowHash: "sha256:assignment",
      });
      for (const legacyId of [POINT_LINK_ID, POINT_LINK_ID_B]) {
        await ctx.db.insert("migrationRawAssignmentPointLinks", {
          runId: RUN_ID,
          legacyId,
          assignmentLegacyId: ASSIGNMENT_ID,
          userLegacyId: USER_ID,
          pointLegacyId: POINT_ID,
          sourceRowHash: `sha256:${legacyId}`,
        });
      }
    });
    await startRun(links, {
      assignments: 1,
      audioMessages: 0,
      syllabusEntries: 0,
      pointLinks: 2,
    });
    await links.mutation(
      internal.migration.assignments.transformAssignmentsBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: ASSIGNMENT_OPERATIONS.assignments,
        batchSize: 10,
      },
    );
    await seedGamePointsCheckpoint(links);
    await expectDomainError(
      links.mutation(
        internal.migration.assignments
          .transformAssignmentPointLinksBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: ASSIGNMENT_OPERATIONS.pointLinks,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    const insertedLinks = await links.run(async (ctx) => {
      return await ctx.db
        .query("assignmentPointLinks")
        .withIndex("by_assignmentId")
        .take(10);
    });
    expect(insertedLinks).toHaveLength(0);
  });

  test("detects canonical drift during independent reconciliation", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await seedDomainPrerequisites(t);
    await seedCanonicalParents(t);
    await seedRawRows(t);
    await startRun(t);
    await transformCore(t);
    await seedGamePointsCheckpoint(t);
    await transformPointLinks(t);
    await t.mutation(
      internal.migration.assignments.finishAssignmentRun,
      {
        cutoverRunId: RUN_ID,
        operationId: ASSIGNMENT_OPERATIONS.finish,
      },
    );
    await t.run(async (ctx) => {
      const assignment = await ctx.db
        .query("assignments")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", ASSIGNMENT_ID),
        )
        .unique();
      if (!assignment) {
        throw new Error("Expected assignment");
      }
      await ctx.db.patch("assignments", assignment._id, {
        type: "DRIFTED",
      });
    });
    await expectDomainError(
      t.mutation(
        internal.migration.assignmentReconciliation
          .reconcileAssignmentsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId:
            ASSIGNMENT_RECONCILIATION_OPERATIONS.assignments,
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
            .eq("runId", RUN_ID)
            .eq(
              "operation",
              ASSIGNMENT_RECONCILIATION_OPERATIONS.assignments,
            ),
        )
        .unique();
    });
    expect(checkpoint).toBeNull();
  });
});
