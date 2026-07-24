/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { internal } from "./_generated/api.js";
import {
  ARCHIVE_OPERATIONS,
  ARCHIVE_RECONCILIATION_OPERATIONS,
  SOURCE_SCHEMA_FINGERPRINT,
} from "./migration/constants.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const RUN_ID = "archive-test-001";
const EPISODE_ID = "00000000-0000-0000-0000-000000000101";

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
    actor: "archive-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "archive-test",
  });
}

async function seedPrerequisites(
  t: TestBackend,
  episodeStatus: "reconciled" | "transformed" = "reconciled",
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
      domain: "episodes",
      status: episodeStatus,
      expectedCounts: {},
      startedAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("episodes", {
      legacyId: EPISODE_ID,
      number: 1,
      title: "Episode",
    });
  });
}

async function seedRows(t: TestBackend): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("migrationRawArchivePosts", {
      runId: RUN_ID,
      legacyId: 1,
      postedAt: 1_700_000_000_000,
      content: "<p>Linked</p>",
      title: "Linked post",
      episodeLegacyId: EPISODE_ID,
      sourceRowHash: "sha256:linked",
    });
    await ctx.db.insert("migrationRawArchivePosts", {
      runId: RUN_ID,
      legacyId: 2,
      postedAt: 1_700_000_000_001,
      content: "",
      title: "",
      sourceRowHash: "sha256:unlinked",
    });
  });
}

async function startRun(t: TestBackend, expectedPosts = 2) {
  return await t.mutation(
    internal.migration.archive.startArchiveRun,
    {
      cutoverRunId: RUN_ID,
      operationId: ARCHIVE_OPERATIONS.start,
      sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
      expectedPosts,
    },
  );
}

async function transform(t: TestBackend, batchSize = 100) {
  return await t.mutation(
    internal.migration.archive.transformArchivePostsBatch,
    {
      cutoverRunId: RUN_ID,
      operationId: ARCHIVE_OPERATIONS.posts,
      batchSize,
    },
  );
}

async function finishTransform(t: TestBackend) {
  return await t.mutation(
    internal.migration.archive.finishArchiveRun,
    {
      cutoverRunId: RUN_ID,
      operationId: ARCHIVE_OPERATIONS.finish,
    },
  );
}

describe("archive migration slice", () => {
  test("preserves linked and unlinked posts, reuses, and reconciles", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await seedPrerequisites(t);
    await seedRows(t);
    await expect(startRun(t)).resolves.toMatchObject({
      created: true,
      status: "running",
    });
    await expect(startRun(t)).resolves.toMatchObject({
      created: false,
    });
    await expect(transform(t, 1)).resolves.toMatchObject({
      status: "running",
      processedCount: 1,
    });
    await expect(transform(t, 1)).resolves.toMatchObject({
      status: "completed",
      processedCount: 2,
    });
    await expect(transform(t, 1)).resolves.toMatchObject({
      status: "completed",
      processedCount: 2,
    });

    const posts = await t.run(async (ctx) => {
      return await ctx.db.query("archivePosts").take(10);
    });
    expect(posts).toHaveLength(2);
    expect(
      posts.find((post) => post.legacyId === 1)?.episodeId,
    ).toBeDefined();
    expect(
      posts.find((post) => post.legacyId === 2)?.episodeId,
    ).toBeUndefined();
    expect(posts.find((post) => post.legacyId === 2)).toMatchObject({
      content: "",
      title: "",
    });

    await t.run(async (ctx) => {
      const checkpoint = await ctx.db
        .query("migrationCheckpoints")
        .withIndex("by_runId_and_operation", (query) =>
          query
            .eq("runId", RUN_ID)
            .eq("operation", ARCHIVE_OPERATIONS.posts),
        )
        .unique();
      if (!checkpoint) {
        throw new Error("Expected archive checkpoint");
      }
      await ctx.db.delete("migrationCheckpoints", checkpoint._id);
    });
    await expect(transform(t)).resolves.toMatchObject({
      insertedCount: 0,
      reusedCount: 2,
    });
    await expect(finishTransform(t)).resolves.toEqual({
      runId: RUN_ID,
      status: "transformed",
      posts: 2,
    });

    await expectDomainError(
      t.mutation(
        internal.migration.archiveReconciliation
          .finishArchiveReconciliation,
        {
          cutoverRunId: RUN_ID,
          operationId: ARCHIVE_RECONCILIATION_OPERATIONS.finish,
        },
      ),
      "CONFLICT",
    );
    await t.mutation(
      internal.migration.archiveReconciliation
        .reconcileArchivePostsBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: ARCHIVE_RECONCILIATION_OPERATIONS.posts,
        batchSize: 1,
      },
    );
    await t.mutation(
      internal.migration.archiveReconciliation
        .reconcileArchivePostsBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: ARCHIVE_RECONCILIATION_OPERATIONS.posts,
        batchSize: 1,
      },
    );
    await t.mutation(
      internal.migration.archiveReconciliation
        .reconcileArchivePostsBatch,
      {
        cutoverRunId: RUN_ID,
        operationId: ARCHIVE_RECONCILIATION_OPERATIONS.posts,
        batchSize: 1,
      },
    );
    const reconciled = await t.mutation(
      internal.migration.archiveReconciliation
        .finishArchiveReconciliation,
      {
        cutoverRunId: RUN_ID,
        operationId: ARCHIVE_RECONCILIATION_OPERATIONS.finish,
      },
    );
    expect(reconciled).toEqual({
      runId: RUN_ID,
      status: "reconciled",
      posts: 2,
    });
    await expect(
      t.mutation(
        internal.migration.archiveReconciliation
          .finishArchiveReconciliation,
        {
          cutoverRunId: RUN_ID,
          operationId: ARCHIVE_RECONCILIATION_OPERATIONS.finish,
        },
      ),
    ).resolves.toEqual(reconciled);
  });

  test("requires reconciled episodes and valid run gates", async () => {
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
      t.mutation(internal.migration.archive.startArchiveRun, {
        cutoverRunId: RUN_ID,
        operationId: "archive.wrong",
        sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
        expectedPosts: 0,
      }),
      "VALIDATION_FAILED",
    );
    await expectDomainError(startRun(t, -1), "VALIDATION_FAILED");
    await expectDomainError(
      t.mutation(internal.migration.archive.startArchiveRun, {
        cutoverRunId: RUN_ID,
        operationId: ARCHIVE_OPERATIONS.start,
        sourceSchemaFingerprint: "wrong",
        expectedPosts: 0,
      }),
      "CONFLICT",
    );
    await startRun(t, 0);
    await expectDomainError(
      t.mutation(
        internal.migration.archive.transformArchivePostsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: ARCHIVE_OPERATIONS.posts,
          batchSize: 101,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(finishTransform(t), "CONFLICT");
  });

  test("rejects invalid IDs, missing episodes, and canonical drift", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await seedPrerequisites(t);
    await startRun(t, 1);
    const rawId = await t.run(async (ctx) => {
      return await ctx.db.insert("migrationRawArchivePosts", {
        runId: RUN_ID,
        legacyId: 0,
        postedAt: 1,
        content: "Content",
        title: "Title",
        episodeLegacyId:
          "00000000-0000-0000-0000-000000000199",
        sourceRowHash: "sha256:post",
      });
    });
    await expectDomainError(transform(t), "VALIDATION_FAILED");
    await t.run(async (ctx) => {
      await ctx.db.patch("migrationRawArchivePosts", rawId, {
        legacyId: 2_147_483_648,
      });
    });
    await expectDomainError(transform(t), "VALIDATION_FAILED");
    await t.run(async (ctx) => {
      await ctx.db.patch("migrationRawArchivePosts", rawId, {
        legacyId: 1,
        episodeLegacyId: "not-a-uuid",
      });
    });
    await expectDomainError(transform(t), "VALIDATION_FAILED");
    await t.run(async (ctx) => {
      await ctx.db.patch("migrationRawArchivePosts", rawId, {
        episodeLegacyId:
          "00000000-0000-0000-0000-000000000199",
      });
    });
    await expectDomainError(transform(t), "CONFLICT");

    const drift = createTestBackend();
    await initializeAtS1(drift);
    await seedPrerequisites(drift);
    await seedRows(drift);
    await startRun(drift);
    await transform(drift);
    await drift.run(async (ctx) => {
      const post = await ctx.db
        .query("archivePosts")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", 1),
        )
        .unique();
      if (!post) {
        throw new Error("Expected archive post");
      }
      await ctx.db.patch("archivePosts", post._id, {
        title: "Drifted",
      });
      const checkpoint = await ctx.db
        .query("migrationCheckpoints")
        .withIndex("by_runId_and_operation", (query) =>
          query
            .eq("runId", RUN_ID)
            .eq("operation", ARCHIVE_OPERATIONS.posts),
        )
        .unique();
      if (!checkpoint) {
        throw new Error("Expected archive checkpoint");
      }
      await ctx.db.delete("migrationCheckpoints", checkpoint._id);
    });
    await expectDomainError(transform(drift), "CONFLICT");
    await drift.run(async (ctx) => {
      const post = await ctx.db
        .query("archivePosts")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", 1),
        )
        .unique();
      if (!post) {
        throw new Error("Expected archive post");
      }
      await ctx.db.patch("archivePosts", post._id, {
        title: "Linked post",
      });
    });
    await transform(drift);
    await finishTransform(drift);
    await drift.run(async (ctx) => {
      const post = await ctx.db
        .query("archivePosts")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", 1),
        )
        .unique();
      if (!post) {
        throw new Error("Expected archive post");
      }
      await ctx.db.patch("archivePosts", post._id, {
        title: "Drifted again",
      });
    });
    await expectDomainError(
      drift.mutation(
        internal.migration.archiveReconciliation
          .reconcileArchivePostsBatch,
        {
          cutoverRunId: RUN_ID,
          operationId: ARCHIVE_RECONCILIATION_OPERATIONS.posts,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
  });

  test("rejects malformed numeric checkpoint cursors", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await seedPrerequisites(t);
    await startRun(t, 0);
    await t.run(async (ctx) => {
      await ctx.db.insert("migrationCheckpoints", {
        runId: RUN_ID,
        operation: ARCHIVE_OPERATIONS.posts,
        status: "running",
        lastLegacyKey: "not-a-number",
        processedCount: 0,
        insertedCount: 0,
        reusedCount: 0,
        updatedAt: 1,
      });
    });
    await expectDomainError(transform(t), "CONFLICT");
  });
});
