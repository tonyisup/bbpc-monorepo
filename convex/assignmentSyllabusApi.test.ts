/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "assignment-syllabus-test";
const ADMIN_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|assignment-admin",
  issuer: "https://issuer.example.test",
  subject: "assignment-admin",
};
const MEMBER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|syllabus-member",
  issuer: "https://issuer.example.test",
  subject: "syllabus-member",
};
const OTHER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|syllabus-other",
  issuer: "https://issuer.example.test",
  subject: "syllabus-other",
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
    const userId = await ctx.db.insert("users", {
      name: input.name,
      email: `${input.identity.subject}@example.test`,
      normalizedEmail: `${input.identity.subject}@example.test`,
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
    name: "Assignment Admin",
    admin: true,
  });
  const memberId = await seedUser(t, {
    identity: MEMBER_IDENTITY,
    name: "Syllabus Member",
  });
  const otherId = await seedUser(t, {
    identity: OTHER_IDENTITY,
    name: "Other Member",
  });
  return { adminId, memberId, otherId };
}

async function seedMovie(
  t: TestBackend,
  suffix: string,
): Promise<Id<"movies">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("movies", {
      title: `Movie ${suffix}`,
      normalizedTitle: `movie ${suffix}`.toLowerCase(),
      year: 2000,
      poster: `https://images.example.test/${suffix}.jpg`,
      url: `https://catalog.example.test/${suffix}`,
    });
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
      status: "pending",
      slug: `episode-${String(number)}`,
      normalizedSlug: `episode-${String(number)}`,
    });
  });
}

async function seedAssignment(
  t: TestBackend,
  input: {
    userId: Id<"users">;
    movieId: Id<"movies">;
    episodeId: Id<"episodes">;
    type?: string;
    slug?: string;
  },
): Promise<Id<"assignments">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("assignments", {
      userId: input.userId,
      movieId: input.movieId,
      episodeId: input.episodeId,
      type: input.type ?? "HOMEWORK",
      playable: false,
      ...(input.slug === undefined
        ? {}
        : {
            slug: input.slug,
            normalizedSlug: input.slug.toLowerCase(),
          }),
    });
  });
}

async function seedSyllabusEntry(
  t: TestBackend,
  input: {
    userId: Id<"users">;
    movieId: Id<"movies">;
    order: number;
    assignmentId?: Id<"assignments">;
    createdAt?: number;
  },
): Promise<Id<"syllabusEntries">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("syllabusEntries", {
      userId: input.userId,
      movieId: input.movieId,
      order: input.order,
      createdAt: input.createdAt ?? input.order,
      ...(input.assignmentId === undefined
        ? {}
        : { assignmentId: input.assignmentId }),
    });
  });
}

async function initializeS1(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "assignment-syllabus-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "assignment-syllabus-test",
  });
}

async function advanceToS3(t: TestBackend): Promise<void> {
  await initializeS1(t);
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S1",
    nextStage: "S2",
    actor: "assignment-syllabus-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S2",
    nextStage: "S3",
    actor: "assignment-syllabus-test",
    approvedBackupId: "assignment-syllabus-backup",
    approvedBackupChecksum: "sha256:assignment-syllabus",
  });
}

describe("assignment and syllabus API", () => {
  test("classifies administrator and owner access and enforces the write gate", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    const movieId = await seedMovie(t, "access");
    const episodeId = await seedEpisode(t, 1);
    const assignmentId = await seedAssignment(t, {
      userId: memberId,
      movieId,
      episodeId,
    });

    await expectDomainError(
      t.query(api.assignments.admin.getById, { id: assignmentId }),
      "AUTHENTICATION_REQUIRED",
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.assignments.admin.getById,
        { id: assignmentId },
      ),
      "FORBIDDEN",
    );
    await expectDomainError(
      t.query(api.syllabus.mine.list, {}),
      "AUTHENTICATION_REQUIRED",
    );
    await initializeS1(t);
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.syllabus.mine.add,
        {
          clientApiVersion: BBPC_API_VERSION,
          movieId,
        },
      ),
      "WRITE_DISABLED",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.assignments.admin.create,
        {
          clientApiVersion: BBPC_API_VERSION,
          userId: memberId,
          movieId,
          episodeId,
          type: "HOMEWORK",
        },
      ),
      "WRITE_DISABLED",
    );
  });

  test("creates collision-safe assignments and supports explicit slug and type semantics", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    const movieId = await seedMovie(t, "alpha");
    const episodeId = await seedEpisode(t, 12);
    await advanceToS3(t);

    const createArgs = {
      clientApiVersion: BBPC_API_VERSION,
      userId: memberId,
      movieId,
      episodeId,
      type: "homework",
    };
    const first = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.assignments.admin.create,
      createArgs,
    );
    const second = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.assignments.admin.create,
      createArgs,
    );
    expect(first).toMatchObject({
      type: "HOMEWORK",
      playable: false,
      slug: "episode-12-syllabus-member-homework-movie-alpha",
    });
    expect(second.slug).toBe(
      "episode-12-syllabus-member-homework-movie-alpha-2",
    );

    const manual = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.assignments.admin.updateSlug,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: first.id,
        slug: "  Déjà Vu  ",
      },
    );
    expect(manual.slug).toBe("deja-vu");
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.assignments.admin.updateSlug,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: second.id,
          slug: "deja vu",
        },
      ),
      "CONFLICT",
    );
    const regenerated = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.assignments.admin.updateSlug,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: first.id,
        slug: "",
      },
    );
    expect(regenerated.slug).toBe(
      "episode-12-syllabus-member-homework-movie-alpha",
    );
    const updatedType = await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(api.assignments.admin.setType, {
        clientApiVersion: BBPC_API_VERSION,
        id: first.id,
        type: "bonus",
      });
    expect(updatedType.type).toBe("BONUS");
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.assignments.admin.setType,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: first.id,
          type: "BONUS",
        },
      ),
    ).resolves.toMatchObject({ type: "BONUS" });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.assignments.admin.updateSlug,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: first.id,
        },
      ),
    ).resolves.toMatchObject({ slug: regenerated.slug });

    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.assignments.admin.getById,
        { id: first.id },
      ),
    ).resolves.toMatchObject({
      id: first.id,
      movie: { id: movieId },
      episode: { id: episodeId },
      user: { id: memberId },
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.assignments.admin.listForEpisode,
        { episodeId },
      ),
    ).resolves.toHaveLength(2);
    const page = await t.withIdentity(ADMIN_IDENTITY).query(
      api.assignments.admin.listPage,
      {
        paginationOpts: { numItems: 1, cursor: null },
      },
    );
    expect(page.page).toHaveLength(1);
  });

  test("validates assignment parents, types, slugs, and bounded episode reads", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    const movieId = await seedMovie(t, "validation");
    const deletedMovieId = await seedMovie(t, "deleted");
    const episodeId = await seedEpisode(t, 13);
    await t.run(async (ctx) => {
      await ctx.db.delete("movies", deletedMovieId);
    });
    await advanceToS3(t);

    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.assignments.admin.create,
        {
          clientApiVersion: BBPC_API_VERSION,
          userId: memberId,
          movieId,
          episodeId,
          type: "INVALID",
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.assignments.admin.create,
        {
          clientApiVersion: BBPC_API_VERSION,
          userId: memberId,
          movieId: deletedMovieId,
          episodeId,
          type: "HOMEWORK",
        },
      ),
      "NOT_FOUND",
    );
    const assignmentId = await seedAssignment(t, {
      userId: memberId,
      movieId,
      episodeId,
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.assignments.admin.updateSlug,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: assignmentId,
          slug: "---",
        },
      ),
      "VALIDATION_FAILED",
    );

    await t.run(async (ctx) => {
      for (let index = 0; index < 50; index += 1) {
        await ctx.db.insert("assignments", {
          userId: memberId,
          movieId,
          episodeId,
          type: "HOMEWORK",
          playable: false,
        });
      }
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.assignments.admin.listForEpisode,
        { episodeId },
      ),
      "CONFLICT",
      { limit: 50, relationship: "assignments" },
    );
  });

  test("refuses referenced assignment deletion and deletes unreferenced assignments", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    const movieId = await seedMovie(t, "delete");
    const episodeId = await seedEpisode(t, 14);
    const assignmentId = await seedAssignment(t, {
      userId: memberId,
      movieId,
      episodeId,
    });
    const syllabusId = await seedSyllabusEntry(t, {
      userId: memberId,
      movieId,
      order: 1,
      assignmentId,
    });
    await advanceToS3(t);

    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.assignments.admin.removeIfUnreferenced,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: assignmentId,
        },
      ),
      "CONFLICT",
      { relationship: "syllabus entry" },
    );
    await t.run(async (ctx) => {
      await ctx.db.delete("syllabusEntries", syllabusId);
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.assignments.admin.removeIfUnreferenced,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: assignmentId,
        },
      ),
    ).resolves.toEqual({ id: assignmentId });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.assignments.admin.getById,
        { id: assignmentId },
      ),
    ).resolves.toBeNull();
  });

  test("keeps pending syllabus entries canonical across all insertion positions and assignment", async () => {
    const t = createTestBackend();
    await seedActors(t);
    const movieA = await seedMovie(t, "a");
    const movieB = await seedMovie(t, "b");
    const movieC = await seedMovie(t, "c");
    const movieD = await seedMovie(t, "d");
    await seedEpisode(t, 20);
    await advanceToS3(t);

    const a = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.syllabus.mine.add,
      {
        clientApiVersion: BBPC_API_VERSION,
        movieId: movieA,
      },
    );
    const b = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.syllabus.mine.add,
      {
        clientApiVersion: BBPC_API_VERSION,
        movieId: movieB,
        position: "TOP",
      },
    );
    const c = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.syllabus.mine.add,
      {
        clientApiVersion: BBPC_API_VERSION,
        movieId: movieC,
        position: "AFTER_NEXT",
      },
    );
    expect(
      (
        await t.withIdentity(MEMBER_IDENTITY).query(
          api.syllabus.mine.list,
          {},
        )
      ).map((entry) => entry.id),
    ).toEqual([b.id, c.id, a.id]);

    const assigned = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.syllabus.admin.assignEpisode,
      {
        clientApiVersion: BBPC_API_VERSION,
        syllabusId: b.id,
        episodeNumber: 20,
        assignmentType: "HOMEWORK",
      },
    );
    expect(assigned.assignment?.episode.number).toBe(20);
    expect(
      (
        await t.withIdentity(MEMBER_IDENTITY).query(
          api.syllabus.mine.list,
          {},
        )
      ).map((entry) => entry.id),
    ).toEqual([c.id, a.id, b.id]);

    const d = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.syllabus.mine.add,
      {
        clientApiVersion: BBPC_API_VERSION,
        movieId: movieD,
        position: "TOP",
      },
    );
    const final = await t.withIdentity(MEMBER_IDENTITY).query(
      api.syllabus.mine.list,
      {},
    );
    expect(final.map((entry) => entry.id)).toEqual([
      d.id,
      c.id,
      a.id,
      b.id,
    ]);
    expect(final.map((entry) => entry.order)).toEqual([4, 3, 2, 1]);
  });

  test("requires complete owner-only pending reorders and owner-only notes and deletion", async () => {
    const t = createTestBackend();
    const { otherId } = await seedActors(t);
    const movieA = await seedMovie(t, "owner-a");
    const movieB = await seedMovie(t, "owner-b");
    const otherMovie = await seedMovie(t, "other");
    await advanceToS3(t);

    const a = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.syllabus.mine.add,
      {
        clientApiVersion: BBPC_API_VERSION,
        movieId: movieA,
      },
    );
    const b = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.syllabus.mine.add,
      {
        clientApiVersion: BBPC_API_VERSION,
        movieId: movieB,
      },
    );
    const otherEntryId = await seedSyllabusEntry(t, {
      userId: otherId,
      movieId: otherMovie,
      order: 1,
    });
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.syllabus.mine.reorderPending,
        {
          clientApiVersion: BBPC_API_VERSION,
          orderedPendingIds: [a.id],
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.syllabus.mine.reorderPending,
        {
          clientApiVersion: BBPC_API_VERSION,
          orderedPendingIds: [a.id, a.id],
        },
      ),
      "CONFLICT",
    );
    await expect(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.syllabus.mine.reorderPending,
        {
          clientApiVersion: BBPC_API_VERSION,
          orderedPendingIds: [b.id, a.id],
        },
      ),
    ).resolves.toEqual({ success: true });
    expect(
      (
        await t.withIdentity(MEMBER_IDENTITY).query(
          api.syllabus.mine.list,
          {},
        )
      ).map((entry) => entry.id),
    ).toEqual([b.id, a.id]);

    const withNotes = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.syllabus.mine.updateNotes,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: a.id,
        notes: "  Watch carefully  ",
      },
    );
    expect(withNotes.notes).toBe("Watch carefully");
    await expect(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.syllabus.mine.updateNotes,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: a.id,
          notes: null,
        },
      ),
    ).resolves.toMatchObject({ notes: null });
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.syllabus.mine.updateNotes,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: otherEntryId,
          notes: "no",
        },
      ),
      "FORBIDDEN",
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.syllabus.mine.remove,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: otherEntryId,
        },
      ),
      "FORBIDDEN",
    );
    await expect(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.syllabus.mine.remove,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: b.id,
        },
      ),
    ).resolves.toEqual({ id: b.id });
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.syllabus.mine.updateNotes,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: a.id,
          notes: "x".repeat(5001),
        },
      ),
      "VALIDATION_FAILED",
    );
  });

  test("reuses and repairs assignment triples, unlinks safely, and exposes bounded admin reads", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    const movieId = await seedMovie(t, "reuse");
    const episodeId = await seedEpisode(t, 30);
    const assignmentId = await seedAssignment(t, {
      userId: memberId,
      movieId,
      episodeId,
      type: "HOMEWORK",
    });
    const syllabusId = await seedSyllabusEntry(t, {
      userId: memberId,
      movieId,
      order: 1,
      createdAt: 100,
    });
    await advanceToS3(t);

    const linked = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.syllabus.admin.assignEpisode,
      {
        clientApiVersion: BBPC_API_VERSION,
        syllabusId,
        episodeNumber: 30,
        assignmentType: "BONUS",
      },
    );
    expect(linked.assignment).toMatchObject({ id: assignmentId });
    expect(linked.assignment?.slug).not.toBeNull();
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.syllabus.admin.assignEpisode,
        {
          clientApiVersion: BBPC_API_VERSION,
          syllabusId,
          episodeNumber: 30,
          assignmentType: "BONUS",
        },
      ),
    ).resolves.toMatchObject({
      assignment: { id: assignmentId, type: "HOMEWORK" },
    });
    const exactCount = await t.run(async (ctx) => {
      return (
        await ctx.db
          .query("assignments")
          .withIndex(
            "by_userId_and_movieId_and_episodeId",
            (index) =>
              index
                .eq("userId", memberId)
                .eq("movieId", movieId)
                .eq("episodeId", episodeId),
          )
          .take(3)
      ).length;
    });
    expect(exactCount).toBe(1);

    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.syllabus.admin.getById,
        { id: syllabusId },
      ),
    ).resolves.toMatchObject({
      id: syllabusId,
      user: { id: memberId },
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.syllabus.admin.listForUser,
        { userId: memberId },
      ),
    ).resolves.toHaveLength(1);
    const page = await t.withIdentity(ADMIN_IDENTITY).query(
      api.syllabus.admin.listPage,
      {
        paginationOpts: { numItems: 1, cursor: null },
      },
    );
    expect(page.page).toHaveLength(1);

    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.syllabus.admin.unlinkEpisode,
        {
          clientApiVersion: BBPC_API_VERSION,
          syllabusId,
        },
      ),
    ).resolves.toMatchObject({ assignment: null });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.syllabus.admin.unlinkEpisode,
        {
          clientApiVersion: BBPC_API_VERSION,
          syllabusId,
        },
      ),
    ).resolves.toMatchObject({ assignment: null });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.syllabus.admin.removeEntry,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: syllabusId,
        },
      ),
    ).resolves.toEqual({ id: syllabusId });
  });

  test("serializes concurrent owner additions into a dense syllabus", async () => {
    const t = createTestBackend();
    await seedActors(t);
    const movieA = await seedMovie(t, "concurrent-a");
    const movieB = await seedMovie(t, "concurrent-b");
    await advanceToS3(t);

    const [first, second] = await Promise.all([
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.syllabus.mine.add,
        {
          clientApiVersion: BBPC_API_VERSION,
          movieId: movieA,
          position: "TOP",
        },
      ),
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.syllabus.mine.add,
        {
          clientApiVersion: BBPC_API_VERSION,
          movieId: movieB,
          position: "TOP",
        },
      ),
    ]);
    expect(first.id).not.toBe(second.id);
    const entries = await t.withIdentity(MEMBER_IDENTITY).query(
      api.syllabus.mine.list,
      {},
    );
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.order)).toEqual([2, 1]);
    expect(new Set(entries.map((entry) => entry.id))).toEqual(
      new Set([first.id, second.id]),
    );
  });

  test("enforces the per-user syllabus capacity", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    const movieId = await seedMovie(t, "capacity");
    await t.run(async (ctx) => {
      for (let index = 1; index <= 100; index += 1) {
        await ctx.db.insert("syllabusEntries", {
          userId: memberId,
          movieId,
          order: index,
          createdAt: index,
        });
      }
    });
    await advanceToS3(t);

    await expect(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.syllabus.mine.list,
        {},
      ),
    ).resolves.toHaveLength(100);
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.syllabus.mine.add,
        {
          clientApiVersion: BBPC_API_VERSION,
          movieId,
        },
      ),
      "CONFLICT",
      { limit: 100 },
    );
  });
});
