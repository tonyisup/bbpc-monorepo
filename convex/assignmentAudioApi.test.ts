/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const USER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|assignment-audio-user",
  issuer: "https://issuer.example.test",
  subject: "assignment-audio-user",
};
const OTHER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|assignment-audio-other",
  issuer: "https://issuer.example.test",
  subject: "assignment-audio-other",
};

function createTestBackend() {
  return convexTest(schema, modules);
}

async function expectDomainError(
  promise: Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ConvexError);
    if (!(error instanceof ConvexError)) throw error;
    expect(error.data).toMatchObject({ code: expectedCode });
    return;
  }
  throw new Error(`Expected domain error ${expectedCode}`);
}

async function seedEnabledFixture(t: ReturnType<typeof createTestBackend>) {
  const fixture = await t.run(async (ctx) => {
    const makeUser = async (subject: string) => {
      const email = `${subject}@example.test`;
      return await ctx.db.insert("users", {
        name: subject,
        email,
        normalizedEmail: email,
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
    };
    const userId = await makeUser(USER_IDENTITY.subject);
    const otherId = await makeUser(OTHER_IDENTITY.subject);
    await ctx.db.insert("authIdentities", {
      ...USER_IDENTITY,
      userId,
      linkedAt: 1,
      lastSeenAt: 1,
    });
    await ctx.db.insert("authIdentities", {
      ...OTHER_IDENTITY,
      userId: otherId,
      linkedAt: 1,
      lastSeenAt: 1,
    });
    const movieId = await ctx.db.insert("movies", {
      title: "Audio Movie",
      normalizedTitle: "audio movie",
      year: 2026,
      url: "https://example.test/audio-movie",
    });
    const episodeId = await ctx.db.insert("episodes", {
      number: 1,
      title: "Audio Episode",
      status: "next",
    });
    const assignmentId = await ctx.db.insert("assignments", {
      userId,
      movieId,
      episodeId,
      type: "HOMEWORK",
      playable: true,
    });
    return { assignmentId, otherId, userId };
  });
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: "assignment-audio-test",
    apiVersion: BBPC_API_VERSION,
    actor: "assignment-audio-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: "assignment-audio-test",
    expectedStage: "S0",
    nextStage: "S1",
    actor: "assignment-audio-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: "assignment-audio-test",
    expectedStage: "S1",
    nextStage: "S2",
    actor: "assignment-audio-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: "assignment-audio-test",
    expectedStage: "S2",
    nextStage: "S3",
    actor: "assignment-audio-test",
    approvedBackupId: "assignment-audio-backup",
    approvedBackupChecksum: "sha256:assignment-audio",
  });
  return fixture;
}

describe("assignment audio API", () => {
  test("adopts, lists, idempotently retries, and deletes an owned upload", async () => {
    const t = createTestBackend();
    const { assignmentId, userId } = await seedEnabledFixture(t);
    const input = {
      clientApiVersion: BBPC_API_VERSION,
      assignmentId,
      url: "https://utfs.io/f/assignment-audio-key",
      fileKey: "assignment-audio-key",
      createdAt: 100,
    };
    const created = await t
      .withIdentity(USER_IDENTITY)
      .mutation(api.assignments.public.createMyAudioMessage, input);
    await expect(
      t
        .withIdentity(USER_IDENTITY)
        .mutation(api.assignments.public.createMyAudioMessage, input),
    ).resolves.toEqual(created);
    await expect(
      t.withIdentity(USER_IDENTITY).query(
        api.assignments.public.listMyAudioMessages,
        { assignmentId },
      ),
    ).resolves.toEqual([created]);
    await expect(
      t.withIdentity(OTHER_IDENTITY).query(
        api.assignments.public.listMyAudioMessages,
        { assignmentId },
      ),
    ).resolves.toEqual([]);
    await expectDomainError(
      t.withIdentity(OTHER_IDENTITY).mutation(
        api.assignments.public.deleteMyAudioMessage,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: created.id,
        },
      ),
      "NOT_FOUND",
    );
    await expect(
      t.withIdentity(USER_IDENTITY).mutation(
        api.assignments.public.deleteMyAudioMessage,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: created.id,
        },
      ),
    ).resolves.toEqual({ id: created.id });
    await expectDomainError(
      t.withIdentity(OTHER_IDENTITY).mutation(
        api.assignments.public.deleteMyAudioMessage,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: created.id,
        },
      ),
      "NOT_FOUND",
    );
    await expect(
      t.withIdentity(USER_IDENTITY).mutation(
        api.assignments.public.deleteMyAudioMessage,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: created.id,
        },
      ),
    ).resolves.toEqual({ id: created.id });
    const snapshot = await t.run(async (ctx) => ({
      message: await ctx.db.get("assignmentAudioMessages", created.id),
      intent: await ctx.db
        .query("sideEffectIntents")
        .withIndex("by_idempotencyKey", (query) =>
          query.eq(
            "idempotencyKey",
            `uploadthing.deleteFile:assignmentAudioMessage:${created.id}`,
          ),
        )
        .unique(),
    }));
    expect(snapshot.message).toBeNull();
    expect(snapshot.intent).toMatchObject({
      providerKey: input.fileKey,
      requestedByUserId: userId,
      effectiveUserId: userId,
    });
  });

  test("validates adoption and queues cleanup for an unadopted upload", async () => {
    const t = createTestBackend();
    const { assignmentId } = await seedEnabledFixture(t);
    await expectDomainError(
      t.withIdentity(USER_IDENTITY).mutation(
        api.assignments.public.createMyAudioMessage,
        {
          clientApiVersion: BBPC_API_VERSION,
          assignmentId,
          url: "http://example.test/insecure",
          fileKey: "bad-key",
          createdAt: 1,
        },
      ),
      "VALIDATION_FAILED",
    );
    const cleanup = await t.withIdentity(USER_IDENTITY).mutation(
      api.assignments.public.discardMyAudioUpload,
      {
        clientApiVersion: BBPC_API_VERSION,
        assignmentId,
        fileKey: "orphan-key",
        uploadId: "orphan-upload-id-1234",
      },
    );
    expect(cleanup).toMatchObject({ queued: true });
    await expect(
      t.withIdentity(USER_IDENTITY).mutation(
        api.assignments.public.discardMyAudioUpload,
        {
          clientApiVersion: BBPC_API_VERSION,
          assignmentId,
          fileKey: "orphan-key",
          uploadId: "orphan-upload-id-1234",
        },
      ),
    ).resolves.toEqual(cleanup);
    await expectDomainError(
      t.withIdentity(USER_IDENTITY).mutation(
        api.assignments.public.discardMyAudioUpload,
        {
          clientApiVersion: BBPC_API_VERSION,
          assignmentId,
          fileKey: "orphan-key",
          uploadId: "short",
        },
      ),
      "VALIDATION_FAILED",
    );
  });

  test("rejects conflicting adoption metadata and an active-upload discard", async () => {
    const t = createTestBackend();
    const { assignmentId } = await seedEnabledFixture(t);
    const input = {
      clientApiVersion: BBPC_API_VERSION,
      assignmentId,
      url: "https://utfs.io/f/conflicting-audio-key",
      fileKey: "conflicting-audio-key",
      createdAt: 200,
    };
    await t
      .withIdentity(USER_IDENTITY)
      .mutation(api.assignments.public.createMyAudioMessage, input);
    await expectDomainError(
      t.withIdentity(USER_IDENTITY).mutation(
        api.assignments.public.createMyAudioMessage,
        { ...input, url: "https://utfs.io/f/different-url" },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.withIdentity(USER_IDENTITY).mutation(
        api.assignments.public.createMyAudioMessage,
        { ...input, createdAt: 201 },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.withIdentity(USER_IDENTITY).mutation(
        api.assignments.public.discardMyAudioUpload,
        {
          clientApiVersion: BBPC_API_VERSION,
          assignmentId,
          fileKey: input.fileKey,
          uploadId: "active-upload-id-1234",
        },
      ),
      "CONFLICT",
    );
  });

  test("covers validation boundaries and unavailable assignments", async () => {
    const t = createTestBackend();
    const { assignmentId } = await seedEnabledFixture(t);
    const baseInput = {
      clientApiVersion: BBPC_API_VERSION,
      assignmentId,
      url: "https://utfs.io/f/validation-audio-key",
      fileKey: "validation-audio-key",
      createdAt: 300,
    };
    const invalidInputs = [
      { ...baseInput, createdAt: 300.5 },
      { ...baseInput, fileKey: " " },
      { ...baseInput, fileKey: "x".repeat(1_025) },
      { ...baseInput, url: " " },
      { ...baseInput, url: `https://example.test/${"x".repeat(2_048)}` },
      { ...baseInput, url: "not a URL" },
    ];
    for (const input of invalidInputs) {
      await expectDomainError(
        t
          .withIdentity(USER_IDENTITY)
          .mutation(api.assignments.public.createMyAudioMessage, input),
        "VALIDATION_FAILED",
      );
    }
    await t.run(async (ctx) => {
      await ctx.db.delete("assignments", assignmentId);
    });
    await expectDomainError(
      t.withIdentity(USER_IDENTITY).query(
        api.assignments.public.listMyAudioMessages,
        { assignmentId },
      ),
      "NOT_FOUND",
    );
  });

  test("deletes legacy keyless audio without queuing provider cleanup", async () => {
    const t = createTestBackend();
    const { assignmentId, userId } = await seedEnabledFixture(t);
    const id = await t.run(async (ctx) =>
      await ctx.db.insert("assignmentAudioMessages", {
        assignmentId,
        userId,
        url: "https://example.test/legacy-audio.webm",
        createdAt: 400,
      }),
    );
    await expect(
      t.withIdentity(USER_IDENTITY).query(
        api.assignments.public.listMyAudioMessages,
        { assignmentId },
      ),
    ).resolves.toEqual([
      {
        id,
        url: "https://example.test/legacy-audio.webm",
        createdAt: 400,
        fileKey: null,
      },
    ]);
    await expect(
      t.withIdentity(USER_IDENTITY).mutation(
        api.assignments.public.deleteMyAudioMessage,
        { clientApiVersion: BBPC_API_VERSION, id },
      ),
    ).resolves.toEqual({ id });
    const snapshot = await t.run(async (ctx) => ({
      message: await ctx.db.get("assignmentAudioMessages", id),
      intents: await ctx.db.query("sideEffectIntents").collect(),
    }));
    expect(snapshot).toEqual({ message: null, intents: [] });
  });

  test("enforces the per-assignment audio-message limits", async () => {
    const t = createTestBackend();
    const { assignmentId, userId } = await seedEnabledFixture(t);
    await t.run(async (ctx) => {
      for (let index = 0; index < 50; index += 1) {
        await ctx.db.insert("assignmentAudioMessages", {
          assignmentId,
          userId,
          url: `https://example.test/audio-${String(index)}.webm`,
          fileKey: `audio-${String(index)}`,
          createdAt: index,
        });
      }
    });
    await expectDomainError(
      t.withIdentity(USER_IDENTITY).mutation(
        api.assignments.public.createMyAudioMessage,
        {
          clientApiVersion: BBPC_API_VERSION,
          assignmentId,
          url: "https://example.test/audio-50.webm",
          fileKey: "audio-50",
          createdAt: 50,
        },
      ),
      "CONFLICT",
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("assignmentAudioMessages", {
        assignmentId,
        userId,
        url: "https://example.test/audio-50.webm",
        fileKey: "audio-50",
        createdAt: 50,
      });
    });
    await expectDomainError(
      t.withIdentity(USER_IDENTITY).query(
        api.assignments.public.listMyAudioMessages,
        { assignmentId },
      ),
      "CONFLICT",
    );
  });
});
