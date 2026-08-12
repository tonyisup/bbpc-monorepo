/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "profile-image-cutover";
const USER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|profile-image-user",
  issuer: "https://issuer.example.test",
  subject: "profile-image-user",
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

async function seedEnabledUser(t: TestBackend) {
  const userId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: "Profile User",
      email: "profile@example.test",
      normalizedEmail: "profile@example.test",
      image: "https://utfs.io/f/old-profile",
      imageFileKey: "old-profile-key",
      imageUploadId: "old-profile-upload-id",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("authIdentities", {
      ...USER_IDENTITY,
      userId,
      linkedAt: 1,
      lastSeenAt: 1,
    });
    return userId;
  });
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "profile-image-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "profile-image-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S1",
    nextStage: "S2",
    actor: "profile-image-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S2",
    nextStage: "S3",
    actor: "profile-image-test",
    approvedBackupId: "profile-image-backup",
    approvedBackupChecksum: "sha256:profile-image",
  });
  return userId;
}

describe("profile image saga", () => {
  test("atomically adopts a new image and queues old-file cleanup", async () => {
    const t = createTestBackend();
    const userId = await seedEnabledUser(t);

    await expect(
      t
        .withIdentity(USER_IDENTITY)
        .mutation(api.identity.profile.updateMyProfileWithImage, {
          clientApiVersion: BBPC_API_VERSION,
          name: " Updated Profile ",
          image: "https://utfs.io/f/new-profile",
          fileKey: "new-profile-key",
          uploadId: "new-profile-upload-id",
          expectedImage: "https://utfs.io/f/old-profile",
        }),
    ).resolves.toMatchObject({
      name: "Updated Profile",
      image: "https://utfs.io/f/new-profile",
    });

    const snapshot = await t.run(async (ctx) => ({
      user: await ctx.db.get("users", userId),
      intent: await ctx.db
        .query("sideEffectIntents")
        .withIndex("by_idempotencyKey", (query) =>
          query.eq(
            "idempotencyKey",
            "uploadthing.deleteFile:profileImage:old-profile-upload-id",
          ),
        )
        .unique(),
      audits: await ctx.db
        .query("auditEvents")
        .withIndex("by_createdAt")
        .collect(),
    }));
    expect(snapshot.user).toMatchObject({
      name: "Updated Profile",
      image: "https://utfs.io/f/new-profile",
      imageFileKey: "new-profile-key",
      imageUploadId: "new-profile-upload-id",
    });
    expect(snapshot.intent).toMatchObject({
      resourceType: "profileImage",
      resourceId: "old-profile-upload-id",
      providerKey: "old-profile-key",
      requestedByUserId: userId,
      effectiveUserId: userId,
      status: "pending",
    });
    expect(snapshot.audits.map((audit) => audit.action)).toContain(
      "identity.profile.imageUpdated",
    );
  });

  test("queues an unadopted upload and refuses to discard the active image", async () => {
    const t = createTestBackend();
    await seedEnabledUser(t);

    const first = await t
      .withIdentity(USER_IDENTITY)
      .mutation(api.identity.profile.discardMyProfileImageUpload, {
        clientApiVersion: BBPC_API_VERSION,
        fileKey: "unadopted-key",
        uploadId: "unadopted-upload-id",
      });
    await expect(
      t
        .withIdentity(USER_IDENTITY)
        .mutation(api.identity.profile.discardMyProfileImageUpload, {
          clientApiVersion: BBPC_API_VERSION,
          fileKey: "unadopted-key",
          uploadId: "unadopted-upload-id",
        }),
    ).resolves.toEqual(first);
    await expectDomainError(
      t
        .withIdentity(USER_IDENTITY)
        .mutation(api.identity.profile.discardMyProfileImageUpload, {
          clientApiVersion: BBPC_API_VERSION,
          fileKey: "old-profile-key",
          uploadId: "old-profile-upload-id",
        }),
      "CONFLICT",
    );
  });

  test("fails closed on stale state, malformed inputs, and incomplete old metadata", async () => {
    const t = createTestBackend();
    const userId = await seedEnabledUser(t);
    const mutate = (overrides: Record<string, string | null> = {}) =>
      t
        .withIdentity(USER_IDENTITY)
        .mutation(api.identity.profile.updateMyProfileWithImage, {
          clientApiVersion: BBPC_API_VERSION,
          name: "Profile User",
          image: "https://utfs.io/f/new-profile",
          fileKey: "new-profile-key",
          uploadId: "new-profile-upload-id",
          expectedImage: "https://utfs.io/f/old-profile",
          ...overrides,
        });

    await expectDomainError(
      mutate({ expectedImage: "https://example.test/stale" }),
      "CONFLICT",
    );
    await expectDomainError(
      mutate({ image: "http://example.test/insecure" }),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      mutate({ image: "not-a-url" }),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      mutate({ uploadId: "short" }),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      mutate({ uploadId: "invalid upload id value" }),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      mutate({ fileKey: "old-profile-key" }),
      "CONFLICT",
    );
    await expectDomainError(
      mutate({ uploadId: "old-profile-upload-id" }),
      "CONFLICT",
    );

    await t.run(async (ctx) => {
      await ctx.db.patch("users", userId, {
        imageUploadId: undefined,
      });
    });
    await expectDomainError(mutate(), "CONFLICT");
  });

  test("does not expose provider keys through the linked profile", async () => {
    const t = createTestBackend();
    await seedEnabledUser(t);

    const profile = await t
      .withIdentity(USER_IDENTITY)
      .query(api.identity.profile.me, {});
    expect(profile.image).toBe("https://utfs.io/f/old-profile");
    expect(JSON.stringify(profile)).not.toContain("old-profile-key");
    expect(JSON.stringify(profile)).not.toContain(
      "old-profile-upload-id",
    );
  });
});
