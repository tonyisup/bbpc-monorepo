import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

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
});
