/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "episode-admin-test";
const ADMIN_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|episode-admin",
  issuer: "https://issuer.example.test",
  subject: "episode-admin",
};
const MEMBER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|episode-member",
  issuer: "https://issuer.example.test",
  subject: "episode-member",
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
    identity?: typeof ADMIN_IDENTITY;
    name: string;
    email: string;
    admin?: boolean;
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
    if (input.identity !== undefined) {
      await ctx.db.insert("authIdentities", {
        ...input.identity,
        userId,
        linkedAt: 1,
        lastSeenAt: 1,
      });
    }
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

async function seedAdmin(t: TestBackend): Promise<Id<"users">> {
  return await seedUser(t, {
    identity: ADMIN_IDENTITY,
    name: "Episode Admin",
    email: "episode-admin@example.test",
    admin: true,
  });
}

async function seedEpisode(
  t: TestBackend,
  input: {
    number: number;
    title: string;
    slug?: string;
    status?: string;
  },
): Promise<Id<"episodes">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("episodes", {
      number: input.number,
      title: input.title,
      ...(input.slug === undefined
        ? {}
        : {
            slug: input.slug,
            normalizedSlug: input.slug.toLowerCase(),
          }),
      ...(input.status === undefined
        ? {}
        : { status: input.status }),
    });
  });
}

async function initializeS1(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "episode-admin-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "episode-admin-test",
  });
}

async function advanceToS3(t: TestBackend): Promise<void> {
  await initializeS1(t);
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S1",
    nextStage: "S2",
    actor: "episode-admin-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S2",
    nextStage: "S3",
    actor: "episode-admin-test",
    approvedBackupId: "episode-admin-backup",
    approvedBackupChecksum: "sha256:episode-admin",
  });
}

async function seedGamblingEntry(
  t: TestBackend,
  input: {
    userId: Id<"users">;
    assignmentId: Id<"assignments">;
    gamblingTypeId: Id<"gamblingTypes">;
    status: string;
    sequence: number;
  },
): Promise<Id<"gamblingEntries">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("gamblingEntries", {
      userId: input.userId,
      assignmentId: input.assignmentId,
      points: 1,
      createdAt: input.sequence,
      gamblingTypeId: input.gamblingTypeId,
      status: input.status,
    });
  });
}

describe("administrator episode API", () => {
  test("requires administrator access and the application write gate", async () => {
    const t = createTestBackend();
    await seedAdmin(t);
    await seedUser(t, {
      identity: MEMBER_IDENTITY,
      name: "Member",
      email: "member@example.test",
    });
    const episodeId = await seedEpisode(t, {
      number: 1,
      title: "Episode One",
    });

    await expectDomainError(
      t.query(api.episodes.admin.getById, { id: episodeId }),
      "AUTHENTICATION_REQUIRED",
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.episodes.admin.getById,
        { id: episodeId },
      ),
      "FORBIDDEN",
    );
    await initializeS1(t);
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.episodes.admin.createEpisode,
        {
          clientApiVersion: BBPC_API_VERSION,
          number: 2,
          title: "Episode Two",
        },
      ),
      "WRITE_DISABLED",
    );
  });

  test("creates collision-safe slugs and supports exact administrator reads", async () => {
    const t = createTestBackend();
    await seedAdmin(t);
    await seedEpisode(t, {
      number: 42,
      title: "Same Title",
      slug: "episode-42-same-title",
    });
    const missingEpisodeId = await seedEpisode(t, {
      number: 999,
      title: "Transient",
    });
    await t.run(async (ctx) => {
      await ctx.db.delete("episodes", missingEpisodeId);
    });
    await advanceToS3(t);

    const created = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.episodes.admin.createEpisode,
      {
        clientApiVersion: BBPC_API_VERSION,
        number: 42,
        title: "  Same Title ",
      },
    );
    expect(created).toMatchObject({
      number: 42,
      title: "Same Title",
      status: "pending",
      slug: "episode-42-same-title-2",
      notes: null,
      seoTitle: null,
      assignments: [],
      extras: [],
      links: [],
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.episodes.admin.getById,
        { id: created.id },
      ),
    ).resolves.toMatchObject({
      id: created.id,
      slug: "episode-42-same-title-2",
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.episodes.admin.getByNumber,
        { number: 42 },
      ),
    ).resolves.not.toBeNull();
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.episodes.admin.getById,
        { id: missingEpisodeId },
      ),
    ).resolves.toBeNull();
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.episodes.admin.getByNumber,
        { number: 999 },
      ),
    ).resolves.toBeNull();
  });

  test("updates and clears metadata with explicit slug semantics", async () => {
    const t = createTestBackend();
    await seedAdmin(t);
    const episodeId = await seedEpisode(t, {
      number: 7,
      title: "Original",
      slug: "episode-7-original",
    });
    await advanceToS3(t);

    const updated = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.episodes.admin.updateEpisode,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: episodeId,
        number: 8,
        title: " Updated ",
        recording: " recording-key ",
        date: "2026-07-24",
        description: " Description ",
        status: "PUBLISHED",
        notes: " Notes ",
        seoDescription: " SEO description ",
        seoKeywords: " one,two ",
        seoTitle: " SEO title ",
        slug: " Custom Slug ",
      },
    );
    expect(updated).toMatchObject({
      number: 8,
      title: "Updated",
      recording: "recording-key",
      date: "2026-07-24",
      description: "Description",
      status: "published",
      notes: "Notes",
      seoDescription: "SEO description",
      seoKeywords: "one,two",
      seoTitle: "SEO title",
      slug: "custom-slug",
    });

    const cleared = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.episodes.admin.updateEpisode,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: episodeId,
        recording: null,
        date: null,
        description: null,
        notes: null,
        seoDescription: null,
        seoKeywords: null,
        seoTitle: null,
        slug: null,
      },
    );
    expect(cleared).toMatchObject({
      recording: null,
      date: null,
      description: null,
      notes: null,
      seoDescription: null,
      seoKeywords: null,
      seoTitle: null,
      slug: "episode-8-updated",
    });

    const unchanged = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.episodes.admin.updateEpisode,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: episodeId,
      },
    );
    expect(unchanged.id).toBe(episodeId);
  });

  test("locks pending gambling entries when recording or publishing", async () => {
    const t = createTestBackend();
    const adminId = await seedAdmin(t);
    const episodeId = await seedEpisode(t, {
      number: 9,
      title: "Locking",
    });
    const setup = await t.run(async (ctx) => {
      const movieId = await ctx.db.insert("movies", {
        title: "Locking Movie",
        normalizedTitle: "locking movie",
        year: 2026,
        url: "https://movies.example/locking",
      });
      const assignmentId = await ctx.db.insert("assignments", {
        userId: adminId,
        episodeId,
        movieId,
        type: "HOMEWORK",
        playable: true,
      });
      const gamblingTypeId = await ctx.db.insert(
        "gamblingTypes",
        {
          lookupId: "standard",
          normalizedLookupId: "standard",
          title: "Standard",
          multiplier: 1,
          isActive: true,
          createdAt: 1,
        },
      );
      return { assignmentId, gamblingTypeId };
    });
    const pendingId = await seedGamblingEntry(t, {
      userId: adminId,
      ...setup,
      status: "pending",
      sequence: 1,
    });
    const lockedId = await seedGamblingEntry(t, {
      userId: adminId,
      ...setup,
      status: "locked",
      sequence: 2,
    });
    await advanceToS3(t);

    await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.episodes.admin.updateEpisode,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: episodeId,
        status: "recording",
      },
    );
    const snapshot = await t.run(async (ctx) => {
      const pending = await ctx.db.get(
        "gamblingEntries",
        pendingId,
      );
      const locked = await ctx.db.get(
        "gamblingEntries",
        lockedId,
      );
      const audits = await ctx.db
        .query("auditEvents")
        .withIndex("by_createdAt")
        .take(20);
      return { pending, locked, audits };
    });
    expect(snapshot.pending?.status).toBe("locked");
    expect(snapshot.locked?.status).toBe("locked");
    const updateAudit = snapshot.audits.find(
      (audit) => audit.action === "episodes.admin.updated",
    );
    expect(updateAudit?.metadata).toMatchObject({
      lockedGamblingEntries: 1,
    });
  });

  test("validates episode inputs and missing targets", async () => {
    const t = createTestBackend();
    await seedAdmin(t);
    const episodeId = await seedEpisode(t, {
      number: 10,
      title: "Validation",
    });
    const missingId = await seedEpisode(t, {
      number: 11,
      title: "Missing",
    });
    await t.run(async (ctx) => {
      await ctx.db.delete("episodes", missingId);
    });
    await advanceToS3(t);

    for (const number of [1.5, -32_769, 32_768]) {
      await expectDomainError(
        t.withIdentity(ADMIN_IDENTITY).mutation(
          api.episodes.admin.createEpisode,
          {
            clientApiVersion: BBPC_API_VERSION,
            number,
            title: "Invalid",
          },
        ),
        "VALIDATION_FAILED",
      );
    }
    for (const update of [
      { title: " " },
      { title: "x".repeat(1001) },
      { date: "07/24/2026" },
      { date: "2026-02-30" },
      { status: "archived" },
      { slug: "---" },
      { description: "x".repeat(10_001) },
      { seoTitle: "x".repeat(1001) },
    ]) {
      await expectDomainError(
        t.withIdentity(ADMIN_IDENTITY).mutation(
          api.episodes.admin.updateEpisode,
          {
            clientApiVersion: BBPC_API_VERSION,
            id: episodeId,
            ...update,
          },
        ),
        "VALIDATION_FAILED",
      );
    }
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.episodes.admin.updateEpisode,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: missingId,
          title: "Missing",
        },
      ),
      "NOT_FOUND",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.episodes.admin.getByNumber,
        { number: 1.5 },
      ),
      "VALIDATION_FAILED",
    );
  });

  test("fails closed when slug attempts or status relationships exceed limits", async () => {
    const slugOverflow = createTestBackend();
    await seedAdmin(slugOverflow);
    await slugOverflow.run(async (ctx) => {
      for (let suffix = 1; suffix <= 100; suffix += 1) {
        const slug =
          suffix === 1
            ? "episode-12-collision"
            : `episode-12-collision-${String(suffix)}`;
        await ctx.db.insert("episodes", {
          number: suffix,
          title: `Collision ${String(suffix)}`,
          slug,
          normalizedSlug: slug,
        });
      }
    });
    await advanceToS3(slugOverflow);
    await expectDomainError(
      slugOverflow.withIdentity(ADMIN_IDENTITY).mutation(
        api.episodes.admin.createEpisode,
        {
          clientApiVersion: BBPC_API_VERSION,
          number: 12,
          title: "Collision",
        },
      ),
      "CONFLICT",
    );

    const assignmentOverflow = createTestBackend();
    const assignmentAdminId = await seedAdmin(assignmentOverflow);
    const assignmentEpisodeId = await seedEpisode(
      assignmentOverflow,
      { number: 13, title: "Assignment Overflow" },
    );
    await assignmentOverflow.run(async (ctx) => {
      const movieId = await ctx.db.insert("movies", {
        title: "Overflow",
        normalizedTitle: "overflow",
        year: 2026,
        url: "https://movies.example/overflow",
      });
      for (let index = 0; index < 51; index += 1) {
        await ctx.db.insert("assignments", {
          userId: assignmentAdminId,
          episodeId: assignmentEpisodeId,
          movieId,
          type: "HOMEWORK",
          playable: true,
        });
      }
    });
    await advanceToS3(assignmentOverflow);
    await expectDomainError(
      assignmentOverflow.withIdentity(ADMIN_IDENTITY).mutation(
        api.episodes.admin.updateEpisode,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: assignmentEpisodeId,
          status: "published",
        },
      ),
      "CONFLICT",
    );

    const gamblingOverflow = createTestBackend();
    const gamblingAdminId = await seedAdmin(gamblingOverflow);
    const gamblingEpisodeId = await seedEpisode(
      gamblingOverflow,
      { number: 14, title: "Gambling Overflow" },
    );
    const setup = await gamblingOverflow.run(async (ctx) => {
      const movieId = await ctx.db.insert("movies", {
        title: "Gambling Overflow",
        normalizedTitle: "gambling overflow",
        year: 2026,
        url: "https://movies.example/gambling-overflow",
      });
      const assignmentId = await ctx.db.insert("assignments", {
        userId: gamblingAdminId,
        episodeId: gamblingEpisodeId,
        movieId,
        type: "HOMEWORK",
        playable: true,
      });
      const gamblingTypeId = await ctx.db.insert(
        "gamblingTypes",
        {
          lookupId: "overflow",
          normalizedLookupId: "overflow",
          title: "Overflow",
          multiplier: 1,
          isActive: true,
          createdAt: 1,
        },
      );
      return { assignmentId, gamblingTypeId };
    });
    for (let index = 0; index < 201; index += 1) {
      await seedGamblingEntry(gamblingOverflow, {
        userId: gamblingAdminId,
        ...setup,
        status: "locked",
        sequence: index,
      });
    }
    await advanceToS3(gamblingOverflow);
    await expectDomainError(
      gamblingOverflow.withIdentity(ADMIN_IDENTITY).mutation(
        api.episodes.admin.updateEpisode,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: gamblingEpisodeId,
          status: "recording",
        },
      ),
      "CONFLICT",
    );
  });

  test("adds and removes validated episode links with audit evidence", async () => {
    const t = createTestBackend();
    await seedAdmin(t);
    const episodeId = await seedEpisode(t, {
      number: 15,
      title: "Links",
    });
    const missingEpisodeId = await seedEpisode(t, {
      number: 16,
      title: "Missing",
    });
    const { missingLinkId, orphanLinkId } = await t.run(async (ctx) => {
      await ctx.db.delete("episodes", missingEpisodeId);
      const missingId = await ctx.db.insert("episodeLinks", {
        url: "https://example.test/missing",
        text: "Missing",
      });
      await ctx.db.delete("episodeLinks", missingId);
      const orphanId = await ctx.db.insert("episodeLinks", {
        url: "https://example.test/orphan",
        text: "Orphan",
      });
      return {
        missingLinkId: missingId,
        orphanLinkId: orphanId,
      };
    });
    await advanceToS3(t);

    const link = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.episodes.admin.addLink,
      {
        clientApiVersion: BBPC_API_VERSION,
        episodeId,
        url: " https://example.test/episode ",
        text: " Episode Link ",
      },
    );
    expect(link).toMatchObject({
      url: "https://example.test/episode",
      text: "Episode Link",
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.episodes.admin.removeLink,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: link.id,
        },
      ),
    ).resolves.toEqual({ id: link.id });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.episodes.admin.removeLink,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: orphanLinkId,
        },
      ),
    ).resolves.toEqual({ id: orphanLinkId });

    for (const input of [
      { url: `https://${"x".repeat(2048)}`, text: "Long" },
      { url: "ftp://example.test/file", text: "FTP" },
      { url: "not a URL", text: "Invalid" },
      { url: "https://example.test", text: " " },
      {
        url: "https://example.test",
        text: "x".repeat(501),
      },
    ]) {
      await expectDomainError(
        t.withIdentity(ADMIN_IDENTITY).mutation(
          api.episodes.admin.addLink,
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
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.episodes.admin.addLink,
        {
          clientApiVersion: BBPC_API_VERSION,
          episodeId: missingEpisodeId,
          url: "https://example.test",
          text: "Missing",
        },
      ),
      "NOT_FOUND",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.episodes.admin.removeLink,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: missingLinkId,
        },
      ),
      "NOT_FOUND",
    );
  });

  test("enforces the episode link limit", async () => {
    const t = createTestBackend();
    await seedAdmin(t);
    const episodeId = await seedEpisode(t, {
      number: 17,
      title: "Link Limit",
    });
    await t.run(async (ctx) => {
      for (let index = 0; index < 50; index += 1) {
        await ctx.db.insert("episodeLinks", {
          episodeId,
          url: `https://example.test/${String(index)}`,
          text: `Link ${String(index)}`,
        });
      }
    });
    await advanceToS3(t);

    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.episodes.admin.addLink,
        {
          clientApiVersion: BBPC_API_VERSION,
          episodeId,
          url: "https://example.test/overflow",
          text: "Overflow",
        },
      ),
      "CONFLICT",
    );
  });

  test("adds and paginates administrator audio metadata", async () => {
    const t = createTestBackend();
    const adminId = await seedAdmin(t);
    const episodeId = await seedEpisode(t, {
      number: 18,
      title: "Audio",
    });
    await advanceToS3(t);

    const first = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.episodes.admin.addAudioMessage,
      {
        clientApiVersion: BBPC_API_VERSION,
        episodeId,
        url: "https://audio.example/one.webm",
        fileKey: " audio/one.webm ",
        notes: " First ",
      },
    );
    const second = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.episodes.admin.addAudioMessage,
      {
        clientApiVersion: BBPC_API_VERSION,
        episodeId,
        url: "https://audio.example/two.webm",
      },
    );
    expect(first).toMatchObject({
      fileKey: "audio/one.webm",
      notes: "First",
      user: {
        id: adminId,
        email: "episode-admin@example.test",
      },
    });
    expect(second).toMatchObject({
      fileKey: null,
      notes: null,
    });

    const page = await t.withIdentity(ADMIN_IDENTITY).query(
      api.episodes.admin.listAudioMessages,
      {
        episodeId,
        paginationOpts: { cursor: null, numItems: 10 },
      },
    );
    expect(page.page).toHaveLength(2);
    expect(page.page.map((message) => message.id)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    );
    expect(page.page.every((message) => message.user.id === adminId))
      .toBe(true);
  });

  test("validates audio metadata, parents, limits, and hydration", async () => {
    const t = createTestBackend();
    const adminId = await seedAdmin(t);
    const episodeId = await seedEpisode(t, {
      number: 19,
      title: "Audio Validation",
    });
    const missingEpisodeId = await seedEpisode(t, {
      number: 20,
      title: "Missing",
    });
    const missingUserId = await seedUser(t, {
      name: "Missing User",
      email: "missing-user@example.test",
    });
    await t.run(async (ctx) => {
      await ctx.db.delete("episodes", missingEpisodeId);
      await ctx.db.insert("episodeAudioMessages", {
        episodeId,
        userId: missingUserId,
        url: "https://audio.example/missing.webm",
        createdAt: 0,
      });
      await ctx.db.delete("users", missingUserId);
    });
    await advanceToS3(t);

    for (const input of [
      { url: "not a URL", fileKey: undefined, notes: undefined },
      {
        url: "https://audio.example/file.webm",
        fileKey: " ",
        notes: undefined,
      },
      {
        url: "https://audio.example/file.webm",
        fileKey: "x".repeat(1025),
        notes: undefined,
      },
      {
        url: "https://audio.example/file.webm",
        fileKey: undefined,
        notes: "x".repeat(5001),
      },
    ]) {
      await expectDomainError(
        t.withIdentity(ADMIN_IDENTITY).mutation(
          api.episodes.admin.addAudioMessage,
          {
            clientApiVersion: BBPC_API_VERSION,
            episodeId,
            url: input.url,
            ...(input.fileKey === undefined
              ? {}
              : { fileKey: input.fileKey }),
            ...(input.notes === undefined
              ? {}
              : { notes: input.notes }),
          },
        ),
        "VALIDATION_FAILED",
      );
    }
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.episodes.admin.addAudioMessage,
        {
          clientApiVersion: BBPC_API_VERSION,
          episodeId: missingEpisodeId,
          url: "https://audio.example/file.webm",
        },
      ),
      "NOT_FOUND",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.episodes.admin.listAudioMessages,
        {
          episodeId: missingEpisodeId,
          paginationOpts: { cursor: null, numItems: 10 },
        },
      ),
      "NOT_FOUND",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.episodes.admin.listAudioMessages,
        {
          episodeId,
          paginationOpts: { cursor: null, numItems: 10 },
        },
      ),
      "CONFLICT",
    );

    await t.run(async (ctx) => {
      const broken = await ctx.db
        .query("episodeAudioMessages")
        .withIndex("by_episodeId", (index) =>
          index.eq("episodeId", episodeId),
        )
        .first();
      if (broken !== null) {
        await ctx.db.delete("episodeAudioMessages", broken._id);
      }
      for (let index = 0; index < 50; index += 1) {
        await ctx.db.insert("episodeAudioMessages", {
          episodeId,
          userId: adminId,
          url: `https://audio.example/${String(index)}.webm`,
          createdAt: index,
        });
      }
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.episodes.admin.addAudioMessage,
        {
          clientApiVersion: BBPC_API_VERSION,
          episodeId,
          url: "https://audio.example/overflow.webm",
        },
      ),
      "CONFLICT",
    );
  });
});
