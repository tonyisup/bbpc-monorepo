import type { ConvexReactClient } from "convex/react";
import { describe, expect, test, vi } from "vitest";

import {
  loadConvexMovieDetail,
  loadConvexShowDetail,
} from "./mediaDetails";

const movie = {
  id: "movie-1",
  title: "Arrival",
  year: 2016,
  poster: null,
  url: "https://example.invalid/arrival",
  tmdbId: 329865,
};

const show = {
  id: "show-1",
  title: "Severance",
  year: 2022,
  poster: null,
  url: "https://example.invalid/severance",
};

const episode = {
  id: "episode-1",
  number: 10,
  title: "Episode Ten",
  status: "published",
  slug: "episode-ten",
};

const review = {
  id: "review-1",
  user: {
    id: "user-1",
    name: "Example User",
    image: null,
    status: "active" as const,
  },
  movie,
  show: null,
  rating: {
    id: "rating-1",
    name: "Great",
    value: 4,
    sound: null,
    icon: null,
    category: null,
  },
  reviewedAt: 100,
  assignmentReviews: [
    {
      id: "assignment-review-1",
      assignment: {
        id: "assignment-1",
        type: "HOST",
        playable: true,
        episode,
      },
    },
  ],
  extraReviews: [],
};

describe("Convex media detail adapter", () => {
  test("validates movie and show detail relationships", async () => {
    const showReview = {
      ...review,
      id: "review-2",
      movie: null,
      show,
      assignmentReviews: [],
      extraReviews: [
        {
          id: "extra-review-1",
          episode,
        },
      ],
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ media: movie, reviews: [review] })
      .mockResolvedValueOnce({ media: show, reviews: [showReview] })
      .mockResolvedValueOnce(null);
    const client = { query } as unknown as ConvexReactClient;

    await expect(loadConvexMovieDetail(client, movie.id)).resolves.toEqual({
      media: movie,
      reviews: [review],
    });
    await expect(loadConvexShowDetail(client, show.id)).resolves.toEqual({
      media: show,
      reviews: [showReview],
    });
    await expect(
      loadConvexMovieDetail(client, "missing")
    ).resolves.toBeNull();
  });

  test("rejects cross-target and malformed review responses", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        media: movie,
        reviews: [{ ...review, movie: null, show }],
      })
      .mockResolvedValueOnce({
        media: show,
        reviews: [{ ...review, movie: null, show: movie }],
      });
    const client = { query } as unknown as ConvexReactClient;

    await expect(loadConvexMovieDetail(client, movie.id)).rejects.toThrow();
    await expect(loadConvexShowDetail(client, show.id)).rejects.toThrow();
  });
});
