/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { internal } from "./_generated/api.js";
import {
  EPISODE_OPERATIONS,
  SOURCE_SCHEMA_FINGERPRINT,
} from "./migration/constants.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "episode-migration-test-001";
const EPISODE_ID_A = "00000000-0000-0000-0000-000000000101";
const EPISODE_ID_B = "00000000-0000-0000-0000-000000000102";
const LINK_ID = "00000000-0000-0000-0000-000000000111";
const BANGER_ID = "00000000-0000-0000-0000-000000000121";
const USER_ID = "legacy-episode-user";

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
    actor: "episode-migration-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "episode-migration-test",
  });
}

async function seedIdentityPrerequisite(
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
    await ctx.db.insert("migrationDomainRuns", {
      runId: CUTOVER_RUN_ID,
      domain: "identity",
      status: "transformed",
      expectedCounts: { users: 0, roles: 0, userRoles: 0 },
      startedAt: 1,
      updatedAt: 1,
    });
  });
}

async function initializeReady(t: TestBackend): Promise<void> {
  await initializeAtS1(t);
  await seedIdentityPrerequisite(t);
}

async function startRun(
  t: TestBackend,
  counts: {
    episodes: number;
    links: number;
    bangers: number;
    audioMessages: number;
  },
) {
  return await t.mutation(
    internal.migration.episodes.startEpisodeRun,
    {
      cutoverRunId: CUTOVER_RUN_ID,
      operationId: EPISODE_OPERATIONS.start,
      sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
      expectedEpisodes: counts.episodes,
      expectedLinks: counts.links,
      expectedBangers: counts.bangers,
      expectedAudioMessages: counts.audioMessages,
    },
  );
}

async function transformAll(
  t: TestBackend,
  batchSize = 100,
): Promise<void> {
  await t.mutation(
    internal.migration.episodes.transformEpisodesBatch,
    {
      cutoverRunId: CUTOVER_RUN_ID,
      operationId: EPISODE_OPERATIONS.episodes,
      batchSize,
    },
  );
  await t.mutation(
    internal.migration.episodes.transformEpisodeLinksBatch,
    {
      cutoverRunId: CUTOVER_RUN_ID,
      operationId: EPISODE_OPERATIONS.links,
      batchSize,
    },
  );
  await t.mutation(
    internal.migration.episodes.transformBangersBatch,
    {
      cutoverRunId: CUTOVER_RUN_ID,
      operationId: EPISODE_OPERATIONS.bangers,
      batchSize,
    },
  );
  await t.mutation(
    internal.migration.episodes.transformEpisodeAudioMessagesBatch,
    {
      cutoverRunId: CUTOVER_RUN_ID,
      operationId: EPISODE_OPERATIONS.audioMessages,
      batchSize,
    },
  );
}

describe("episode migration slice", () => {
  test("transforms episodes and nullable children in dependency order", async () => {
    const t = createTestBackend();
    await initializeReady(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        legacyId: USER_ID,
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("migrationRawEpisodes", {
        runId: CUTOVER_RUN_ID,
        legacyId: EPISODE_ID_A,
        number: 101,
        title: "Synthetic Episode",
        recording: "https://example.test/recording",
        date: "2025-02-03",
        description: "Synthetic description",
        status: "published",
        notes: "Synthetic notes",
        seoDescription: "SEO description",
        seoKeywords: "synthetic,episode",
        seoTitle: "SEO title",
        slug: "  EPISODE-１０１  ",
        sourceRowHash: "sha256:episode-a",
      });
      await ctx.db.insert("migrationRawEpisodes", {
        runId: CUTOVER_RUN_ID,
        legacyId: EPISODE_ID_B,
        number: 102,
        title: "Minimal Episode",
        sourceRowHash: "sha256:episode-b",
      });
      await ctx.db.insert("migrationRawEpisodeLinks", {
        runId: CUTOVER_RUN_ID,
        legacyId: LINK_ID,
        url: "https://example.test/link",
        text: "Synthetic link",
        episodeLegacyId: EPISODE_ID_A,
        sourceRowHash: "sha256:link",
      });
      await ctx.db.insert("migrationRawBangers", {
        runId: CUTOVER_RUN_ID,
        legacyId: BANGER_ID,
        title: "Synthetic Song",
        artist: "Synthetic Artist",
        url: "https://example.test/song",
        episodeLegacyId: EPISODE_ID_A,
        userLegacyId: USER_ID,
        sourceRowHash: "sha256:banger",
      });
      await ctx.db.insert("migrationRawEpisodeAudioMessages", {
        runId: CUTOVER_RUN_ID,
        legacyId: 1,
        url: "https://example.test/audio-1",
        createdAt: 1_700_000_000_000,
        fileKey: "audio/one",
        userLegacyId: USER_ID,
        episodeLegacyId: EPISODE_ID_A,
        notes: "First",
        sourceRowHash: "sha256:audio-1",
      });
      await ctx.db.insert("migrationRawEpisodeAudioMessages", {
        runId: CUTOVER_RUN_ID,
        legacyId: 2,
        url: "https://example.test/audio-2",
        createdAt: 1_700_000_000_001,
        userLegacyId: USER_ID,
        sourceRowHash: "sha256:audio-2",
      });
    });

    await expect(
      startRun(t, {
        episodes: 2,
        links: 1,
        bangers: 1,
        audioMessages: 2,
      }),
    ).resolves.toMatchObject({
      runId: CUTOVER_RUN_ID,
      created: true,
      status: "running",
    });
    await expect(
      t.mutation(
        internal.migration.episodes.transformEpisodeLinksBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: EPISODE_OPERATIONS.links,
          batchSize: 10,
        },
      ),
    ).rejects.toBeInstanceOf(ConvexError);
    await expect(
      t.mutation(
        internal.migration.episodes.transformEpisodesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: EPISODE_OPERATIONS.episodes,
          batchSize: 1,
        },
      ),
    ).resolves.toMatchObject({
      status: "running",
      processedCount: 1,
    });
    await expect(
      t.mutation(
        internal.migration.episodes.transformEpisodesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: EPISODE_OPERATIONS.episodes,
          batchSize: 1,
        },
      ),
    ).resolves.toMatchObject({
      status: "completed",
      processedCount: 2,
    });
    await t.mutation(
      internal.migration.episodes.transformEpisodeLinksBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: EPISODE_OPERATIONS.links,
        batchSize: 10,
      },
    );
    await t.mutation(
      internal.migration.episodes.transformBangersBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: EPISODE_OPERATIONS.bangers,
        batchSize: 10,
      },
    );
    await expect(
      t.mutation(
        internal.migration.episodes
          .transformEpisodeAudioMessagesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: EPISODE_OPERATIONS.audioMessages,
          batchSize: 1,
        },
      ),
    ).resolves.toMatchObject({
      status: "running",
      processedCount: 1,
    });
    const audioComplete = await t.mutation(
      internal.migration.episodes.transformEpisodeAudioMessagesBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: EPISODE_OPERATIONS.audioMessages,
        batchSize: 1,
      },
    );
    expect(audioComplete).toMatchObject({
      status: "completed",
      processedCount: 2,
      insertedCount: 2,
    });
    await expect(
      t.mutation(
        internal.migration.episodes
          .transformEpisodeAudioMessagesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: EPISODE_OPERATIONS.audioMessages,
          batchSize: 1,
        },
      ),
    ).resolves.toEqual(audioComplete);

    await expect(
      t.mutation(internal.migration.episodes.finishEpisodeRun, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: EPISODE_OPERATIONS.finish,
      }),
    ).resolves.toEqual({
      runId: CUTOVER_RUN_ID,
      status: "transformed",
      episodes: 2,
      links: 1,
      bangers: 1,
      audioMessages: 2,
    });

    const snapshot = await t.run(async (ctx) => {
      const episode = await ctx.db
        .query("episodes")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", EPISODE_ID_A),
        )
        .unique();
      const link = await ctx.db
        .query("episodeLinks")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", LINK_ID),
        )
        .unique();
      const banger = await ctx.db
        .query("bangers")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", BANGER_ID),
        )
        .unique();
      const audio = await ctx.db
        .query("episodeAudioMessages")
        .withIndex("by_legacyId")
        .take(10);
      const domain = await ctx.db
        .query("migrationDomainRuns")
        .withIndex("by_runId_and_domain", (query) =>
          query
            .eq("runId", CUTOVER_RUN_ID)
            .eq("domain", "episodes"),
        )
        .unique();
      return { episode, link, banger, audio, domain };
    });
    expect(snapshot.episode).toMatchObject({
      date: "2025-02-03",
      slug: "  EPISODE-１０１  ",
      normalizedSlug: "episode-101",
      seoTitle: "SEO title",
    });
    expect(snapshot.link?.episodeId).toBe(snapshot.episode?._id);
    expect(snapshot.banger?.episodeId).toBe(snapshot.episode?._id);
    expect(snapshot.banger?.userId).toBeDefined();
    expect(snapshot.audio).toHaveLength(2);
    expect(snapshot.audio.find((row) => row.legacyId === 2)).not
      .toHaveProperty("episodeId");
    expect(snapshot.domain?.status).toBe("transformed");
  });

  test("reuses matching canonical records and completed checkpoints", async () => {
    const t = createTestBackend();
    await initializeReady(t);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        legacyId: USER_ID,
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const episodeId = await ctx.db.insert("episodes", {
        legacyId: EPISODE_ID_A,
        number: 1,
        title: "Episode",
        slug: "episode",
        normalizedSlug: "episode",
      });
      await ctx.db.insert("episodeLinks", {
        legacyId: LINK_ID,
        url: "https://example.test/link",
        text: "Link",
        episodeId,
      });
      await ctx.db.insert("bangers", {
        legacyId: BANGER_ID,
        title: "Song",
        artist: "Artist",
        url: "https://example.test/song",
        episodeId,
        userId,
      });
      await ctx.db.insert("episodeAudioMessages", {
        legacyId: 1,
        url: "https://example.test/audio",
        createdAt: 123,
        userId,
        episodeId,
      });
      await ctx.db.insert("migrationRawEpisodes", {
        runId: CUTOVER_RUN_ID,
        legacyId: EPISODE_ID_A,
        number: 1,
        title: "Episode",
        slug: "episode",
        sourceRowHash: "sha256:episode",
      });
      await ctx.db.insert("migrationRawEpisodeLinks", {
        runId: CUTOVER_RUN_ID,
        legacyId: LINK_ID,
        url: "https://example.test/link",
        text: "Link",
        episodeLegacyId: EPISODE_ID_A,
        sourceRowHash: "sha256:link",
      });
      await ctx.db.insert("migrationRawBangers", {
        runId: CUTOVER_RUN_ID,
        legacyId: BANGER_ID,
        title: "Song",
        artist: "Artist",
        url: "https://example.test/song",
        episodeLegacyId: EPISODE_ID_A,
        userLegacyId: USER_ID,
        sourceRowHash: "sha256:banger",
      });
      await ctx.db.insert("migrationRawEpisodeAudioMessages", {
        runId: CUTOVER_RUN_ID,
        legacyId: 1,
        url: "https://example.test/audio",
        createdAt: 123,
        userLegacyId: USER_ID,
        episodeLegacyId: EPISODE_ID_A,
        sourceRowHash: "sha256:audio",
      });
    });

    await startRun(t, {
      episodes: 1,
      links: 1,
      bangers: 1,
      audioMessages: 1,
    });
    await expect(
      startRun(t, {
        episodes: 1,
        links: 1,
        bangers: 1,
        audioMessages: 1,
      }),
    ).resolves.toMatchObject({ created: false });
    await transformAll(t);
    const results = await t.run(async (ctx) => {
      return await ctx.db
        .query("migrationCheckpoints")
        .withIndex("by_runId_and_operation", (query) =>
          query.eq("runId", CUTOVER_RUN_ID),
        )
        .take(10);
    });
    expect(results).toHaveLength(4);
    expect(
      results.every(
        (checkpoint) =>
          checkpoint.reusedCount === 1 &&
          checkpoint.insertedCount === 0,
      ),
    ).toBe(true);

    const episodesResult = await t.mutation(
      internal.migration.episodes.transformEpisodesBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: EPISODE_OPERATIONS.episodes,
        batchSize: 10,
      },
    );
    expect(episodesResult).toMatchObject({
      reusedCount: 1,
      status: "completed",
    });
    await expect(
      t.mutation(
        internal.migration.episodes.transformEpisodeLinksBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: EPISODE_OPERATIONS.links,
          batchSize: 10,
        },
      ),
    ).resolves.toMatchObject({
      reusedCount: 1,
      status: "completed",
    });
    await expect(
      t.mutation(
        internal.migration.episodes.transformBangersBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: EPISODE_OPERATIONS.bangers,
          batchSize: 10,
        },
      ),
    ).resolves.toMatchObject({
      reusedCount: 1,
      status: "completed",
    });
  });

  test("enforces identity, operation, count, batch, and finish gates", async () => {
    const missingIdentity = createTestBackend();
    await initializeAtS1(missingIdentity);
    await expectDomainError(
      startRun(missingIdentity, {
        episodes: 0,
        links: 0,
        bangers: 0,
        audioMessages: 0,
      }),
      "CONFLICT",
    );

    const t = createTestBackend();
    await initializeReady(t);
    await expectDomainError(
      t.mutation(internal.migration.episodes.startEpisodeRun, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: "episodes.wrong",
        sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
        expectedEpisodes: 0,
        expectedLinks: 0,
        expectedBangers: 0,
        expectedAudioMessages: 0,
      }),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      startRun(t, {
        episodes: -1,
        links: 0,
        bangers: 0,
        audioMessages: 0,
      }),
      "VALIDATION_FAILED",
    );
    await startRun(t, {
      episodes: 0,
      links: 0,
      bangers: 0,
      audioMessages: 0,
    });
    await expectDomainError(
      t.mutation(
        internal.migration.episodes.transformEpisodesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: EPISODE_OPERATIONS.links,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.episodes.transformEpisodesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: EPISODE_OPERATIONS.episodes,
          batchSize: 101,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.mutation(internal.migration.episodes.finishEpisodeRun, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: EPISODE_OPERATIONS.finish,
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
            .eq("operation", EPISODE_OPERATIONS.links),
        )
        .unique();
      if (!checkpoint) {
        throw new Error("Link checkpoint missing");
      }
      await ctx.db.patch("migrationCheckpoints", checkpoint._id, {
        processedCount: 1,
      });
    });
    await expectDomainError(
      t.mutation(internal.migration.episodes.finishEpisodeRun, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: EPISODE_OPERATIONS.finish,
      }),
      "CONFLICT",
    );
  });

  test("rejects malformed episodes and normalized slug collisions", async () => {
    const malformed = createTestBackend();
    await initializeReady(malformed);
    await malformed.run(async (ctx) => {
      await ctx.db.insert("migrationRawEpisodes", {
        runId: CUTOVER_RUN_ID,
        legacyId: "not-a-uuid",
        number: 1,
        title: "Episode",
        sourceRowHash: "sha256:malformed",
      });
    });
    await startRun(malformed, {
      episodes: 1,
      links: 0,
      bangers: 0,
      audioMessages: 0,
    });
    await expectDomainError(
      malformed.mutation(
        internal.migration.episodes.transformEpisodesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: EPISODE_OPERATIONS.episodes,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );

    const invalidDate = createTestBackend();
    await initializeReady(invalidDate);
    await invalidDate.run(async (ctx) => {
      await ctx.db.insert("migrationRawEpisodes", {
        runId: CUTOVER_RUN_ID,
        legacyId: EPISODE_ID_A,
        number: 1,
        title: "Episode",
        date: "2025-02-30",
        sourceRowHash: "sha256:invalid-date",
      });
    });
    await startRun(invalidDate, {
      episodes: 1,
      links: 0,
      bangers: 0,
      audioMessages: 0,
    });
    await expectDomainError(
      invalidDate.mutation(
        internal.migration.episodes.transformEpisodesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: EPISODE_OPERATIONS.episodes,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );

    const malformedDate = createTestBackend();
    await initializeReady(malformedDate);
    await malformedDate.run(async (ctx) => {
      await ctx.db.insert("migrationRawEpisodes", {
        runId: CUTOVER_RUN_ID,
        legacyId: EPISODE_ID_A,
        number: 1,
        title: "Episode",
        date: "02/03/2025",
        sourceRowHash: "sha256:malformed-date",
      });
    });
    await startRun(malformedDate, {
      episodes: 1,
      links: 0,
      bangers: 0,
      audioMessages: 0,
    });
    await expectDomainError(
      malformedDate.mutation(
        internal.migration.episodes.transformEpisodesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: EPISODE_OPERATIONS.episodes,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );

    const invalidNumber = createTestBackend();
    await initializeReady(invalidNumber);
    await invalidNumber.run(async (ctx) => {
      await ctx.db.insert("migrationRawEpisodes", {
        runId: CUTOVER_RUN_ID,
        legacyId: EPISODE_ID_A,
        number: 32_768,
        title: "Episode",
        sourceRowHash: "sha256:invalid-number",
      });
    });
    await startRun(invalidNumber, {
      episodes: 1,
      links: 0,
      bangers: 0,
      audioMessages: 0,
    });
    await expectDomainError(
      invalidNumber.mutation(
        internal.migration.episodes.transformEpisodesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: EPISODE_OPERATIONS.episodes,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );

    const collision = createTestBackend();
    await initializeReady(collision);
    await collision.run(async (ctx) => {
      await ctx.db.insert("episodes", {
        legacyId: EPISODE_ID_B,
        number: 2,
        title: "Existing",
        slug: "episode",
        normalizedSlug: "episode",
      });
      await ctx.db.insert("migrationRawEpisodes", {
        runId: CUTOVER_RUN_ID,
        legacyId: EPISODE_ID_A,
        number: 1,
        title: "Incoming",
        slug: "  EPISODE  ",
        sourceRowHash: "sha256:collision",
      });
    });
    await startRun(collision, {
      episodes: 1,
      links: 0,
      bangers: 0,
      audioMessages: 0,
    });
    await expectDomainError(
      collision.mutation(
        internal.migration.episodes.transformEpisodesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: EPISODE_OPERATIONS.episodes,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
  });

  test("rolls back missing episode and user relationships", async () => {
    const missingEpisode = createTestBackend();
    await initializeReady(missingEpisode);
    await missingEpisode.run(async (ctx) => {
      await ctx.db.insert("migrationRawEpisodeLinks", {
        runId: CUTOVER_RUN_ID,
        legacyId: LINK_ID,
        url: "https://example.test/link",
        text: "Link",
        episodeLegacyId: EPISODE_ID_A,
        sourceRowHash: "sha256:missing-episode",
      });
    });
    await startRun(missingEpisode, {
      episodes: 0,
      links: 1,
      bangers: 0,
      audioMessages: 0,
    });
    await missingEpisode.mutation(
      internal.migration.episodes.transformEpisodesBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: EPISODE_OPERATIONS.episodes,
        batchSize: 10,
      },
    );
    await expectDomainError(
      missingEpisode.mutation(
        internal.migration.episodes.transformEpisodeLinksBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: EPISODE_OPERATIONS.links,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    expect(
      await missingEpisode.run(async (ctx) => {
        return await ctx.db
          .query("episodeLinks")
          .withIndex("by_legacyId")
          .take(10);
      }),
    ).toEqual([]);

    const missingUser = createTestBackend();
    await initializeReady(missingUser);
    await missingUser.run(async (ctx) => {
      await ctx.db.insert("migrationRawBangers", {
        runId: CUTOVER_RUN_ID,
        legacyId: BANGER_ID,
        title: "Song",
        artist: "Artist",
        url: "https://example.test/song",
        userLegacyId: "missing-user",
        sourceRowHash: "sha256:missing-user",
      });
    });
    await startRun(missingUser, {
      episodes: 0,
      links: 0,
      bangers: 1,
      audioMessages: 0,
    });
    await missingUser.mutation(
      internal.migration.episodes.transformEpisodesBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: EPISODE_OPERATIONS.episodes,
        batchSize: 10,
      },
    );
    await expectDomainError(
      missingUser.mutation(
        internal.migration.episodes.transformBangersBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: EPISODE_OPERATIONS.bangers,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
  });

  test("rejects conflicts with existing canonical episode records", async () => {
    const episodeConflict = createTestBackend();
    await initializeReady(episodeConflict);
    await episodeConflict.run(async (ctx) => {
      await ctx.db.insert("episodes", {
        legacyId: EPISODE_ID_A,
        number: 1,
        title: "Existing",
      });
      await ctx.db.insert("migrationRawEpisodes", {
        runId: CUTOVER_RUN_ID,
        legacyId: EPISODE_ID_A,
        number: 1,
        title: "Incoming",
        sourceRowHash: "sha256:episode-conflict",
      });
    });
    await startRun(episodeConflict, {
      episodes: 1,
      links: 0,
      bangers: 0,
      audioMessages: 0,
    });
    await expectDomainError(
      episodeConflict.mutation(
        internal.migration.episodes.transformEpisodesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: EPISODE_OPERATIONS.episodes,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    const linkConflict = createTestBackend();
    await initializeReady(linkConflict);
    await linkConflict.run(async (ctx) => {
      const episodeId = await ctx.db.insert("episodes", {
        legacyId: EPISODE_ID_A,
        number: 1,
        title: "Episode",
      });
      await ctx.db.insert("episodeLinks", {
        legacyId: LINK_ID,
        url: "https://example.test/existing",
        text: "Existing",
        episodeId,
      });
      await ctx.db.insert("migrationRawEpisodeLinks", {
        runId: CUTOVER_RUN_ID,
        legacyId: LINK_ID,
        url: "https://example.test/incoming",
        text: "Incoming",
        episodeLegacyId: EPISODE_ID_A,
        sourceRowHash: "sha256:link-conflict",
      });
    });
    await startRun(linkConflict, {
      episodes: 0,
      links: 1,
      bangers: 0,
      audioMessages: 0,
    });
    await linkConflict.mutation(
      internal.migration.episodes.transformEpisodesBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: EPISODE_OPERATIONS.episodes,
        batchSize: 10,
      },
    );
    await expectDomainError(
      linkConflict.mutation(
        internal.migration.episodes.transformEpisodeLinksBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: EPISODE_OPERATIONS.links,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    const bangerConflict = createTestBackend();
    await initializeReady(bangerConflict);
    await bangerConflict.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        legacyId: USER_ID,
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("bangers", {
        legacyId: BANGER_ID,
        title: "Existing",
        artist: "Artist",
        url: "https://example.test/existing",
        userId,
      });
      await ctx.db.insert("migrationRawBangers", {
        runId: CUTOVER_RUN_ID,
        legacyId: BANGER_ID,
        title: "Incoming",
        artist: "Artist",
        url: "https://example.test/incoming",
        userLegacyId: USER_ID,
        sourceRowHash: "sha256:banger-conflict",
      });
    });
    await startRun(bangerConflict, {
      episodes: 0,
      links: 0,
      bangers: 1,
      audioMessages: 0,
    });
    await bangerConflict.mutation(
      internal.migration.episodes.transformEpisodesBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: EPISODE_OPERATIONS.episodes,
        batchSize: 10,
      },
    );
    await expectDomainError(
      bangerConflict.mutation(
        internal.migration.episodes.transformBangersBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: EPISODE_OPERATIONS.bangers,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    const audioConflict = createTestBackend();
    await initializeReady(audioConflict);
    await audioConflict.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        legacyId: USER_ID,
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("episodeAudioMessages", {
        legacyId: 1,
        url: "https://example.test/existing",
        createdAt: 1,
        userId,
      });
      await ctx.db.insert("migrationRawEpisodeAudioMessages", {
        runId: CUTOVER_RUN_ID,
        legacyId: 1,
        url: "https://example.test/incoming",
        createdAt: 2,
        userLegacyId: USER_ID,
        sourceRowHash: "sha256:audio-conflict",
      });
    });
    await startRun(audioConflict, {
      episodes: 0,
      links: 0,
      bangers: 0,
      audioMessages: 1,
    });
    await audioConflict.mutation(
      internal.migration.episodes.transformEpisodesBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: EPISODE_OPERATIONS.episodes,
        batchSize: 10,
      },
    );
    await expectDomainError(
      audioConflict.mutation(
        internal.migration.episodes
          .transformEpisodeAudioMessagesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: EPISODE_OPERATIONS.audioMessages,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
  });

  test("rejects invalid audio rows and checkpoint cursors", async () => {
    const invalidAudio = createTestBackend();
    await initializeReady(invalidAudio);
    await invalidAudio.run(async (ctx) => {
      await ctx.db.insert("users", {
        legacyId: USER_ID,
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("migrationRawEpisodeAudioMessages", {
        runId: CUTOVER_RUN_ID,
        legacyId: 2_147_483_648,
        url: "https://example.test/audio",
        createdAt: 123,
        userLegacyId: USER_ID,
        sourceRowHash: "sha256:invalid-audio",
      });
    });
    await startRun(invalidAudio, {
      episodes: 0,
      links: 0,
      bangers: 0,
      audioMessages: 1,
    });
    await invalidAudio.mutation(
      internal.migration.episodes.transformEpisodesBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: EPISODE_OPERATIONS.episodes,
        batchSize: 10,
      },
    );
    await expectDomainError(
      invalidAudio.mutation(
        internal.migration.episodes
          .transformEpisodeAudioMessagesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: EPISODE_OPERATIONS.audioMessages,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );

    const nonFiniteAudio = createTestBackend();
    await initializeReady(nonFiniteAudio);
    await nonFiniteAudio.run(async (ctx) => {
      await ctx.db.insert("users", {
        legacyId: USER_ID,
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("migrationRawEpisodeAudioMessages", {
        runId: CUTOVER_RUN_ID,
        legacyId: 1,
        url: "https://example.test/audio",
        createdAt: Number.POSITIVE_INFINITY,
        userLegacyId: USER_ID,
        sourceRowHash: "sha256:non-finite-audio",
      });
    });
    await startRun(nonFiniteAudio, {
      episodes: 0,
      links: 0,
      bangers: 0,
      audioMessages: 1,
    });
    await nonFiniteAudio.mutation(
      internal.migration.episodes.transformEpisodesBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: EPISODE_OPERATIONS.episodes,
        batchSize: 10,
      },
    );
    await expectDomainError(
      nonFiniteAudio.mutation(
        internal.migration.episodes
          .transformEpisodeAudioMessagesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: EPISODE_OPERATIONS.audioMessages,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );

    const corruptCursor = createTestBackend();
    await initializeReady(corruptCursor);
    await startRun(corruptCursor, {
      episodes: 0,
      links: 0,
      bangers: 0,
      audioMessages: 0,
    });
    await corruptCursor.mutation(
      internal.migration.episodes.transformEpisodesBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: EPISODE_OPERATIONS.episodes,
        batchSize: 10,
      },
    );
    await corruptCursor.run(async (ctx) => {
      await ctx.db.insert("migrationCheckpoints", {
        runId: CUTOVER_RUN_ID,
        operation: EPISODE_OPERATIONS.audioMessages,
        status: "running",
        lastLegacyKey: "not-a-number",
        processedCount: 0,
        insertedCount: 0,
        reusedCount: 0,
        updatedAt: 1,
      });
    });
    await expectDomainError(
      corruptCursor.mutation(
        internal.migration.episodes
          .transformEpisodeAudioMessagesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: EPISODE_OPERATIONS.audioMessages,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
  });
});
