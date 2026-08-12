/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "banger-api-test";
const ADMIN_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|banger-admin",
  issuer: "https://issuer.example.test",
  subject: "banger-admin",
};
const MEMBER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|banger-member",
  issuer: "https://issuer.example.test",
  subject: "banger-member",
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
  input: {
    identity: typeof ADMIN_IDENTITY;
    name: string;
    email: string;
    admin: boolean;
  },
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: input.name,
      email: input.email,
      normalizedEmail: input.email.toLowerCase(),
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
    if (input.admin) {
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

async function initializeS1(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "banger-api-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "banger-api-test",
  });
}

async function advanceToS3(t: TestBackend): Promise<void> {
  await initializeS1(t);
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S1",
    nextStage: "S2",
    actor: "banger-api-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S2",
    nextStage: "S3",
    actor: "banger-api-test",
    approvedBackupId: "banger-api-backup",
    approvedBackupChecksum: "sha256:banger-api",
  });
}

describe("administrator banger API", () => {
  test("requires administrator reads and the application write gate", async () => {
    const t = createTestBackend();
    await seedUser(t, {
      identity: ADMIN_IDENTITY,
      name: "Administrator",
      email: "admin@example.test",
      admin: true,
    });
    await seedUser(t, {
      identity: MEMBER_IDENTITY,
      name: "Member",
      email: "member@example.test",
      admin: false,
    });
    const bangerId = await t.run(
      async (ctx) =>
        await ctx.db.insert("bangers", {
          title: "Song",
          artist: "Artist",
          url: "https://example.test/song",
        }),
    );

    await expectDomainError(
      t.query(api.episodes.bangers.getAdminById, { id: bangerId }),
      "AUTHENTICATION_REQUIRED",
    );
    await expectDomainError(
      t
        .withIdentity(MEMBER_IDENTITY)
        .query(api.episodes.bangers.getAdminById, { id: bangerId }),
      "FORBIDDEN",
    );
    await initializeS1(t);
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.episodes.bangers.create,
        {
          clientApiVersion: BBPC_API_VERSION,
          title: "New song",
          artist: "New artist",
          url: "https://example.test/new",
          episodeId: null,
          userId: null,
        },
      ),
      "WRITE_DISABLED",
    );
  });

  test("paginates by title and supports relationship-safe CRUD", async () => {
    const t = createTestBackend();
    await seedUser(t, {
      identity: ADMIN_IDENTITY,
      name: "Administrator",
      email: "admin@example.test",
      admin: true,
    });
    const memberId = await seedUser(t, {
      identity: MEMBER_IDENTITY,
      name: "Member",
      email: "member@example.test",
      admin: false,
    });
    const episodeId = await t.run(
      async (ctx) =>
        await ctx.db.insert("episodes", {
          number: 42,
          title: "Episode Forty Two",
          status: "published",
        }),
    );
    await advanceToS3(t);

    const zulu = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.episodes.bangers.create,
      {
        clientApiVersion: BBPC_API_VERSION,
        title: " Zulu Song ",
        artist: " Zulu Artist ",
        url: " https://example.test/zulu ",
        episodeId,
        userId: memberId,
      },
    );
    expect(zulu).toMatchObject({
      title: "Zulu Song",
      artist: "Zulu Artist",
      episodeId,
      userId: memberId,
      episode: {
        id: episodeId,
        number: 42,
      },
      user: {
        id: memberId,
        status: "active",
      },
    });
    const alpha = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.episodes.bangers.create,
      {
        clientApiVersion: BBPC_API_VERSION,
        title: "Alpha Song",
        artist: "Alpha Artist",
        url: "https://example.test/alpha",
        episodeId: null,
        userId: null,
      },
    );

    const firstPage = await t.withIdentity(ADMIN_IDENTITY).query(
      api.episodes.bangers.listAdminPage,
      {
        paginationOpts: {
          cursor: null,
          numItems: 1,
        },
      },
    );
    expect(firstPage.page.map((banger) => banger.id)).toEqual([
      alpha.id,
    ]);
    expect(firstPage.isDone).toBe(false);
    const secondPage = await t.withIdentity(ADMIN_IDENTITY).query(
      api.episodes.bangers.listAdminPage,
      {
        paginationOpts: {
          cursor: firstPage.continueCursor,
          numItems: 1,
        },
      },
    );
    expect(secondPage.page.map((banger) => banger.id)).toEqual([
      zulu.id,
    ]);

    const updated = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.episodes.bangers.update,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: zulu.id,
        title: "Beta Song",
        artist: "Beta Artist",
        url: "https://example.test/beta",
        episodeId: null,
        userId: null,
      },
    );
    expect(updated).toMatchObject({
      title: "Beta Song",
      episodeId: null,
      userId: null,
      episode: null,
      user: null,
    });

    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.episodes.bangers.remove,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: zulu.id,
          expected: {
            title: "Stale title",
            artist: updated.artist,
            url: updated.url,
            episodeId: null,
            userId: null,
          },
        },
      ),
      "CONFLICT",
    );
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.episodes.bangers.remove,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: zulu.id,
          expected: {
            title: updated.title,
            artist: updated.artist,
            url: updated.url,
            episodeId: updated.episodeId,
            userId: updated.userId,
          },
        },
      ),
    ).resolves.toEqual({ id: zulu.id });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.episodes.bangers.getAdminById,
        { id: zulu.id },
      ),
    ).resolves.toBeNull();

    const audits = await t.run(async (ctx) => {
      return await ctx.db.query("auditEvents").collect();
    });
    expect(audits.map((audit) => audit.action)).toEqual(
      expect.arrayContaining([
        "episodes.admin.bangerCreated",
        "episodes.admin.bangerUpdated",
        "episodes.admin.bangerDeleted",
      ]),
    );
    expect(JSON.stringify(audits)).not.toContain("Zulu Song");
  });

  test("validates content, page bounds, and canonical relationships", async () => {
    const t = createTestBackend();
    await seedUser(t, {
      identity: ADMIN_IDENTITY,
      name: "Administrator",
      email: "admin@example.test",
      admin: true,
    });
    const missing = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const episodeId = await ctx.db.insert("episodes", {
        number: 1,
        title: "Transient",
      });
      await ctx.db.delete("users", userId);
      await ctx.db.delete("episodes", episodeId);
      return { userId, episodeId };
    });
    await advanceToS3(t);

    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.episodes.bangers.listAdminPage,
        {
          paginationOpts: {
            cursor: null,
            numItems: 51,
          },
        },
      ),
      "VALIDATION_FAILED",
    );
    for (const input of [
      {
        title: " ",
        artist: "Artist",
        url: "https://example.test/song",
        episodeId: null,
        userId: null,
      },
      {
        title: "Song",
        artist: "Artist",
        url: "ftp://example.test/song",
        episodeId: null,
        userId: null,
      },
      {
        title: "Song",
        artist: "Artist",
        url: "https://example.test/song",
        episodeId: missing.episodeId,
        userId: null,
      },
      {
        title: "Song",
        artist: "Artist",
        url: "https://example.test/song",
        episodeId: null,
        userId: missing.userId,
      },
    ]) {
      await expectDomainError(
        t.withIdentity(ADMIN_IDENTITY).mutation(
          api.episodes.bangers.create,
          {
            clientApiVersion: BBPC_API_VERSION,
            ...input,
          },
        ),
        input.episodeId !== null || input.userId !== null
          ? "NOT_FOUND"
          : "VALIDATION_FAILED",
      );
    }
  });

  test("fails closed when hydration finds orphaned relationships", async () => {
    const t = createTestBackend();
    await seedUser(t, {
      identity: ADMIN_IDENTITY,
      name: "Administrator",
      email: "admin@example.test",
      admin: true,
    });
    const bangerId = await t.run(async (ctx) => {
      const episodeId = await ctx.db.insert("episodes", {
        number: 1,
        title: "Transient",
      });
      const id = await ctx.db.insert("bangers", {
        title: "Orphaned song",
        artist: "Artist",
        url: "https://example.test/orphan",
        episodeId,
      });
      await ctx.db.delete("episodes", episodeId);
      return id;
    });

    await expectDomainError(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.episodes.bangers.getAdminById, { id: bangerId }),
      "CONFLICT",
    );
  });
});
