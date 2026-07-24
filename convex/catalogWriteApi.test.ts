/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "catalog-write-test";
const ADMIN_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|catalog-admin",
  issuer: "https://issuer.example.test",
  subject: "catalog-admin",
};
const MEMBER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|catalog-member",
  issuer: "https://issuer.example.test",
  subject: "catalog-member",
};

function createTestBackend() {
  return convexTest(schema, modules);
}

type TestBackend = ReturnType<typeof createTestBackend>;

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
    identity: typeof ADMIN_IDENTITY;
    name: string;
    admin: boolean;
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

async function seedActors(t: TestBackend) {
  const adminId = await seedUser(t, {
    identity: ADMIN_IDENTITY,
    name: "Catalog Admin",
    admin: true,
  });
  const memberId = await seedUser(t, {
    identity: MEMBER_IDENTITY,
    name: "Catalog Member",
    admin: false,
  });
  return { adminId, memberId };
}

async function initializeS1(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "catalog-write-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "catalog-write-test",
  });
}

async function advanceToS3(t: TestBackend): Promise<void> {
  await initializeS1(t);
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S1",
    nextStage: "S2",
    actor: "catalog-write-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S2",
    nextStage: "S3",
    actor: "catalog-write-test",
    approvedBackupId: "catalog-write-backup",
    approvedBackupChecksum: "sha256:catalog-write",
  });
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
      poster: `https://images.example.test/movie-${suffix}.jpg`,
      url: `https://catalog.example.test/movie-${suffix}`,
    });
  });
}

async function seedShow(
  t: TestBackend,
  suffix: string,
): Promise<Id<"shows">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("shows", {
      title: `Show ${suffix}`,
      normalizedTitle: `show ${suffix}`.toLowerCase(),
      year: 2001,
      poster: `https://images.example.test/show-${suffix}.jpg`,
      url: `https://catalog.example.test/show-${suffix}`,
    });
  });
}

function movieInput(
  overrides: Partial<{
    title: string;
    year: number;
    poster: string;
    url: string;
    tmdbId: number;
  }> = {},
) {
  return {
    clientApiVersion: BBPC_API_VERSION,
    title: "Arrival",
    year: 2016,
    poster: "https://images.example.test/arrival.jpg",
    url: "https://catalog.example.test/arrival",
    tmdbId: 329865,
    ...overrides,
  };
}

function showInput(
  overrides: Partial<{
    title: string;
    year: number;
    poster: string;
    url: string;
  }> = {},
) {
  return {
    clientApiVersion: BBPC_API_VERSION,
    title: "Severance",
    year: 2022,
    poster: "https://images.example.test/severance.jpg",
    url: "https://catalog.example.test/severance",
    ...overrides,
  };
}

describe("catalog write API", () => {
  test("requires identity and the application write gate", async () => {
    const t = createTestBackend();
    await seedActors(t);

    await expectDomainError(
      t.mutation(api.catalog.write.upsertMovieByUrl, movieInput()),
      "AUTHENTICATION_REQUIRED",
    );
    await initializeS1(t);
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.catalog.write.upsertMovieByUrl,
        movieInput(),
      ),
      "WRITE_DISABLED",
    );
  });

  test("keeps legacy catalog upserts authenticated while admin operations stay admin-only", async () => {
    const t = createTestBackend();
    await seedActors(t);
    const showId = await seedShow(t, "authorization");
    await advanceToS3(t);

    await expect(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.catalog.write.upsertMovieByUrl,
        movieInput(),
      ),
    ).resolves.toMatchObject({ title: "Arrival" });
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.catalog.admin.updateShow,
        {
          ...showInput(),
          id: showId,
        },
      ),
      "FORBIDDEN",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.catalog.admin.updateShow,
        {
          ...showInput(),
          clientApiVersion: "stale",
          id: showId,
        },
      ),
      "STALE_CLIENT",
    );
  });

  test("creates and updates a movie by exact URL without clearing an omitted TMDB ID", async () => {
    const t = createTestBackend();
    await seedActors(t);
    await advanceToS3(t);

    const created = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.catalog.write.upsertMovieByUrl,
      movieInput({
        title: "  Ａｒｒｉｖａｌ  ",
        poster: "",
      }),
    );
    expect(created).toMatchObject({
      title: "Arrival",
      year: 2016,
      poster: "",
      tmdbId: 329865,
    });
    const updated = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.catalog.write.upsertMovieByUrl,
      {
        clientApiVersion: BBPC_API_VERSION,
        title: "Arrival Updated",
        year: 2017,
        poster: "https://images.example.test/arrival-new.jpg",
        url: movieInput().url,
      },
    );
    expect(updated).toMatchObject({
      id: created.id,
      title: "Arrival Updated",
      year: 2017,
      tmdbId: 329865,
    });
    const withoutTmdb = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.catalog.write.upsertMovieByUrl,
      {
        clientApiVersion: BBPC_API_VERSION,
        title: "No External ID",
        year: 2000,
        poster: "",
        url: "https://catalog.example.test/no-external-id",
      },
    );
    expect(withoutTmdb.tmdbId).toBeNull();

    const snapshot = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("movies")
        .withIndex("by_url", (index) =>
          index.eq("url", movieInput().url),
        )
        .take(3);
      const audits = await ctx.db
        .query("auditEvents")
        .withIndex("by_createdAt")
        .take(20);
      return { rows, audits };
    });
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0]?.normalizedTitle).toBe(
      "arrival updated",
    );
    expect(
      snapshot.audits.map((audit) => ({
        action: audit.action,
        metadata: audit.metadata,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          action: "catalog.movie.createdByUrl",
          metadata: undefined,
        },
        {
          action: "catalog.movie.updatedByUrl",
          metadata: undefined,
        },
      ]),
    );
  });

  test("updates only one preserved duplicate URL row", async () => {
    const t = createTestBackend();
    await seedActors(t);
    const url = "https://catalog.example.test/preserved-duplicate";
    const ids = await t.run(async (ctx) => {
      const first = await ctx.db.insert("movies", {
        title: "First",
        normalizedTitle: "first",
        year: 2000,
        url,
      });
      const second = await ctx.db.insert("movies", {
        title: "Second",
        normalizedTitle: "second",
        year: 2001,
        url,
      });
      return [first, second];
    });
    await advanceToS3(t);

    const updated = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.catalog.write.upsertMovieByUrl,
      movieInput({
        title: "Updated",
        url,
      }),
    );
    expect(ids).toContain(updated.id);
    const rows = await t.run(async (ctx) => {
      return await ctx.db
        .query("movies")
        .withIndex("by_url", (index) => index.eq("url", url))
        .take(3);
    });
    expect(rows).toHaveLength(2);
    expect(rows.filter((movie) => movie.title === "Updated")).toHaveLength(
      1,
    );
  });

  test("creates and updates shows by URL, then supports explicit admin editing", async () => {
    const t = createTestBackend();
    await seedActors(t);
    await advanceToS3(t);

    const created = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.catalog.write.upsertShowByUrl,
      showInput(),
    );
    const byUrl = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.catalog.write.upsertShowByUrl,
      showInput({
        title: "Severance Updated",
        year: 2023,
        poster: "",
      }),
    );
    expect(byUrl).toMatchObject({
      id: created.id,
      title: "Severance Updated",
      poster: "",
    });
    const byAdmin = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.catalog.admin.updateShow,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: created.id,
        title: "Severance Final",
        year: 2024,
        url: showInput().url,
      },
    );
    expect(byAdmin).toMatchObject({
      title: "Severance Final",
      year: 2024,
      poster: "",
    });
    const withPoster = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.catalog.admin.updateShow,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: created.id,
        title: "Severance Poster",
        year: 2025,
        poster: "https://images.example.test/severance-final.jpg",
        url: showInput().url,
      },
    );
    expect(withPoster.poster).toBe(
      "https://images.example.test/severance-final.jpg",
    );
  });

  test("validates titles, years, URLs, posters, and TMDB IDs", async () => {
    const t = createTestBackend();
    await seedActors(t);
    await advanceToS3(t);

    const invalidInputs = [
      movieInput({ title: " " }),
      movieInput({ title: "x".repeat(1001) }),
      movieInput({ year: 1.5 }),
      movieInput({ year: -32_769 }),
      movieInput({ year: 32_768 }),
      movieInput({ url: "" }),
      movieInput({ url: "x".repeat(2049) }),
      movieInput({ url: "not a url" }),
      movieInput({ url: "ftp://catalog.example.test/movie" }),
      movieInput({ poster: "x".repeat(2049) }),
      movieInput({ poster: "not a url" }),
      movieInput({ poster: "ftp://images.example.test/movie" }),
      movieInput({ tmdbId: 0 }),
      movieInput({ tmdbId: 1.5 }),
      movieInput({ tmdbId: 2_147_483_648 }),
    ];
    for (const input of invalidInputs) {
      await expectDomainError(
        t.withIdentity(MEMBER_IDENTITY).mutation(
          api.catalog.write.upsertMovieByUrl,
          input,
        ),
        "VALIDATION_FAILED",
      );
    }
  });

  test("deletes unreferenced catalog rows and fails closed for missing targets", async () => {
    const t = createTestBackend();
    await seedActors(t);
    const movieId = await seedMovie(t, "delete");
    const showId = await seedShow(t, "delete");
    const missingMovieId = await seedMovie(t, "missing");
    const missingShowId = await seedShow(t, "missing");
    await t.run(async (ctx) => {
      await ctx.db.delete("movies", missingMovieId);
      await ctx.db.delete("shows", missingShowId);
    });
    await advanceToS3(t);

    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.catalog.admin.deleteMovie,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: movieId,
        },
      ),
    ).resolves.toEqual({ id: movieId });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.catalog.admin.deleteShow,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: showId,
        },
      ),
    ).resolves.toEqual({ id: showId });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.catalog.admin.deleteMovie,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: missingMovieId,
        },
      ),
      "NOT_FOUND",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.catalog.admin.deleteShow,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: missingShowId,
        },
      ),
      "NOT_FOUND",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.catalog.admin.updateShow,
        {
          ...showInput(),
          id: missingShowId,
        },
      ),
      "NOT_FOUND",
    );
  });

  test("rejects movie deletion for every canonical relationship", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    const ids = {
      assignment: await seedMovie(t, "assignment"),
      syllabus: await seedMovie(t, "syllabus"),
      review: await seedMovie(t, "review"),
      ranked: await seedMovie(t, "ranked"),
    };
    await t.run(async (ctx) => {
      const episodeId = await ctx.db.insert("episodes", {
        number: 1,
        title: "Catalog Relationships",
      });
      await ctx.db.insert("assignments", {
        userId: memberId,
        episodeId,
        movieId: ids.assignment,
        type: "HOMEWORK",
        playable: true,
      });
      await ctx.db.insert("syllabusEntries", {
        userId: memberId,
        movieId: ids.syllabus,
        order: 1,
        createdAt: 1,
      });
      await ctx.db.insert("reviews", {
        userId: memberId,
        movieId: ids.review,
      });
      const typeId = await ctx.db.insert("rankedListTypes", {
        name: "Movies",
        description: "Movie list",
        maxItems: 10,
        targetType: "MOVIE",
        createdAt: 1,
        updatedAt: 1,
      });
      const listId = await ctx.db.insert("rankedLists", {
        userId: memberId,
        rankedListTypeId: typeId,
        status: "DRAFT",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("rankedItems", {
        rankedListId: listId,
        targetType: "movie",
        movieId: ids.ranked,
        rank: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    await advanceToS3(t);

    for (const [relationship, id] of [
      ["assignment", ids.assignment],
      ["syllabus entry", ids.syllabus],
      ["review", ids.review],
      ["ranked item", ids.ranked],
    ] as const) {
      await expectDomainError(
        t.withIdentity(ADMIN_IDENTITY).mutation(
          api.catalog.admin.deleteMovie,
          {
            clientApiVersion: BBPC_API_VERSION,
            id,
          },
        ),
        "CONFLICT",
        { relationship },
      );
    }
  });

  test("rejects show deletion for review and ranked-list relationships", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    const reviewShowId = await seedShow(t, "review");
    const rankedShowId = await seedShow(t, "ranked");
    await t.run(async (ctx) => {
      await ctx.db.insert("reviews", {
        userId: memberId,
        showId: reviewShowId,
      });
      const typeId = await ctx.db.insert("rankedListTypes", {
        name: "Shows",
        description: "Show list",
        maxItems: 10,
        targetType: "SHOW",
        createdAt: 1,
        updatedAt: 1,
      });
      const listId = await ctx.db.insert("rankedLists", {
        userId: memberId,
        rankedListTypeId: typeId,
        status: "DRAFT",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("rankedItems", {
        rankedListId: listId,
        targetType: "show",
        showId: rankedShowId,
        rank: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    await advanceToS3(t);

    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.catalog.admin.deleteShow,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: reviewShowId,
        },
      ),
      "CONFLICT",
      { relationship: "review" },
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.catalog.admin.deleteShow,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: rankedShowId,
        },
      ),
      "CONFLICT",
      { relationship: "ranked item" },
    );
  });
});
