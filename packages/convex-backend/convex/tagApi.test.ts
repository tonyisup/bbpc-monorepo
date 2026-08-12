/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "tag-api-test";
const ADMIN_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|tag-admin",
  issuer: "https://issuer.example.test",
  subject: "tag-admin",
};
const MEMBER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|tag-member",
  issuer: "https://issuer.example.test",
  subject: "tag-member",
};

function createTestBackend() {
  return convexTest(schema, modules);
}

type TestBackend = ReturnType<typeof createTestBackend>;
type TestIdentity = typeof ADMIN_IDENTITY;

async function expectDomainError(
  promise: Promise<unknown>,
  expectedCode: string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ConvexError);
    if (!(error instanceof ConvexError)) {
      throw error;
    }
    expect(error.data).toMatchObject({
      code: expectedCode,
      ...(details === undefined ? {} : { details }),
    });
    return;
  }
  throw new Error(`Expected domain error ${expectedCode}`);
}

async function seedUser(
  t: TestBackend,
  input: {
    identity: TestIdentity;
    name: string;
    admin?: boolean;
  },
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const normalizedEmail = `${input.identity.subject}@example.test`;
    const userId = await ctx.db.insert("users", {
      name: input.name,
      email: normalizedEmail,
      normalizedEmail,
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("authIdentities", {
      ...input.identity,
      userId,
      linkedAt: 1,
      lastSeenAt: 1,
    });
    if (input.admin === true) {
      const roleId = await ctx.db.insert("roles", {
        name: "Administrator",
        normalizedName: "administrator",
        description: "Administrator role",
        admin: true,
        permissions: ["admin"],
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userRoles", {
        userId,
        roleId,
        assignedAt: 1,
      });
    }
    return userId;
  });
}

async function seedActors(t: TestBackend) {
  const adminId = await seedUser(t, {
    identity: ADMIN_IDENTITY,
    name: "Tag Admin",
    admin: true,
  });
  const memberId = await seedUser(t, {
    identity: MEMBER_IDENTITY,
    name: "Tag Member",
  });
  return { adminId, memberId };
}

async function initializeS1(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "tag-api-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "tag-api-test",
  });
}

async function advanceToS3(t: TestBackend): Promise<void> {
  await initializeS1(t);
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S1",
    nextStage: "S2",
    actor: "tag-api-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S2",
    nextStage: "S3",
    actor: "tag-api-test",
    approvedBackupId: "tag-api-backup",
    approvedBackupChecksum: "sha256:tag-api",
  });
}

async function seedPointFoundation(t: TestBackend) {
  return await t.run(async (ctx) => {
    const gameTypeId = await ctx.db.insert("gameTypes", {
      title: "Tag voting",
      lookupId: "tags",
      normalizedLookupId: "tags",
    });
    const pointTypeId = await ctx.db.insert("gamePointTypes", {
      title: "Tag vote",
      lookupId: "tag-vote",
      normalizedLookupId: "tag-vote",
      points: 1,
      gameTypeId,
    });
    const seasonId = await ctx.db.insert("seasons", {
      title: "Current season",
      gameTypeId,
      startedOn: "2026-01-01",
      endedOn: "2026-12-31",
    });
    return { gameTypeId, pointTypeId, seasonId };
  });
}

describe("administrator tag workflows", () => {
  test("gates, validates, and audits tag catalog CRUD", async () => {
    const t = createTestBackend();
    await seedActors(t);
    await initializeS1(t);

    await expectDomainError(
      t.query(api.games.tags.listCatalog, {}),
      "AUTHENTICATION_REQUIRED",
    );
    await expectDomainError(
      t
        .withIdentity(MEMBER_IDENTITY)
        .query(api.games.tags.listCatalog, {}),
      "FORBIDDEN",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.tags.createCatalogTag,
        {
          clientApiVersion: BBPC_API_VERSION,
          name: "Comedy",
        },
      ),
      "WRITE_DISABLED",
    );

    await t.mutation(internal.system.cutover.transition, {
      cutoverRunId: CUTOVER_RUN_ID,
      expectedStage: "S1",
      nextStage: "S2",
      actor: "tag-api-test",
    });
    await t.mutation(internal.system.cutover.transition, {
      cutoverRunId: CUTOVER_RUN_ID,
      expectedStage: "S2",
      nextStage: "S3",
      actor: "tag-api-test",
      approvedBackupId: "tag-api-backup",
      approvedBackupChecksum: "sha256:tag-api",
    });

    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.tags.createCatalogTag,
        {
          clientApiVersion: "old-version",
          name: "Comedy",
        },
      ),
      "STALE_CLIENT",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.tags.createCatalogTag,
        {
          clientApiVersion: BBPC_API_VERSION,
          name: " ",
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.tags.createCatalogTag,
        {
          clientApiVersion: BBPC_API_VERSION,
          name: "Comedy",
          description: "x".repeat(1001),
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.tags.createCatalogTag,
        {
          clientApiVersion: BBPC_API_VERSION,
          name: "Comedy",
          createdAt: 1.5,
        },
      ),
      "VALIDATION_FAILED",
    );

    const comedy = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.tags.createCatalogTag,
      {
        clientApiVersion: BBPC_API_VERSION,
        name: " Comedy ",
        description: " Funny movies ",
        createdAt: 10,
      },
    );
    const action = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.tags.createCatalogTag,
      {
        clientApiVersion: BBPC_API_VERSION,
        name: "Action",
        createdAt: 20,
      },
    );
    expect(comedy).toMatchObject({
      name: "Comedy",
      description: "Funny movies",
      createdAt: 10,
    });
    await expect(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.games.tags.listCatalog, {}),
    ).resolves.toMatchObject([
      { id: action.id, name: "Action" },
      { id: comedy.id, name: "Comedy" },
    ]);
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.tags.createCatalogTag,
        {
          clientApiVersion: BBPC_API_VERSION,
          name: "ＣＯＭＥＤＹ",
        },
      ),
      "CONFLICT",
    );

    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.tags.updateCatalogTag,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: comedy.id,
        },
      ),
    ).resolves.toEqual(comedy);
    const updated = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.tags.updateCatalogTag,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: comedy.id,
        name: "Dry comedy",
        description: null,
      },
    );
    expect(updated).toMatchObject({
      name: "Dry comedy",
      description: null,
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.tags.updateCatalogTag,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: comedy.id,
          name: "Action",
        },
      ),
      "CONFLICT",
    );
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.tags.deleteCatalogTag,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: action.id,
        },
      ),
    ).resolves.toEqual({ id: action.id });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.tags.deleteCatalogTag,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: action.id,
        },
      ),
      "NOT_FOUND",
    );

    const audits = await t.run(async (ctx) => {
      return await ctx.db
        .query("auditEvents")
        .withIndex("by_cutoverRunId_and_createdAt", (index) =>
          index.eq("cutoverRunId", CUTOVER_RUN_ID),
        )
        .collect();
    });
    expect(
      audits.map((event) => event.action),
    ).toEqual(
      expect.arrayContaining([
        "games.admin.tagCreated",
        "games.admin.tagUpdated",
        "games.admin.tagDeleted",
      ]),
    );
    expect(JSON.stringify(audits)).not.toContain("Funny movies");
  });

  test("bounds the tag catalog", async () => {
    const t = createTestBackend();
    await seedActors(t);
    await advanceToS3(t);
    await t.run(async (ctx) => {
      for (let index = 0; index < 100; index += 1) {
        await ctx.db.insert("tags", {
          name: `Tag ${String(index).padStart(3, "0")}`,
          normalizedName: `tag ${String(index).padStart(3, "0")}`,
          createdAt: index,
        });
      }
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.tags.createCatalogTag,
        {
          clientApiVersion: BBPC_API_VERSION,
          name: "Overflow",
        },
      ),
      "CONFLICT",
      { limit: 100 },
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("tags", {
        name: "Overflow fixture",
        normalizedName: "overflow fixture",
        createdAt: 101,
      });
    });
    await expectDomainError(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.games.tags.listCatalog, {}),
      "CONFLICT",
      { limit: 100 },
    );
  });

  test("paginates votes without exposing archived award IDs", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    await advanceToS3(t);
    const { pointTypeId, seasonId } = await seedPointFoundation(t);
    const ids = await t.run(async (ctx) => {
      const pointId = await ctx.db.insert("points", {
        userId: memberId,
        seasonId,
        gamePointTypeId: pointTypeId,
        reason: "Existing award",
        earnedAt: 10,
        adjustment: 0,
      });
      const liveId = await ctx.db.insert("tagVotes", {
        tag: "Comedy",
        normalizedTag: "comedy",
        tmdbId: 100,
        isTag: true,
        createdAt: 30,
        userId: memberId,
        award: { kind: "point", pointId },
      });
      const archivedId = await ctx.db.insert("tagVotes", {
        tag: "Comedy",
        normalizedTag: "comedy",
        tmdbId: 200,
        isTag: false,
        createdAt: 20,
        userId: memberId,
        award: {
          kind: "legacyAwardTombstone",
          legacyPointId:
            "00000000-0000-0000-0000-000000000001",
        },
      });
      const anonymousId = await ctx.db.insert("tagVotes", {
        tag: "Comedy",
        normalizedTag: "comedy",
        tmdbId: 100,
        createdAt: 10,
        award: { kind: "unawarded" },
      });
      const missingId = await ctx.db.insert("tagVotes", {
        tag: "Deleted",
        normalizedTag: "deleted",
        tmdbId: 999,
        createdAt: 1,
        award: { kind: "unawarded" },
      });
      await ctx.db.delete("tagVotes", missingId);
      return { liveId, archivedId, anonymousId, missingId };
    });

    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.tags.getVoteById,
        { id: ids.liveId },
      ),
    ).resolves.toMatchObject({
      id: ids.liveId,
      award: { kind: "point", point: { total: 1 } },
    });
    const archived = await t.withIdentity(ADMIN_IDENTITY).query(
      api.games.tags.getVoteById,
      { id: ids.archivedId },
    );
    expect(archived).toMatchObject({
      award: { kind: "legacyAwardTombstone" },
    });
    expect(JSON.stringify(archived)).not.toContain(
      "00000000-0000-0000-0000-000000000001",
    );
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.tags.getVoteById,
        {
          id: ids.missingId,
        },
      ),
    ).resolves.toBeNull();

    const firstPage = await t.withIdentity(ADMIN_IDENTITY).query(
      api.games.tags.listVotesPage,
      {
        paginationOpts: { numItems: 2, cursor: null },
      },
    );
    expect(firstPage.page.map((vote) => vote.id)).toEqual([
      ids.liveId,
      ids.archivedId,
    ]);
    expect(firstPage.isDone).toBe(false);
    const secondPage = await t.withIdentity(ADMIN_IDENTITY).query(
      api.games.tags.listVotesPage,
      {
        paginationOpts: {
          numItems: 2,
          cursor: firstPage.continueCursor,
        },
      },
    );
    expect(secondPage.page).toMatchObject([
      {
        id: ids.anonymousId,
        user: null,
        isTag: null,
        award: { kind: "unawarded" },
      },
    ]);

    const moviePage = await t.withIdentity(ADMIN_IDENTITY).query(
      api.games.tags.listVotesPage,
      {
        tmdbId: 100,
        paginationOpts: { numItems: 10, cursor: null },
      },
    );
    expect(moviePage.page.map((vote) => vote.id)).toEqual([
      ids.liveId,
      ids.anonymousId,
    ]);
    const userPage = await t.withIdentity(ADMIN_IDENTITY).query(
      api.games.tags.listVotesForUserPage,
      {
        userId: memberId,
        paginationOpts: { numItems: 10, cursor: null },
      },
    );
    expect(userPage.page.map((vote) => vote.id)).toEqual([
      ids.liveId,
      ids.archivedId,
    ]);
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.tags.listVotesPage,
        {
          tmdbId: 0,
          paginationOpts: { numItems: 10, cursor: null },
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.tags.listVotesPage,
        {
          paginationOpts: { numItems: 101, cursor: null },
        },
      ),
      "VALIDATION_FAILED",
    );
  });

  test("awards only truly unawarded votes and preserves accounting on deletion", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    await advanceToS3(t);
    const { pointTypeId, seasonId } = await seedPointFoundation(t);
    const ids = await t.run(async (ctx) => {
      const unawardedId = await ctx.db.insert("tagVotes", {
        tag: "x".repeat(1000),
        normalizedTag: "x".repeat(1000),
        tmdbId: 300,
        isTag: true,
        createdAt: 10,
        userId: memberId,
        award: { kind: "unawarded" },
      });
      const archivedId = await ctx.db.insert("tagVotes", {
        tag: "Comedy",
        normalizedTag: "comedy",
        tmdbId: 301,
        isTag: false,
        createdAt: 20,
        userId: memberId,
        award: { kind: "legacyAwardTombstone" },
      });
      const userlessId = await ctx.db.insert("tagVotes", {
        tag: "Comedy",
        normalizedTag: "comedy",
        tmdbId: 302,
        isTag: true,
        createdAt: 30,
        award: { kind: "unawarded" },
      });
      return { unawardedId, archivedId, userlessId };
    });

    const awarded = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.tags.applyVotePoints,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: ids.unawardedId,
        today: "2026-07-24",
        earnedAt: 123,
      },
    );
    expect(awarded).toMatchObject({
      id: ids.unawardedId,
      award: {
        kind: "point",
        point: {
          user: { id: memberId },
          season: { id: seasonId },
          adjustment: 0,
          gamePointType: { id: pointTypeId },
          earnedAt: 123,
          total: 1,
        },
      },
    });
    if (awarded.award.kind !== "point") {
      throw new Error("Expected live point award");
    }
    expect(awarded.award.point.reason?.length).toBeLessThanOrEqual(
      1000,
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.tags.applyVotePoints,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: ids.unawardedId,
          today: "2026-07-24",
        },
      ),
      "CONFLICT",
      { awardKind: "point" },
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.tags.applyVotePoints,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: ids.archivedId,
          today: "2026-07-24",
        },
      ),
      "CONFLICT",
      { awardKind: "legacyAwardTombstone" },
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.tags.applyVotePoints,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: ids.userlessId,
          today: "2026-07-24",
        },
      ),
      "CONFLICT",
    );

    const pointId = awarded.award.point.id;
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.tags.deleteVote,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: ids.unawardedId,
        },
      ),
    ).resolves.toEqual({ id: ids.unawardedId });
    const retainedPoint = await t.run(
      async (ctx) => await ctx.db.get("points", pointId),
    );
    expect(retainedPoint).not.toBeNull();

    const audits = await t.run(async (ctx) => {
      return await ctx.db
        .query("auditEvents")
        .withIndex("by_cutoverRunId_and_createdAt", (index) =>
          index.eq("cutoverRunId", CUTOVER_RUN_ID),
        )
        .collect();
    });
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "games.admin.tagVoteAwarded",
          targetId: ids.unawardedId,
        }),
        expect.objectContaining({
          action: "games.admin.tagVoteDeleted",
          targetId: ids.unawardedId,
        }),
      ]),
    );
    expect(JSON.stringify(audits)).not.toContain("x".repeat(50));
  });
});
