import type { ConvexReactClient } from "convex/react";
import { describe, expect, test, vi } from "vitest";

import { BBPC_CLIENT_API_VERSION } from "./identity";
import {
  ADMIN_REVIEWS_PAGE_SIZE,
  deleteConvexAdminReview,
  loadConvexAdminReviewsPage,
  loadConvexReviewDeleteImpact,
  setConvexAdminReviewRating,
} from "./reviews";

const rating = {
  id: "rating-1",
  name: "Good",
  value: 3,
  sound: null,
  icon: null,
  category: null,
};

const review = {
  id: "review-1",
  user: {
    id: "user-1",
    name: "Example User",
    image: null,
    status: "active" as const,
  },
  movie: {
    id: "movie-1",
    title: "Arrival",
    year: 2016,
    poster: null,
    url: "https://example.invalid/arrival",
    tmdbId: 329865,
  },
  show: null,
  rating,
  reviewedAt: 1_700_000_000_000,
  assignmentReviews: [],
  extraReviews: [],
};

const impact = {
  id: review.id,
  assignmentReviewCount: 1,
  extraReviewCount: 2,
  guessCount: 3,
};

describe("Convex admin review adapter", () => {
  test("validates native pages and indexed filters", async () => {
    const query = vi.fn().mockResolvedValue({
      page: [review],
      isDone: true,
      continueCursor: "done",
    });
    const client = { query } as unknown as ConvexReactClient;

    await expect(
      loadConvexAdminReviewsPage(client, null, {
        rating: { kind: "unrated" },
        userId: "user-1",
      })
    ).resolves.toEqual({
      reviews: [review],
      isDone: true,
      continueCursor: "done",
    });
    expect(query).toHaveBeenCalledWith(expect.anything(), {
      paginationOpts: {
        cursor: null,
        numItems: ADMIN_REVIEWS_PAGE_SIZE,
      },
      unrated: true,
      userId: "user-1",
    });
  });

  test("preflights and compare-and-swaps destructive review removal", async () => {
    const query = vi.fn().mockResolvedValue(impact);
    const mutation = vi
      .fn()
      .mockResolvedValueOnce({ ...review, rating: null })
      .mockResolvedValueOnce(impact);
    const client = { query, mutation } as unknown as ConvexReactClient;

    await expect(
      loadConvexReviewDeleteImpact(client, review.id)
    ).resolves.toEqual(impact);
    await setConvexAdminReviewRating(client, review.id, null);
    await expect(deleteConvexAdminReview(client, impact)).resolves.toEqual(
      impact
    );

    for (const call of mutation.mock.calls) {
      expect(call[1]).toEqual(
        expect.objectContaining({
          clientApiVersion: BBPC_CLIENT_API_VERSION,
        })
      );
    }
    expect(mutation).toHaveBeenLastCalledWith(expect.anything(), {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: review.id,
      expectedImpact: {
        assignmentReviewCount: 1,
        extraReviewCount: 2,
        guessCount: 3,
      },
    });
  });

  test("rejects cross-target review drift", async () => {
    const query = vi.fn().mockResolvedValue({
      page: [{ ...review, show: review.movie }],
      isDone: true,
      continueCursor: "done",
    });
    const client = { query } as unknown as ConvexReactClient;

    await expect(
      loadConvexAdminReviewsPage(client, null, {
        rating: { kind: "all" },
        userId: null,
      })
    ).rejects.toThrow();
  });
});
