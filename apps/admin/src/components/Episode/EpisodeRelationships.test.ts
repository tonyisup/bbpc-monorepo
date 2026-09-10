import { describe, expect, test } from "vitest";

import type { ConvexTmdbTitle } from "@/convex/catalog";

import { fetchAssignmentMovieSearchResults } from "./assignmentMovieSearch";

describe("assignment movie search", () => {
  test("passes the explicit request query through without synthesizing results", async () => {
    const arrival = { id: 329865 } as ConvexTmdbTitle;
    let receivedQuery = "";

    await expect(
      fetchAssignmentMovieSearchResults("Arrival y:2016", async (query) => {
        receivedQuery = query;
        return [arrival];
      }),
    ).resolves.toEqual([arrival]);
    expect(receivedQuery).toBe("Arrival y:2016");

    await expect(
      fetchAssignmentMovieSearchResults("Arrival", async () => {
        throw new Error("TMDB unavailable");
      }),
    ).rejects.toThrow("TMDB unavailable");
  });
});
