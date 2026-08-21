import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

import type { ConvexTmdbTitle } from "@/convex/catalog";

import { fetchAssignmentMovieSearchResults } from "./assignmentMovieSearch";

const source = readFileSync(
  resolve(process.cwd(), "src/components/Episode/EpisodeRelationships.tsx"),
  "utf8"
);

describe("episode relationship assignment flow", () => {
  test("uses TMDB search and saves the selected movie before assignment creation", () => {
    const assignmentDialog = source.slice(
      source.indexOf("function AddAssignmentDialog"),
      source.indexOf("function AddExtraDialog")
    );

    expect(source).toContain("searchConvexAdminAssignmentMovies");
    expect(source).toContain("addConvexAdminEpisodeAssignmentFromTmdb");
    expect(source).toContain('placeholder="Search TMDB movies"');
    expect(assignmentDialog).toContain("<TmdbMoviePicker");
    expect(assignmentDialog).not.toContain("<CatalogPicker");
  });

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
