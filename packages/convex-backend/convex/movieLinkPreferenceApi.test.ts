/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "movie-link-cutover";
const USER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|movie-link-user",
  issuer: "https://issuer.example.test",
  subject: "movie-link-user",
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
      name: "Movie Link User",
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
    actor: "movie-link-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "movie-link-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S1",
    nextStage: "S2",
    actor: "movie-link-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S2",
    nextStage: "S3",
    actor: "movie-link-test",
    approvedBackupId: "movie-link-backup",
    approvedBackupChecksum: "sha256:movie-link",
  });
  return userId;
}

describe("movie link preferences", () => {
  test("defaults existing and newly linked accounts to IMDb", async () => {
    const t = createTestBackend();
    await seedEnabledUser(t);
    const client = t.withIdentity(USER_IDENTITY);
    expect(await client.query(api.identity.profile.me, {})).toMatchObject({
      movieLinkPreference: "imdb",
    });
    const newcomer = t.withIdentity({
      tokenIdentifier: "https://issuer.example.test|new-movie-link-user",
      issuer: USER_IDENTITY.issuer,
      subject: "new-movie-link-user",
      email: "new-movie-link-user@example.test",
      emailVerified: true,
    });
    expect(
      await newcomer.mutation(api.identity.linking.linkOrCreateMe, {
        clientApiVersion: BBPC_API_VERSION,
      }),
    ).toMatchObject({ movieLinkPreference: "imdb", linkMode: "newUser" });
  });

  test("persists both choices on the current account without changing other profile fields", async () => {
    const t = createTestBackend();
    const userId = await seedEnabledUser(t);
    const otherId = await t.run((ctx) =>
      ctx.db.insert("users", {
        name: "Another User",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const client = t.withIdentity(USER_IDENTITY);
    for (const movieLinkPreference of ["tmdb", "imdb"] as const) {
      expect(
        await client.mutation(
          api.identity.profile.updateMyMovieLinkPreference,
          {
            clientApiVersion: BBPC_API_VERSION,
            movieLinkPreference,
          },
        ),
      ).toMatchObject({ movieLinkPreference });
      expect(await client.query(api.identity.profile.me, {})).toMatchObject({
        movieLinkPreference,
      });
      expect(
        await client.mutation(api.identity.linking.linkOrCreateMe, {
          clientApiVersion: BBPC_API_VERSION,
        }),
      ).toMatchObject({ movieLinkPreference });
      const stored = await t.run((ctx) => ctx.db.get("users", userId));
      expect(stored).toMatchObject({
        movieLinkPreference,
        name: "Movie Link User",
        imageFileKey: "old-profile-key",
      });
    }
    expect(
      await t.run((ctx) => ctx.db.get("users", otherId)),
    ).not.toHaveProperty("movieLinkPreference");
    const audits = await t.run((ctx) => ctx.db.query("auditEvents").take(20));
    expect(
      audits.filter(
        (audit) =>
          audit.action === "identity.profile.movieLinkPreferenceUpdated",
      ),
    ).toHaveLength(2);
  });

  test("rejects anonymous, stale, disabled, and read-only writes", async () => {
    const t = createTestBackend();
    const userId = await seedEnabledUser(t);
    const args = {
      clientApiVersion: BBPC_API_VERSION,
      movieLinkPreference: "tmdb" as const,
    };
    const client = t.withIdentity(USER_IDENTITY);
    await expectDomainError(
      t.mutation(api.identity.profile.updateMyMovieLinkPreference, args),
      "AUTHENTICATION_REQUIRED",
    );
    await expectDomainError(
      client.mutation(api.identity.profile.updateMyMovieLinkPreference, {
        ...args,
        clientApiVersion: "stale",
      }),
      "STALE_CLIENT",
    );
    await t.run((ctx) => ctx.db.patch("users", userId, { status: "disabled" }));
    await expectDomainError(
      client.mutation(api.identity.profile.updateMyMovieLinkPreference, args),
      "ACCOUNT_DISABLED",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("users", userId, { status: "active" });
      const state = await ctx.db.query("systemState").unique();
      if (state === null) throw new Error("Missing system state");
      await ctx.db.patch("systemState", state._id, {
        applicationWriteMode: "disabled",
      });
    });
    await expectDomainError(
      client.mutation(api.identity.profile.updateMyMovieLinkPreference, args),
      "WRITE_DISABLED",
    );
    expect(await client.query(api.identity.profile.me, {})).toMatchObject({
      movieLinkPreference: "imdb",
    });
  });

  test("rejects unsupported preferences", async () => {
    const t = createTestBackend();
    await seedEnabledUser(t);
    await expect(
      t
        .withIdentity(USER_IDENTITY)
        .mutation(api.identity.profile.updateMyMovieLinkPreference, {
          clientApiVersion: BBPC_API_VERSION,
          // @ts-expect-error Exercise runtime validation for an untrusted client.
          movieLinkPreference: "other",
        }),
    ).rejects.toThrow();
  });
});
