import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchPublicQuery: vi.fn<(reference: unknown, args: unknown) => unknown>(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/server/convex/client", () => ({
  fetchPublicQuery: mocks.fetchPublicQuery,
}));

vi.mock("@tonyisup/bbpc-convex-api", () => ({
  api: {
    games: {
      public: {
        currentPerformance: "currentPerformance",
        predictionScoring: "predictionScoring",
      },
    },
  },
}));

import { getConvexCurrentPerformance } from "@/server/convex/games";

const season = { id: "season-1", title: "Season 5", endedOn: null };

describe("getConvexCurrentPerformance", () => {
  beforeEach(() => {
    mocks.fetchPublicQuery.mockReset();
  });

  test("passes season length and recorded episodes through", async () => {
    mocks.fetchPublicQuery.mockResolvedValue({
      season: { ...season, episodeCount: 20 },
      recordedEpisodeCount: 7,
      userSummary: [],
      points: [],
    });

    await expect(getConvexCurrentPerformance("2026-09-23")).resolves.toEqual({
      season: { ...season, episodeCount: 20 },
      recordedEpisodeCount: 7,
      userSummary: [],
      points: [],
    });
    expect(mocks.fetchPublicQuery).toHaveBeenCalledWith("currentPerformance", {
      today: "2026-09-23",
    });
  });

  test("reads a backend without season lengths as having none", async () => {
    mocks.fetchPublicQuery.mockResolvedValue({
      season,
      userSummary: [],
      points: [],
    });

    await expect(
      getConvexCurrentPerformance("2026-09-23")
    ).resolves.toMatchObject({
      season: { episodeCount: null },
      recordedEpisodeCount: null,
    });
  });
});
