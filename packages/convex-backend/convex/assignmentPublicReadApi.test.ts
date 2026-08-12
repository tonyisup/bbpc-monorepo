/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");

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

async function seedAssignment(
  t: TestBackend,
  input: {
    slug?: string;
    legacyId?: string;
    type?: string;
    omitMovie?: boolean;
  } = {},
): Promise<Id<"assignments">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: "Public Host",
      email: "private@example.test",
      image: "https://images.example.test/host.png",
      status: "disabled",
      createdAt: 1,
      updatedAt: 1,
    });
    const movieId = await ctx.db.insert("movies", {
      title: "Public Movie",
      normalizedTitle: "public movie",
      year: 2026,
      poster: "https://images.example.test/movie.png",
      url: "https://movies.example.test/public",
      tmdbId: 42,
    });
    const episodeId = await ctx.db.insert("episodes", {
      number: 800,
      title: "Public Episode",
      status: "next",
      slug: "public-episode",
      normalizedSlug: "public-episode",
    });
    const assignmentId = await ctx.db.insert("assignments", {
      userId,
      movieId,
      episodeId,
      type: input.type ?? "HOMEWORK",
      playable: true,
      ...(input.slug === undefined
        ? {}
        : {
            slug: input.slug,
            normalizedSlug: input.slug.toLowerCase(),
          }),
      ...(input.legacyId === undefined ? {} : { legacyId: input.legacyId }),
    });
    if (input.omitMovie === true) {
      await ctx.db.delete("movies", movieId);
    }
    return assignmentId;
  });
}

describe("public assignment read API", () => {
  test("normalizes slug lookup and returns only the public presentation DTO", async () => {
    const t = createTestBackend();
    const assignmentId = await seedAssignment(t, {
      slug: "Public-Assignment",
    });

    const result = await t.query(api.assignments.public.getBySlug, {
      slug: "  PUBLIC-ASSIGNMENT  ",
    });
    expect(result).not.toBeNull();
    if (result === null) {
      throw new Error("Expected a public assignment.");
    }

    expect(result).toEqual({
      id: assignmentId,
      type: "HOMEWORK",
      playable: true,
      slug: "Public-Assignment",
      user: {
        id: result.user.id,
        name: "Public Host",
        image: "https://images.example.test/host.png",
      },
      movie: {
        id: result.movie.id,
        title: "Public Movie",
        year: 2026,
        poster: "https://images.example.test/movie.png",
        url: "https://movies.example.test/public",
        tmdbId: 42,
      },
      episode: {
        id: result.episode.id,
        number: 800,
        title: "Public Episode",
        status: "next",
        slug: "public-episode",
      },
    });
    expect(JSON.stringify(result)).not.toContain("private@example.test");
    expect(JSON.stringify(result)).not.toContain("disabled");
  });

  test("normalizes legacy IDs and returns null for missing lookups", async () => {
    const t = createTestBackend();
    const assignmentId = await seedAssignment(t, {
      legacyId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    });

    await expect(
      t.query(api.assignments.public.getByLegacyId, {
        legacyId: "  AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE  ",
      }),
    ).resolves.toMatchObject({ id: assignmentId });
    await expect(
      t.query(api.assignments.public.getBySlug, { slug: "missing" }),
    ).resolves.toBeNull();
    await expect(
      t.query(api.assignments.public.getByLegacyId, {
        legacyId: "ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee",
      }),
    ).resolves.toBeNull();
  });

  test.each([
    ["getBySlug", { slug: " " }],
    ["getByLegacyId", { legacyId: " " }],
  ] as const)("rejects blank %s lookups", async (method, args) => {
    const t = createTestBackend();
    await expectDomainError(
      method === "getBySlug"
        ? t.query(api.assignments.public.getBySlug, args)
        : t.query(api.assignments.public.getByLegacyId, args),
      "VALIDATION_FAILED",
    );
  });

  test("fails closed on invalid types and broken relationships", async () => {
    const invalidType = createTestBackend();
    await seedAssignment(invalidType, {
      slug: "invalid-type",
      type: "SURPRISE",
    });
    await expectDomainError(
      invalidType.query(api.assignments.public.getBySlug, {
        slug: "invalid-type",
      }),
      "CONFLICT",
    );

    const missingMovie = createTestBackend();
    await seedAssignment(missingMovie, {
      slug: "missing-movie",
      omitMovie: true,
    });
    await expectDomainError(
      missingMovie.query(api.assignments.public.getBySlug, {
        slug: "missing-movie",
      }),
      "CONFLICT",
    );
  });
});
