/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api.js";
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

async function seedMovie(
  t: TestBackend,
  options: {
    title: string;
    year: number;
    poster?: string;
    tmdbId?: number;
  },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("movies", {
      title: options.title,
      normalizedTitle: options.title
        .trim()
        .normalize("NFKC")
        .toLowerCase(),
      year: options.year,
      url: `https://movies.example/${encodeURIComponent(options.title)}/${String(options.year)}`,
      ...(options.poster === undefined
        ? {}
        : { poster: options.poster }),
      ...(options.tmdbId === undefined
        ? {}
        : { tmdbId: options.tmdbId }),
    });
  });
}

async function seedShow(
  t: TestBackend,
  options: {
    title: string;
    year: number;
    poster?: string;
  },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("shows", {
      title: options.title,
      normalizedTitle: options.title
        .trim()
        .normalize("NFKC")
        .toLowerCase(),
      year: options.year,
      url: `https://shows.example/${encodeURIComponent(options.title)}/${String(options.year)}`,
      ...(options.poster === undefined
        ? {}
        : { poster: options.poster }),
    });
  });
}

describe("public catalog read API", () => {
  test("gets privacy-neutral movie and show DTOs by Convex ID", async () => {
    const t = createTestBackend();
    const movieId = await seedMovie(t, {
      title: "Arrival",
      year: 2016,
      poster: "https://images.example/arrival.png",
      tmdbId: 329865,
    });
    const showId = await seedShow(t, {
      title: "Severance",
      year: 2022,
    });

    await expect(
      t.query(api.catalog.public.getMovie, { id: movieId }),
    ).resolves.toMatchObject({
      id: movieId,
      title: "Arrival",
      poster: "https://images.example/arrival.png",
      tmdbId: 329865,
    });
    await expect(
      t.query(api.catalog.public.getShow, { id: showId }),
    ).resolves.toMatchObject({
      id: showId,
      title: "Severance",
      poster: null,
    });

    await t.run(async (ctx) => {
      await ctx.db.delete("movies", movieId);
      await ctx.db.delete("shows", showId);
    });
    await expect(
      t.query(api.catalog.public.getMovie, { id: movieId }),
    ).resolves.toBeNull();
    await expect(
      t.query(api.catalog.public.getShow, { id: showId }),
    ).resolves.toBeNull();
  });

  test("puts exact movie titles first with deterministic year order", async () => {
    const t = createTestBackend();
    await seedMovie(t, { title: "The Matrix", year: 1999 });
    await seedMovie(t, { title: "Matrix", year: 2003 });
    await seedMovie(t, { title: "Matrix", year: 1999 });
    await seedMovie(t, { title: "Matrix", year: 1999 });
    await seedMovie(t, { title: "Arrival", year: 2016 });

    const result = await t.query(
      api.catalog.public.searchMovies,
      { query: "  ＭＡＴＲＩＸ  ", limit: 20 },
    );

    expect(result.map(({ title, year }) => ({ title, year }))).toEqual([
      { title: "Matrix", year: 1999 },
      { title: "Matrix", year: 1999 },
      { title: "Matrix", year: 2003 },
      { title: "The Matrix", year: 1999 },
    ]);
  });

  test.each([1, 20])("ranks Wrath of Man first with limit %s", async (limit) => {
    const t = createTestBackend();
    await seedMovie(t, { title: "A Wrath of Man Story", year: 2021 });
    const exactId = await seedMovie(t, { title: "Wrath of Man", year: 2021 });

    const result = await t.query(api.catalog.public.searchMovies, {
      query: "  ＷＲＡＴＨ of Man  ",
      limit,
    });

    expect(result[0]?.id).toBe(exactId);
    expect(result).toHaveLength(limit === 1 ? 1 : 2);
    expect(new Set(result.map((movie) => movie.id)).size).toBe(result.length);
  });

  test("preserves search relevance for non-exact movie matches", async () => {
    const t = createTestBackend();
    await seedMovie(t, { title: "Z Wrath of Man", year: 2021 });
    await seedMovie(t, { title: "A Wrath of Man Story", year: 2021 });
    const expectedIds = await t.run(async (ctx) =>
      (await ctx.db.query("movies")
        .withSearchIndex("search_title", (search) => search.search("title", "wrath of man"))
        .take(20)).map((movie) => movie._id),
    );

    const result = await t.query(api.catalog.public.searchMovies, {
      query: "wrath of man",
      limit: 20,
    });

    expect(result.map((movie) => movie.id)).toEqual(expectedIds);
  });

  test("applies the year filter to exact title matches before limiting", async () => {
    const t = createTestBackend();
    await seedMovie(t, { title: "Wrath of Man", year: 2000 });
    await seedMovie(t, { title: "A Wrath of Man Story", year: 2021 });
    const exactId = await seedMovie(t, { title: "Wrath of Man", year: 2021 });

    const result = await t.query(api.catalog.public.searchMovies, {
      query: "wrath of man y:2021",
      limit: 1,
    });

    expect(result.map((movie) => movie.id)).toEqual([exactId]);
  });

  test("adds exact-year movie matches without duplicates", async () => {
    const t = createTestBackend();
    await seedMovie(t, { title: "1999", year: 1999 });
    await seedMovie(t, { title: "The Matrix", year: 1999 });
    await seedMovie(t, { title: "Arrival", year: 2016 });

    const result = await t.query(
      api.catalog.public.searchMovies,
      { query: "1999", limit: 20 },
    );

    expect(result).toHaveLength(2);
    expect(new Set(result.map((movie) => movie.id)).size).toBe(2);
    expect(result.every((movie) => movie.year === 1999)).toBe(true);
  });

  test("applies y: release-year modifiers to movie title searches", async () => {
    const t = createTestBackend();
    const matchingMovieId = await seedMovie(t, {
      title: "The Imposter",
      year: 2001,
    });
    await seedMovie(t, { title: "The Imposter", year: 2012 });
    await seedMovie(t, { title: "D.A.R.Y.L.", year: 1985 });

    const result = await t.query(api.catalog.public.searchMovies, {
      limit: 20,
      query: "Imposter y:2001",
    });

    expect(result.map((movie) => movie.id)).toEqual([matchingMovieId]);
  });

  test("searches shows and treats a blank query as no results", async () => {
    const t = createTestBackend();
    await seedShow(t, { title: "Twin Peaks", year: 1990 });
    await seedShow(t, { title: "Peak Practice", year: 1993 });
    await seedShow(t, { title: "Severance", year: 2022 });

    const shows = await t.query(
      api.catalog.public.searchShows,
      {
        query: "peak",
        limit: 10,
      },
    );
    expect(shows.map((show) => show.title).sort()).toEqual([
      "Peak Practice",
      "Twin Peaks",
    ]);
    await expect(
      t.query(api.catalog.public.searchMovies, {
        query: "   ",
        limit: 10,
      }),
    ).resolves.toEqual([]);
    await expect(
      t.query(api.catalog.public.searchShows, {
        query: "   ",
        limit: 10,
      }),
    ).resolves.toEqual([]);
  });

  test.each([0, 1.5, 21])(
    "rejects an unsafe search limit %s",
    async (limit) => {
      const t = createTestBackend();
      await expectDomainError(
        t.query(api.catalog.public.searchMovies, {
          query: "movie",
          limit,
        }),
        "VALIDATION_FAILED",
      );
    },
  );

  test("paginates movies and shows by normalized title and year", async () => {
    const t = createTestBackend();
    await seedMovie(t, { title: "Zulu", year: 1964 });
    const firstMovieId = await seedMovie(t, {
      title: "Arrival",
      year: 2016,
    });
    await seedShow(t, { title: "Zulu", year: 1964 });
    const firstShowId = await seedShow(t, {
      title: "Arrival",
      year: 2016,
    });

    const moviePage = await t.query(
      api.catalog.public.listMoviesPage,
      {
        paginationOpts: { cursor: null, numItems: 1 },
      },
    );
    const showPage = await t.query(
      api.catalog.public.listShowsPage,
      {
        paginationOpts: { cursor: null, numItems: 1 },
      },
    );

    expect(moviePage.page).toEqual([
      expect.objectContaining({ id: firstMovieId }),
    ]);
    expect(showPage.page).toEqual([
      expect.objectContaining({ id: firstShowId }),
    ]);
    expect(moviePage.isDone).toBe(false);
    expect(showPage.isDone).toBe(false);
  });

  test.each([
    ["movies", api.catalog.public.listMoviesPage],
    ["shows", api.catalog.public.listShowsPage],
  ] as const)(
    "rejects an unsafe %s page size",
    async (_catalog, listPage) => {
      const t = createTestBackend();
      await expectDomainError(
        t.query(listPage, {
          paginationOpts: { cursor: null, numItems: 51 },
        }),
        "VALIDATION_FAILED",
      );
    },
  );
});
