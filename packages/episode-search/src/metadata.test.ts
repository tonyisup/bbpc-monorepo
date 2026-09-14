import { describe, expect, test } from "vitest";
import {
  createEpisodeSearch,
  mergeEpisodeSearchResults,
  searchEpisodeMetadata,
} from "./metadata";

const episodes = [
  { id: "title", title: "Underwater cinema", assignments: [], extras: [] },
  {
    id: "assignment",
    title: "Homework",
    assignments: [{ movie: { title: "Arrival" } }],
    extras: [],
  },
  {
    id: "movie",
    title: "Bonus",
    assignments: [],
    extras: [{ review: { movie: { title: "Interstellar" }, show: null } }],
  },
  {
    id: "show",
    title: "Extras",
    assignments: [],
    extras: [{ review: { movie: null, show: { title: "Severance" } } }],
  },
];
const index = createEpisodeSearch(episodes);

describe("listener and admin metadata parity", () => {
  test.each([
    ["CINEMA", "title"],
    ["Arrival", "assignment"],
    ["interstellar", "movie"],
    ["Severance", "show"],
  ])("matches %s case-insensitively", (query, id) => {
    expect(
      searchEpisodeMetadata(episodes, query, false, index).map(
        (row) => row.episode.id
      )
    ).toEqual([id]);
  });
  test("supports close spellings only when fuzzy search is enabled", () => {
    expect(
      searchEpisodeMetadata(episodes, "Interstelar", true, index)[0]?.episode.id
    ).toBe("movie");
    expect(
      searchEpisodeMetadata(episodes, "Interstelar", false, index)
    ).toEqual([]);
    expect(searchEpisodeMetadata(episodes, "  ", true, index)).toEqual([]);
  });
  test("deduplicates by canonical ID, preserving metadata order and attaching passages", () => {
    const first = episodes[0]!;
    const last = episodes[3]!;
    const passages = [{ start: 65, end: 80, text: "A remembered sentence." }];
    const rows = mergeEpisodeSearchResults([{ episode: first }], {
      results: [
        { episode: last, passages },
        { episode: first, passages },
      ],
      limited: false,
    });
    expect(rows.map((row) => row.episode.id)).toEqual([first.id, last.id]);
    expect(rows[0]?.passages).toEqual(passages);
  });
});
