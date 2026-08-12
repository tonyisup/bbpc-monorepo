import type { ConvexReactClient } from "convex/react";
import { describe, expect, test, vi } from "vitest";

import {
  loadConvexAdminSeasonDetail,
  loadConvexAdminSeasonGamblingPage,
  loadConvexAdminSeasonGuessesPage,
  loadConvexAdminSeasonPerformance,
  loadConvexAdminSeasonPointsPage,
} from "./seasonDetails";

const gameType = {
  id: "game-type-1",
  title: "League",
  description: null,
  lookupId: "league",
};

const season = {
  id: "season-1",
  title: "Season One",
  description: "The first season",
  startedOn: "2026-01-01",
  endedOn: null,
  gameType,
};

const adminSeason = {
  ...season,
  counts: {
    points: { count: 1, isExact: true },
    guesses: { count: 1, isExact: true },
    gamblingEntries: { count: 1, isExact: true },
    quoteSubmissions: { count: 0, isExact: true },
  },
};

const user = {
  id: "user-1",
  name: "Example User",
  image: null,
};

const point = {
  id: "point-1",
  user,
  season,
  reason: "Manual award",
  earnedAt: 100,
  adjustment: 3,
  gamePointType: null,
  total: 3,
};

const rating = {
  id: "rating-1",
  name: "Great",
  value: 4,
  sound: null,
  icon: null,
  category: null,
};

const movie = {
  id: "movie-1",
  title: "Arrival",
  year: 2016,
  poster: null,
  url: "https://example.invalid/arrival",
  tmdbId: 329865,
};

const episode = {
  id: "episode-1",
  number: 1,
  title: "Episode One",
  status: "published",
  slug: "episode-one",
};

const reviewUser = {
  ...user,
  status: "active" as const,
};

const guess = {
  id: "guess-1",
  createdAt: 110,
  user,
  rating,
  assignmentReview: {
    id: "assignment-review-1",
    assignment: {
      id: "assignment-1",
      type: "HOMEWORK",
      playable: true,
      episode,
    },
    review: {
      id: "review-1",
      user: reviewUser,
      movie,
      show: null,
      rating,
      reviewedAt: 90,
    },
  },
  season,
  point: null,
};

const gamblingEntry = {
  id: "gambling-1",
  points: 5,
  createdAt: 120,
  notes: null,
  status: "pending" as const,
  user,
  assignment: {
    id: "assignment-1",
    type: "HOMEWORK" as const,
    playable: true,
    slug: "assignment-1",
    user: reviewUser,
    movie,
    episode,
  },
  gamblingType: {
    id: "gambling-type-1",
    lookupId: "default",
    title: "Default wager",
    description: null,
    multiplier: 1.5,
    isActive: true,
    createdAt: 1,
  },
  targetUser: null,
  season,
  awardPoint: null,
};

function page<T>(item: T) {
  return {
    page: [item],
    isDone: true,
    continueCursor: "",
  };
}

describe("Convex season detail adapter", () => {
  test("validates bounded detail, performance, and activity pages", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(adminSeason)
      .mockResolvedValueOnce({
        userSummary: [
          {
            user,
            total: 3,
            guessCount: 1,
            gamblingCount: 1,
          },
        ],
        points: [{ userId: user.id, earnedAt: 100, pointValue: 3 }],
      })
      .mockResolvedValueOnce(page(point))
      .mockResolvedValueOnce(page(guess))
      .mockResolvedValueOnce(page(gamblingEntry));
    const client = { query } as unknown as ConvexReactClient;

    await expect(
      loadConvexAdminSeasonDetail(client, season.id)
    ).resolves.toEqual(adminSeason);
    await expect(
      loadConvexAdminSeasonPerformance(client, season.id)
    ).resolves.toMatchObject({ userSummary: [{ total: 3 }] });
    await expect(
      loadConvexAdminSeasonPointsPage(client, season.id, null)
    ).resolves.toMatchObject({ items: [{ id: point.id }], isDone: true });
    await expect(
      loadConvexAdminSeasonGuessesPage(client, season.id, null)
    ).resolves.toMatchObject({ items: [{ id: guess.id }], isDone: true });
    await expect(
      loadConvexAdminSeasonGamblingPage(client, season.id, null)
    ).resolves.toMatchObject({
      items: [{ id: gamblingEntry.id }],
      isDone: true,
    });
  });

  test("rejects cross-season activity and unknown performance users", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        userSummary: [],
        points: [{ userId: user.id, earnedAt: 100, pointValue: 3 }],
      })
      .mockResolvedValueOnce(
        page({ ...point, season: { ...season, id: "season-2" } })
      )
      .mockResolvedValueOnce(
        page({ ...guess, season: { ...season, id: "season-2" } })
      )
      .mockResolvedValueOnce(page({ ...gamblingEntry, season: null }));
    const client = { query } as unknown as ConvexReactClient;

    await expect(
      loadConvexAdminSeasonPerformance(client, season.id)
    ).rejects.toThrow();
    await expect(
      loadConvexAdminSeasonPointsPage(client, season.id, null)
    ).rejects.toThrow(/requested season/u);
    await expect(
      loadConvexAdminSeasonGuessesPage(client, season.id, null)
    ).rejects.toThrow(/requested season/u);
    await expect(
      loadConvexAdminSeasonGamblingPage(client, season.id, null)
    ).rejects.toThrow(/missing its season/u);
  });
});
