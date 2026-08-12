import type { ConvexReactClient } from "convex/react";
import { describe, expect, test, vi } from "vitest";

import { loadConvexAdminDashboard } from "./dashboard";

const emptyDashboard = {
  counts: {
    episodes: 0,
    users: 0,
    movies: 0,
    reviews: 0,
  },
  latestEpisode: null,
  upcomingEpisode: null,
  latestSyllabus: [],
  guessStats: [],
};

describe("Convex admin dashboard adapter", () => {
  test("loads and validates the overview contract", async () => {
    const query = vi.fn().mockResolvedValue(emptyDashboard);
    const client = { query } as unknown as ConvexReactClient;

    await expect(loadConvexAdminDashboard(client)).resolves.toEqual(
      emptyDashboard
    );
    expect(query).toHaveBeenCalledWith(expect.anything(), {});
  });

  test("rejects a drifted server response", async () => {
    const query = vi.fn().mockResolvedValue({
      ...emptyDashboard,
      counts: { ...emptyDashboard.counts, episodes: "0" },
    });
    const client = { query } as unknown as ConvexReactClient;

    await expect(loadConvexAdminDashboard(client)).rejects.toThrow();
  });
});
