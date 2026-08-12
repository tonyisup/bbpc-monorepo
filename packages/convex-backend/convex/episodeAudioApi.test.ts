/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "audio-cutover-test";
const OWNER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|audio-owner",
  issuer: "https://issuer.example.test",
  subject: "audio-owner",
};
const OTHER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|audio-other",
  issuer: "https://issuer.example.test",
  subject: "audio-other",
};

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

async function seedUser(
  t: TestBackend,
  identity: typeof OWNER_IDENTITY,
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: identity.subject,
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("authIdentities", {
      ...identity,
      userId,
      linkedAt: 1,
      lastSeenAt: 1,
    });
    return userId;
  });
}

async function initializeS1(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "audio-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "audio-test",
  });
}

async function advanceToS3(t: TestBackend): Promise<void> {
  await initializeS1(t);
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S1",
    nextStage: "S2",
    actor: "audio-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S2",
    nextStage: "S3",
    actor: "audio-test",
    approvedBackupId: "audio-backup",
    approvedBackupChecksum: "sha256:audio",
  });
}

async function seedEpisode(
  t: TestBackend,
  number: number,
): Promise<Id<"episodes">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("episodes", {
      number,
      title: `Episode ${String(number)}`,
    });
  });
}

async function seedMessage(
  t: TestBackend,
  input: {
    userId: Id<"users">;
    episodeId?: Id<"episodes">;
    createdAt: number;
    notes?: string;
  },
): Promise<Id<"episodeAudioMessages">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("episodeAudioMessages", {
      userId: input.userId,
      createdAt: input.createdAt,
      url: `https://audio.example/${String(input.createdAt)}.webm`,
      fileKey: `audio/${String(input.createdAt)}.webm`,
      ...(input.episodeId === undefined
        ? {}
        : { episodeId: input.episodeId }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
    });
  });
}

describe("owner-scoped episode audio API", () => {
  test("requires authentication and lists only the owner's episode messages", async () => {
    const t = createTestBackend();
    const ownerId = await seedUser(t, OWNER_IDENTITY);
    const otherId = await seedUser(t, OTHER_IDENTITY);
    const episodeId = await seedEpisode(t, 1);
    const olderId = await seedMessage(t, {
      userId: ownerId,
      episodeId,
      createdAt: 1,
    });
    const newerId = await seedMessage(t, {
      userId: ownerId,
      episodeId,
      createdAt: 2,
      notes: "newer",
    });
    await seedMessage(t, {
      userId: otherId,
      episodeId,
      createdAt: 3,
    });
    await seedMessage(t, {
      userId: ownerId,
      createdAt: 4,
    });

    await expectDomainError(
      t.query(api.episodes.audio.listMine, {
        episodeId,
        paginationOpts: { cursor: null, numItems: 1 },
      }),
      "AUTHENTICATION_REQUIRED",
    );

    const firstPage = await t.withIdentity(OWNER_IDENTITY).query(
      api.episodes.audio.listMine,
      {
        episodeId,
        paginationOpts: { cursor: null, numItems: 1 },
      },
    );
    expect(firstPage.page).toEqual([
      expect.objectContaining({
        id: newerId,
        notes: "newer",
      }),
    ]);
    expect(firstPage.isDone).toBe(false);

    const secondPage = await t.withIdentity(OWNER_IDENTITY).query(
      api.episodes.audio.listMine,
      {
        episodeId,
        paginationOpts: {
          cursor: firstPage.continueCursor,
          numItems: 1,
        },
      },
    );
    expect(secondPage.page).toEqual([
      expect.objectContaining({
        id: olderId,
        notes: null,
      }),
    ]);
  });

  test("reports bounded per-episode usage", async () => {
    const t = createTestBackend();
    const ownerId = await seedUser(t, OWNER_IDENTITY);
    const episodeId = await seedEpisode(t, 1);
    await seedMessage(t, {
      userId: ownerId,
      episodeId,
      createdAt: 1,
    });

    await expect(
      t.withIdentity(OWNER_IDENTITY).query(
        api.episodes.audio.usageForEpisode,
        { episodeId },
      ),
    ).resolves.toEqual({
      count: 1,
      limit: 50,
      canUpload: true,
    });
  });

  test("creates an owned message idempotently and writes audit evidence", async () => {
    const t = createTestBackend();
    await seedUser(t, OWNER_IDENTITY);
    const episodeId = await seedEpisode(t, 1);
    await advanceToS3(t);
    const input = {
      clientApiVersion: BBPC_API_VERSION,
      episodeId,
      url: " https://audio.example/new.webm ",
      fileKey: "audio/new.webm",
      createdAt: 1_786_000_000_000,
      notes: " Play during extras ",
    };

    const created = await t
      .withIdentity(OWNER_IDENTITY)
      .mutation(api.episodes.audio.createMine, input);
    const repeated = await t
      .withIdentity(OWNER_IDENTITY)
      .mutation(api.episodes.audio.createMine, input);

    expect(repeated).toEqual(created);
    expect(created).toMatchObject({
      episodeId,
      url: "https://audio.example/new.webm",
      fileKey: "audio/new.webm",
      notes: "Play during extras",
    });
    const snapshot = await t.run(async (ctx) => ({
      messages: await ctx.db.query("episodeAudioMessages").collect(),
      audits: await ctx.db
        .query("auditEvents")
        .withIndex("by_createdAt")
        .collect(),
    }));
    expect(snapshot.messages).toHaveLength(1);
    expect(
      snapshot.audits.filter(
        (audit) => audit.action === "episodes.audioMessage.created",
      ),
    ).toHaveLength(1);
  });

  test("validates new audio uploads and requires an existing episode", async () => {
    const t = createTestBackend();
    await seedUser(t, OWNER_IDENTITY);
    const episodeId = await seedEpisode(t, 1);
    const missingEpisodeId = await seedEpisode(t, 2);
    await t.run(async (ctx) => {
      await ctx.db.delete("episodes", missingEpisodeId);
    });
    await advanceToS3(t);

    for (const input of [
      { url: "http://audio.example/a.webm", fileKey: "audio/a", createdAt: 1 },
      { url: "not-a-url", fileKey: "audio/a", createdAt: 1 },
      { url: "https://audio.example/a.webm", fileKey: " ", createdAt: 1 },
      {
        url: "https://audio.example/a.webm",
        fileKey: "audio/a",
        createdAt: 1.5,
      },
    ]) {
      await expectDomainError(
        t.withIdentity(OWNER_IDENTITY).mutation(
          api.episodes.audio.createMine,
          {
            clientApiVersion: BBPC_API_VERSION,
            episodeId,
            ...input,
          },
        ),
        "VALIDATION_FAILED",
      );
    }
    await expectDomainError(
      t.withIdentity(OWNER_IDENTITY).mutation(
        api.episodes.audio.createMine,
        {
          clientApiVersion: BBPC_API_VERSION,
          episodeId: missingEpisodeId,
          url: "https://audio.example/a.webm",
          fileKey: "audio/a",
          createdAt: 1,
        },
      ),
      "NOT_FOUND",
    );
  });

  test("blocks owner mutations while application writes are disabled", async () => {
    const t = createTestBackend();
    const ownerId = await seedUser(t, OWNER_IDENTITY);
    const episodeId = await seedEpisode(t, 1);
    const messageId = await seedMessage(t, {
      userId: ownerId,
      episodeId,
      createdAt: 1,
    });
    await initializeS1(t);

    await expectDomainError(
      t.withIdentity(OWNER_IDENTITY).mutation(
        api.episodes.audio.updateMine,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: messageId,
          episodeId,
          fileKey: "audio/updated.webm",
        },
      ),
      "WRITE_DISABLED",
    );
    await expectDomainError(
      t.withIdentity(OWNER_IDENTITY).mutation(
        api.episodes.audio.createMine,
        {
          clientApiVersion: BBPC_API_VERSION,
          episodeId,
          url: "https://audio.example/new.webm",
          fileKey: "audio/new.webm",
          createdAt: 2,
        },
      ),
      "WRITE_DISABLED",
    );
  });

  test("updates an owned message and writes audit evidence", async () => {
    const t = createTestBackend();
    const ownerId = await seedUser(t, OWNER_IDENTITY);
    const originalEpisodeId = await seedEpisode(t, 1);
    const nextEpisodeId = await seedEpisode(t, 2);
    const messageId = await seedMessage(t, {
      userId: ownerId,
      episodeId: originalEpisodeId,
      createdAt: 1,
      notes: "old",
    });
    await advanceToS3(t);

    await expect(
      t.withIdentity(OWNER_IDENTITY).mutation(
        api.episodes.audio.updateMine,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: messageId,
          episodeId: nextEpisodeId,
          fileKey: "audio/updated.webm",
        },
      ),
    ).resolves.toMatchObject({
      id: messageId,
      episodeId: nextEpisodeId,
      fileKey: "audio/updated.webm",
      notes: null,
    });

    const snapshot = await t.run(async (ctx) => {
      const message = await ctx.db.get(
        "episodeAudioMessages",
        messageId,
      );
      const audits = await ctx.db
        .query("auditEvents")
        .withIndex("by_createdAt")
        .take(20);
      return { message, audits };
    });
    expect(snapshot.message).toMatchObject({
      episodeId: nextEpisodeId,
      fileKey: "audio/updated.webm",
    });
    expect(snapshot.message?.notes).toBeUndefined();
    expect(snapshot.audits.map((audit) => audit.action)).toEqual(
      expect.arrayContaining([
        "system.firstApplicationWrite",
        "episodes.audioMessage.updated",
      ]),
    );
  });

  test("does not disclose or mutate another user's message", async () => {
    const t = createTestBackend();
    await seedUser(t, OWNER_IDENTITY);
    const otherId = await seedUser(t, OTHER_IDENTITY);
    const episodeId = await seedEpisode(t, 1);
    const messageId = await seedMessage(t, {
      userId: otherId,
      episodeId,
      createdAt: 1,
    });
    await advanceToS3(t);

    await expectDomainError(
      t.withIdentity(OWNER_IDENTITY).mutation(
        api.episodes.audio.updateMine,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: messageId,
          episodeId,
          fileKey: "audio/updated.webm",
        },
      ),
      "NOT_FOUND",
    );
    await expectDomainError(
      t.withIdentity(OWNER_IDENTITY).mutation(
        api.episodes.audio.deleteMine,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: messageId,
        },
      ),
      "NOT_FOUND",
    );
  });

  test("validates updates and requires an existing episode", async () => {
    const t = createTestBackend();
    const ownerId = await seedUser(t, OWNER_IDENTITY);
    const episodeId = await seedEpisode(t, 1);
    const missingEpisodeId = await seedEpisode(t, 2);
    const messageId = await seedMessage(t, {
      userId: ownerId,
      episodeId,
      createdAt: 1,
    });
    await t.run(async (ctx) => {
      await ctx.db.delete("episodes", missingEpisodeId);
    });
    await advanceToS3(t);

    for (const input of [
      { fileKey: " ", notes: undefined },
      { fileKey: "x".repeat(1025), notes: undefined },
      { fileKey: "valid", notes: "x".repeat(5001) },
    ]) {
      await expectDomainError(
        t.withIdentity(OWNER_IDENTITY).mutation(
          api.episodes.audio.updateMine,
          {
            clientApiVersion: BBPC_API_VERSION,
            id: messageId,
            episodeId,
            fileKey: input.fileKey,
            ...(input.notes === undefined
              ? {}
              : { notes: input.notes }),
          },
        ),
        "VALIDATION_FAILED",
      );
    }
    await expectDomainError(
      t.withIdentity(OWNER_IDENTITY).mutation(
        api.episodes.audio.updateMine,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: messageId,
          episodeId: missingEpisodeId,
          fileKey: "audio/valid.webm",
        },
      ),
      "NOT_FOUND",
    );
  });

  test("deletes an owned message and audits the mutation", async () => {
    const t = createTestBackend();
    const ownerId = await seedUser(t, OWNER_IDENTITY);
    const episodeId = await seedEpisode(t, 1);
    const messageId = await seedMessage(t, {
      userId: ownerId,
      episodeId,
      createdAt: 1,
    });
    await advanceToS3(t);

    await expect(
      t.withIdentity(OWNER_IDENTITY).mutation(
        api.episodes.audio.deleteMine,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: messageId,
        },
      ),
    ).resolves.toEqual({ id: messageId });

    const snapshot = await t.run(async (ctx) => {
      const message = await ctx.db.get(
        "episodeAudioMessages",
        messageId,
      );
      const audits = await ctx.db
        .query("auditEvents")
        .withIndex("by_createdAt")
        .take(20);
      return { message, audits };
    });
    expect(snapshot.message).toBeNull();
    expect(snapshot.audits.map((audit) => audit.action)).toContain(
      "episodes.audioMessage.deleted",
    );
  });

  test("queues cleanup for an unadopted upload and rejects active files", async () => {
    const t = createTestBackend();
    const ownerId = await seedUser(t, OWNER_IDENTITY);
    const episodeId = await seedEpisode(t, 1);
    const activeId = await seedMessage(t, {
      userId: ownerId,
      episodeId,
      createdAt: 1,
    });
    await advanceToS3(t);

    await expectDomainError(
      t.withIdentity(OWNER_IDENTITY).mutation(
        api.episodes.audio.discardMyUpload,
        {
          clientApiVersion: BBPC_API_VERSION,
          episodeId,
          fileKey: "audio/1.webm",
          uploadId: "upload_active_1234",
        },
      ),
      "CONFLICT",
    );

    const discarded = await t
      .withIdentity(OWNER_IDENTITY)
      .mutation(api.episodes.audio.discardMyUpload, {
        clientApiVersion: BBPC_API_VERSION,
        episodeId,
        fileKey: "audio/orphan.webm",
        uploadId: "upload_orphan_1234",
      });
    expect(discarded.queued).toBe(true);
    const snapshot = await t.run(async (ctx) => ({
      active: await ctx.db.get("episodeAudioMessages", activeId),
      intent: await ctx.db.get("sideEffectIntents", discarded.intentId),
      audits: await ctx.db.query("auditEvents").collect(),
    }));
    expect(snapshot.active).not.toBeNull();
    expect(snapshot.intent).toMatchObject({
      operation: "uploadthing.deleteFile",
      providerKey: "audio/orphan.webm",
      resourceType: "episodeAudioMessage",
      resourceId: "upload_orphan_1234",
    });
    expect(snapshot.audits.map((audit) => audit.action)).toContain(
      "episodes.audioMessage.uploadDiscarded",
    );
  });

  test("fails closed when persisted usage exceeds the domain cap", async () => {
    const t = createTestBackend();
    const ownerId = await seedUser(t, OWNER_IDENTITY);
    const episodeId = await seedEpisode(t, 1);
    await t.run(async (ctx) => {
      for (let index = 0; index < 51; index += 1) {
        await ctx.db.insert("episodeAudioMessages", {
          userId: ownerId,
          episodeId,
          createdAt: index,
          url: `https://audio.example/${String(index)}.webm`,
        });
      }
    });

    await expectDomainError(
      t.withIdentity(OWNER_IDENTITY).query(
        api.episodes.audio.usageForEpisode,
        { episodeId },
      ),
      "CONFLICT",
    );
  });
});
