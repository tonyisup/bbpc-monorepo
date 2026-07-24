/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";
import { MAX_PUBLIC_YEAR_REVIEWS } from "./reviews/limits.js";

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
  title: string,
  year: number,
): Promise<Id<"movies">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("movies", {
      title,
      normalizedTitle: title.toLowerCase(),
      year,
      url: `https://movies.example/${encodeURIComponent(title)}`,
      poster: `https://images.example/${encodeURIComponent(title)}.jpg`,
    });
  });
}

describe("public year movie reviews", () => {
  test("returns a privacy-minimized anonymous archive with deterministic episode preference", async () => {
    const t = createTestBackend();
    const [movieId, oldMovieId] = await Promise.all([
      seedMovie(t, "Current Movie", 2026),
      seedMovie(t, "Old Movie", 1999),
    ]);
    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        name: "Public Host",
        email: "private@example.test",
        normalizedEmail: "private@example.test",
        image: "https://images.example/host.jpg",
        status: "active",
        createdAt: 1,
        updatedAt: 2,
      });
      const ratingId = await ctx.db.insert("ratings", {
        name: "Slater",
        value: 4,
      });
      const assignmentEpisodeId = await ctx.db.insert("episodes", {
        number: 10,
        title: "Assignment Episode",
        slug: "assignment-episode",
      });
      const extraEpisodeId = await ctx.db.insert("episodes", {
        number: 11,
        title: "Extra Episode",
        slug: "extra-episode",
      });
      const assignmentId = await ctx.db.insert("assignments", {
        userId,
        episodeId: assignmentEpisodeId,
        movieId,
        type: "HOMEWORK",
        playable: true,
      });
      const reviewId = await ctx.db.insert("reviews", {
        userId,
        movieId,
        ratingId,
        reviewedAt: Date.UTC(2026, 5, 1),
      });
      await ctx.db.insert("assignmentReviews", {
        assignmentId,
        reviewId,
      });
      await ctx.db.insert("extraReviews", {
        episodeId: extraEpisodeId,
        reviewId,
      });
      await ctx.db.insert("reviews", {
        userId,
        movieId: oldMovieId,
        reviewedAt: Date.UTC(2026, 6, 1),
      });
      await ctx.db.insert("reviews", {
        userId,
        movieId,
        reviewedAt: Date.UTC(2025, 6, 1),
      });
      return { extraEpisodeId, movieId, ratingId, reviewId, userId };
    });

    const reviews = await t.query(
      api.reviews.public.listMovieReviewsForYear,
      { year: 2026 },
    );

    expect(reviews).toEqual([
      {
        id: ids.reviewId,
        movie: {
          id: ids.movieId,
          title: "Current Movie",
          year: 2026,
          poster: "https://images.example/Current%20Movie.jpg",
          url: "https://movies.example/Current%20Movie",
          tmdbId: null,
        },
        user: {
          id: ids.userId,
          name: "Public Host",
          image: "https://images.example/host.jpg",
        },
        rating: {
          id: ids.ratingId,
          name: "Slater",
          value: 4,
          category: null,
          icon: null,
          sound: null,
        },
        episode: {
          id: ids.extraEpisodeId,
          number: 11,
          title: "Extra Episode",
          status: null,
          slug: "extra-episode",
        },
        reviewedAt: Date.UTC(2026, 5, 1),
      },
    ]);
    expect(Object.keys(reviews[0]?.user ?? {}).sort()).toEqual([
      "id",
      "image",
      "name",
    ]);
  });

  test("rejects invalid year selectors", async () => {
    const t = createTestBackend();
    for (const year of [1899, 2201, 2026.5]) {
      await expectDomainError(
        t.query(api.reviews.public.listMovieReviewsForYear, {
          year,
        }),
        "VALIDATION_FAILED",
      );
    }
  });

  test("falls back to assignment episodes and preserves relationship-free reviews", async () => {
    const t = createTestBackend();
    const movieId = await seedMovie(t, "Fallback Movie", 2026);
    const ids = await t.run(async (ctx) => {
      const assignmentOwnerId = await ctx.db.insert("users", {
        name: "Assignment Owner",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const episodeId = await ctx.db.insert("episodes", {
        number: 12,
        title: "Assignment Only",
      });
      const assignmentId = await ctx.db.insert("assignments", {
        userId: assignmentOwnerId,
        episodeId,
        movieId,
        type: "HOMEWORK",
        playable: true,
      });
      const assignmentReviewId = await ctx.db.insert("reviews", {
        movieId,
        reviewedAt: Date.UTC(2026, 2, 1),
      });
      await ctx.db.insert("assignmentReviews", {
        assignmentId,
        reviewId: assignmentReviewId,
      });
      const relationshipFreeReviewId = await ctx.db.insert(
        "reviews",
        {
          movieId,
          reviewedAt: Date.UTC(2026, 3, 1),
        },
      );
      return {
        assignmentReviewId,
        episodeId,
        relationshipFreeReviewId,
      };
    });

    const reviews = await t.query(
      api.reviews.public.listMovieReviewsForYear,
      { year: 2026 },
    );

    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toMatchObject({
      id: ids.relationshipFreeReviewId,
      user: null,
      rating: null,
      episode: null,
    });
    expect(reviews[1]).toMatchObject({
      id: ids.assignmentReviewId,
      user: null,
      rating: null,
      episode: {
        id: ids.episodeId,
        number: 12,
        title: "Assignment Only",
      },
    });
  });

  test("fails closed when a year exceeds the public review bound", async () => {
    const t = createTestBackend();
    const movieId = await seedMovie(t, "Overflow Movie", 2026);
    await t.run(async (ctx) => {
      for (
        let index = 0;
        index < MAX_PUBLIC_YEAR_REVIEWS + 1;
        index += 1
      ) {
        await ctx.db.insert("reviews", {
          movieId,
          reviewedAt: Date.UTC(2026, 0, 1) + index,
        });
      }
    });

    await expectDomainError(
      t.query(api.reviews.public.listMovieReviewsForYear, {
        year: 2026,
      }),
      "CONFLICT",
    );
  });
});
