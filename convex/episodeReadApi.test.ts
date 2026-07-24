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

async function seedEpisode(
  t: TestBackend,
  options: {
    number: number;
    title?: string;
    date?: string;
    status?: string;
    slug?: string;
    legacyId?: string;
    withGraph?: boolean;
  },
): Promise<Id<"episodes">> {
  return await t.run(async (ctx) => {
    const episodeId = await ctx.db.insert("episodes", {
      number: options.number,
      title: options.title ?? `Episode ${String(options.number)}`,
      ...(options.date === undefined ? {} : { date: options.date }),
      ...(options.status === undefined ? {} : { status: options.status }),
      ...(options.slug === undefined
        ? {}
        : {
            slug: options.slug,
            normalizedSlug: options.slug.trim().normalize("NFKC").toLowerCase(),
          }),
      ...(options.legacyId === undefined ? {} : { legacyId: options.legacyId }),
      ...(options.withGraph === true
        ? {
            recording: "https://audio.example/episode.mp3",
            description: "Synthetic episode",
          }
        : {}),
    });
    if (options.withGraph !== true) {
      return episodeId;
    }

    const userId = await ctx.db.insert("users", {
      name: "Host",
      image: "https://images.example/host.png",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const movieId = await ctx.db.insert("movies", {
      title: "Synthetic Movie",
      normalizedTitle: "synthetic movie",
      year: 2025,
      poster: "https://images.example/movie.png",
      url: "https://movies.example/synthetic",
      tmdbId: 42,
    });
    const showId = await ctx.db.insert("shows", {
      title: "Synthetic Show",
      normalizedTitle: "synthetic show",
      year: 2024,
      poster: "https://images.example/show.png",
      url: "https://shows.example/synthetic",
    });
    await ctx.db.insert("assignments", {
      episodeId,
      userId,
      movieId,
      type: "HOMEWORK",
      playable: true,
      slug: "synthetic-assignment",
      normalizedSlug: "synthetic-assignment",
    });
    await ctx.db.insert("episodeLinks", {
      episodeId,
      url: "https://links.example/episode",
      text: "Episode link",
    });
    const movieReviewId = await ctx.db.insert("reviews", {
      movieId,
      userId,
    });
    const showReviewId = await ctx.db.insert("reviews", {
      showId,
    });
    const emptyReviewId = await ctx.db.insert("reviews", {});
    for (const reviewId of [movieReviewId, showReviewId, emptyReviewId]) {
      await ctx.db.insert("extraReviews", {
        episodeId,
        reviewId,
      });
    }
    return episodeId;
  });
}

describe("public episode read API", () => {
  test("returns the latest published episode on or before a supplied date", async () => {
    const t = createTestBackend();
    await seedEpisode(t, {
      number: 1,
      date: "2026-01-01",
      status: "Published",
    });
    const expectedId = await seedEpisode(t, {
      number: 2,
      date: "2026-06-01",
      status: "published",
      slug: "Episode-Two",
      withGraph: true,
    });
    await seedEpisode(t, {
      number: 3,
      date: "2027-01-01",
      status: "Published",
    });

    const result = await t.query(api.episodes.public.latestPublished, {
      onOrBefore: "2026-12-31",
    });

    expect(result).toMatchObject({
      id: expectedId,
      date: "2026-06-01",
      recording: "https://audio.example/episode.mp3",
      description: "Synthetic episode",
      slug: "Episode-Two",
      assignments: [
        {
          type: "HOMEWORK",
          playable: true,
          slug: "synthetic-assignment",
          user: {
            name: "Host",
            image: "https://images.example/host.png",
          },
          movie: {
            title: "Synthetic Movie",
            poster: "https://images.example/movie.png",
            tmdbId: 42,
          },
        },
      ],
      links: [{ text: "Episode link" }],
    });
    expect(
      result?.extras.map((extra) => ({
        movieTitle: extra.review.movie?.title ?? null,
        showTitle: extra.review.show?.title ?? null,
      })),
    ).toEqual([
      { movieTitle: "Synthetic Movie", showTitle: null },
      { movieTitle: null, showTitle: "Synthetic Show" },
      { movieTitle: null, showTitle: null },
    ]);
  });

  test("selects a newer title-case legacy published status", async () => {
    const t = createTestBackend();
    await seedEpisode(t, {
      number: 1,
      date: "2026-01-01",
      status: "published",
    });
    const titleCaseId = await seedEpisode(t, {
      number: 2,
      date: "2026-02-01",
      status: "Published",
    });

    await expect(
      t.query(api.episodes.public.latestPublished, {
        onOrBefore: "2026-12-31",
      }),
    ).resolves.toMatchObject({ id: titleCaseId });
  });

  test("returns null when no published episode meets the date bound", async () => {
    const t = createTestBackend();
    await seedEpisode(t, {
      number: 1,
      date: "2027-01-01",
      status: "Published",
    });

    await expect(
      t.query(api.episodes.public.latestPublished, {
        onOrBefore: "2026-12-31",
      }),
    ).resolves.toBeNull();
  });

  test.each([
    ["not-a-date", "VALIDATION_FAILED"],
    ["2026-02-30", "VALIDATION_FAILED"],
  ])("rejects invalid supplied date %s", async (onOrBefore, code) => {
    const t = createTestBackend();
    await expectDomainError(
      t.query(api.episodes.public.latestPublished, {
        onOrBefore,
      }),
      code,
    );
  });

  test("selects the highest numbered next or recording episode", async () => {
    const t = createTestBackend();
    await seedEpisode(t, {
      number: 10,
      status: "next",
    });
    const recordingId = await seedEpisode(t, {
      number: 11,
      status: "recording",
    });

    await expect(
      t.query(api.episodes.public.nextScheduled, {}),
    ).resolves.toMatchObject({
      id: recordingId,
      recording: null,
      date: null,
      description: null,
      slug: null,
      assignments: [],
      extras: [],
      links: [],
    });
  });

  test("handles each partial next-episode candidate set", async () => {
    const empty = createTestBackend();
    await expect(
      empty.query(api.episodes.public.nextScheduled, {}),
    ).resolves.toBeNull();

    const recordingOnly = createTestBackend();
    const recordingId = await seedEpisode(recordingOnly, {
      number: 4,
      status: "recording",
    });
    await expect(
      recordingOnly.query(api.episodes.public.nextScheduled, {}),
    ).resolves.toMatchObject({ id: recordingId });

    const nextOnly = createTestBackend();
    const nextId = await seedEpisode(nextOnly, {
      number: 5,
      status: "next",
    });
    await expect(
      nextOnly.query(api.episodes.public.nextScheduled, {}),
    ).resolves.toMatchObject({ id: nextId });

    const nextWins = createTestBackend();
    const higherNextId = await seedEpisode(nextWins, {
      number: 8,
      status: "next",
    });
    await seedEpisode(nextWins, {
      number: 7,
      status: "recording",
    });
    await expect(
      nextWins.query(api.episodes.public.nextScheduled, {}),
    ).resolves.toMatchObject({ id: higherNextId });
  });

  test("normalizes slug lookups and returns null for unknown slugs", async () => {
    const t = createTestBackend();
    const episodeId = await seedEpisode(t, {
      number: 2,
      slug: "Episode-Two",
    });

    await expect(
      t.query(api.episodes.public.getBySlug, {
        slug: "  EPISODE-TWO  ",
      }),
    ).resolves.toMatchObject({ id: episodeId });
    await expect(
      t.query(api.episodes.public.getBySlug, {
        slug: "missing",
      }),
    ).resolves.toBeNull();
    await expectDomainError(
      t.query(api.episodes.public.getBySlug, { slug: "  " }),
      "VALIDATION_FAILED",
    );
  });

  test("normalizes transitional legacy-ID lookups", async () => {
    const t = createTestBackend();
    const episodeId = await seedEpisode(t, {
      number: 2,
      legacyId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    });

    await expect(
      t.query(api.episodes.public.getByLegacyId, {
        legacyId: "  AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE  ",
      }),
    ).resolves.toMatchObject({ id: episodeId });
    await expect(
      t.query(api.episodes.public.getByLegacyId, {
        legacyId: "ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee",
      }),
    ).resolves.toBeNull();
    await expectDomainError(
      t.query(api.episodes.public.getByLegacyId, {
        legacyId: "   ",
      }),
      "VALIDATION_FAILED",
    );
  });

  test("searches episode and assigned-movie titles without duplicates", async () => {
    const t = createTestBackend();
    const directId = await seedEpisode(t, {
      number: 1,
      title: "Matrix Discussion",
      date: "2026-01-01",
    });
    const assignmentId = await seedEpisode(t, {
      number: 2,
      title: "Episode Two",
      date: "2026-02-01",
    });
    await seedEpisode(t, {
      number: 3,
      title: "Arrival Discussion",
      date: "2026-03-01",
    });
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const movieId = await ctx.db.insert("movies", {
        title: "The Matrix",
        normalizedTitle: "the matrix",
        year: 1999,
        url: "https://movies.example/the-matrix",
      });
      for (const episodeId of [directId, assignmentId]) {
        await ctx.db.insert("assignments", {
          episodeId,
          userId,
          movieId,
          type: "HOMEWORK",
          playable: true,
        });
      }
    });

    const result = await t.query(api.episodes.public.search, {
      query: "  ＭＡＴＲＩＸ  ",
      limit: 10,
    });

    expect(result.map((episode) => episode.id)).toEqual([
      assignmentId,
      directId,
    ]);
    await expect(
      t.query(api.episodes.public.search, {
        query: "   ",
        limit: 10,
      }),
    ).resolves.toEqual([]);
    await expectDomainError(
      t.query(api.episodes.public.search, {
        query: "matrix",
        limit: 0,
      }),
      "VALIDATION_FAILED",
    );
  });

  test("fails closed when search finds an orphaned assignment", async () => {
    const t = createTestBackend();
    const episodeId = await seedEpisode(t, {
      number: 1,
      title: "Episode One",
    });
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const movieId = await ctx.db.insert("movies", {
        title: "Orphan Search Movie",
        normalizedTitle: "orphan search movie",
        year: 2026,
        url: "https://movies.example/orphan",
      });
      await ctx.db.insert("assignments", {
        episodeId,
        userId,
        movieId,
        type: "HOMEWORK",
        playable: true,
      });
      await ctx.db.delete("episodes", episodeId);
    });

    await expectDomainError(
      t.query(api.episodes.public.search, {
        query: "orphan",
        limit: 10,
      }),
      "CONFLICT",
    );
  });

  test("paginates episode detail in descending date order", async () => {
    const t = createTestBackend();
    await seedEpisode(t, {
      number: 1,
      date: "2026-01-01",
    });
    const newestId = await seedEpisode(t, {
      number: 2,
      date: "2026-02-01",
    });

    const firstPage = await t.query(api.episodes.public.listPage, {
      paginationOpts: { cursor: null, numItems: 1 },
    });
    expect(firstPage.page).toEqual([expect.objectContaining({ id: newestId })]);
    expect(firstPage.isDone).toBe(false);

    const secondPage = await t.query(api.episodes.public.listPage, {
      paginationOpts: {
        cursor: firstPage.continueCursor,
        numItems: 1,
      },
    });
    expect(secondPage.page).toHaveLength(1);
    expect(secondPage.page[0]?.number).toBe(1);

    await expectDomainError(
      t.query(api.episodes.public.listPage, {
        paginationOpts: { cursor: null, numItems: 51 },
      }),
      "VALIDATION_FAILED",
    );
  });

  test("fails closed when a public relationship is missing", async () => {
    const t = createTestBackend();
    const episodeId = await seedEpisode(t, {
      number: 1,
      slug: "orphaned",
      withGraph: true,
    });
    await t.run(async (ctx) => {
      const assignment = await ctx.db
        .query("assignments")
        .withIndex("by_episodeId", (query) => query.eq("episodeId", episodeId))
        .unique();
      if (assignment === null) {
        throw new Error("Synthetic assignment missing");
      }
      await ctx.db.delete("users", assignment.userId);
    });

    await expectDomainError(
      t.query(api.episodes.public.getBySlug, {
        slug: "orphaned",
      }),
      "CONFLICT",
    );
  });

  test("rejects relationship fanout above the public limit", async () => {
    const t = createTestBackend();
    const episodeId = await seedEpisode(t, {
      number: 1,
      slug: "too-many-links",
    });
    await t.run(async (ctx) => {
      for (let index = 0; index < 51; index += 1) {
        await ctx.db.insert("episodeLinks", {
          episodeId,
          url: `https://links.example/${String(index)}`,
          text: `Link ${String(index)}`,
        });
      }
    });

    await expectDomainError(
      t.query(api.episodes.public.getBySlug, {
        slug: "too-many-links",
      }),
      "CONFLICT",
    );
  });

  test("returns only bounded public episode winners", async () => {
    const t = createTestBackend();
    const episodeId = await seedEpisode(t, {
      number: 12,
      slug: "episode-results",
    });
    const expected = await t.run(async (ctx) => {
      const hostId = await ctx.db.insert("users", {
        name: "Host",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const winnerId = await ctx.db.insert("users", {
        name: "Winner",
        email: "winner@example.test",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const movieId = await ctx.db.insert("movies", {
        title: "Results Movie",
        normalizedTitle: "results movie",
        year: 2026,
        url: "https://movies.example/results",
      });
      const assignmentId = await ctx.db.insert("assignments", {
        episodeId,
        userId: hostId,
        movieId,
        type: "HOMEWORK",
        playable: true,
      });
      const correctRatingId = await ctx.db.insert("ratings", {
        name: "Correct",
        value: 4,
      });
      const wrongRatingId = await ctx.db.insert("ratings", {
        name: "Wrong",
        value: 2,
      });
      const reviewId = await ctx.db.insert("reviews", {
        userId: hostId,
        movieId,
        ratingId: correctRatingId,
      });
      const assignmentReviewId = await ctx.db.insert("assignmentReviews", {
        assignmentId,
        reviewId,
      });
      const gameTypeId = await ctx.db.insert("gameTypes", {
        title: "Predictions",
        description: "Synthetic",
        lookupId: "predictions",
        normalizedLookupId: "predictions",
      });
      const seasonId = await ctx.db.insert("seasons", {
        title: "Season",
        gameTypeId,
      });
      const winningGuessId = await ctx.db.insert("guesses", {
        ratingId: correctRatingId,
        createdAt: 1,
        userId: winnerId,
        assignmentReviewId,
        seasonId,
      });
      await ctx.db.insert("guesses", {
        ratingId: wrongRatingId,
        createdAt: 2,
        userId: winnerId,
        assignmentReviewId,
        seasonId,
      });
      const gamblingTypeId = await ctx.db.insert("gamblingTypes", {
        lookupId: "default",
        normalizedLookupId: "default",
        title: "Default",
        multiplier: 2,
        isActive: true,
        createdAt: 1,
      });
      const gamblingWinnerId = await ctx.db.insert("gamblingEntries", {
        userId: winnerId,
        assignmentId,
        points: 5,
        createdAt: 1,
        gamblingTypeId,
        status: "won",
      });
      await ctx.db.insert("gamblingEntries", {
        userId: winnerId,
        assignmentId,
        points: 7,
        createdAt: 2,
        gamblingTypeId,
        status: "lost",
      });
      return {
        gamblingWinnerId,
        hostId,
        movieId,
        winnerId,
        winningGuessId,
      };
    });

    const result = await t.query(api.episodes.public.results, { episodeId });

    expect(result).toEqual({
      gamblingWinners: [
        {
          id: expected.gamblingWinnerId,
          user: {
            id: expected.winnerId,
            name: "Winner",
            image: null,
          },
          points: 5,
          gamblingType: {
            title: "Default",
            multiplier: 2,
          },
          movie: {
            id: expected.movieId,
            title: "Results Movie",
            year: 2026,
            poster: null,
            url: "https://movies.example/results",
            tmdbId: null,
          },
        },
      ],
      guessWinners: [
        {
          id: expected.winningGuessId,
          user: {
            id: expected.winnerId,
            name: "Winner",
            image: null,
          },
          host: {
            id: expected.hostId,
            name: "Host",
            image: null,
          },
          actualRating: 4,
          movie: {
            id: expected.movieId,
            title: "Results Movie",
            year: 2026,
            poster: null,
            url: "https://movies.example/results",
            tmdbId: null,
          },
        },
      ],
    });
    expect(Object.keys(result.gamblingWinners[0]?.user ?? {})).not.toContain(
      "email",
    );
  });

  test("fails closed when public episode results are corrupt or oversized", async () => {
    const missingUser = createTestBackend();
    const missingUserEpisodeId = await seedEpisode(missingUser, { number: 13 });
    await missingUser.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const movieId = await ctx.db.insert("movies", {
        title: "Missing User Movie",
        normalizedTitle: "missing user movie",
        year: 2026,
        url: "https://movies.example/missing-user",
      });
      const assignmentId = await ctx.db.insert("assignments", {
        episodeId: missingUserEpisodeId,
        userId,
        movieId,
        type: "HOMEWORK",
        playable: true,
      });
      const gamblingTypeId = await ctx.db.insert("gamblingTypes", {
        lookupId: "default",
        normalizedLookupId: "default",
        title: "Default",
        multiplier: 2,
        isActive: true,
        createdAt: 1,
      });
      await ctx.db.insert("gamblingEntries", {
        userId,
        assignmentId,
        points: 1,
        createdAt: 1,
        gamblingTypeId,
        status: "won",
      });
      await ctx.db.delete("users", userId);
    });
    await expectDomainError(
      missingUser.query(api.episodes.public.results, {
        episodeId: missingUserEpisodeId,
      }),
      "CONFLICT",
    );

    const oversized = createTestBackend();
    const oversizedEpisodeId = await seedEpisode(oversized, {
      number: 14,
    });
    await oversized.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const movieId = await ctx.db.insert("movies", {
        title: "Oversized Movie",
        normalizedTitle: "oversized movie",
        year: 2026,
        url: "https://movies.example/oversized",
      });
      const assignmentId = await ctx.db.insert("assignments", {
        episodeId: oversizedEpisodeId,
        userId,
        movieId,
        type: "HOMEWORK",
        playable: true,
      });
      const gamblingTypeId = await ctx.db.insert("gamblingTypes", {
        lookupId: "default",
        normalizedLookupId: "default",
        title: "Default",
        multiplier: 2,
        isActive: true,
        createdAt: 1,
      });
      for (let index = 0; index < 51; index += 1) {
        await ctx.db.insert("gamblingEntries", {
          userId,
          assignmentId,
          points: index,
          createdAt: index,
          gamblingTypeId,
          status: "won",
        });
      }
    });
    await expectDomainError(
      oversized.query(api.episodes.public.results, {
        episodeId: oversizedEpisodeId,
      }),
      "CONFLICT",
    );
  });
});
