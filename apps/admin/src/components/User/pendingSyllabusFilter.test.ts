import { describe, expect, test } from "vitest";

import type { ConvexUserSyllabusEntry } from "@/convex/userDetails";

import { filterPendingSyllabus } from "./pendingSyllabusFilter";

function entry(
  id: string,
  title: string,
  year: number,
  notes: string | null = null
): ConvexUserSyllabusEntry {
  return {
    id,
    order: 0,
    createdAt: 0,
    notes,
    movie: {
      id: `movie-${id}`,
      title,
      year,
      poster: null,
      url: "",
      tmdbId: null,
    },
    assignment: null,
    user: { id: "user", name: null, email: null, status: "active" },
  };
}

const pending = [
  entry("a", "Arrival", 2016),
  entry("b", "Alien", 1979, "Director's cut"),
  entry("c", "Aliens", 1986),
];

describe("pending syllabus filter", () => {
  test("returns every entry with its queue index for a blank query", () => {
    expect(
      filterPendingSyllabus(pending, "  ").map((match) => match.queueIndex)
    ).toEqual([0, 1, 2]);
  });

  test("matches title case-insensitively and keeps queue indexes", () => {
    expect(
      filterPendingSyllabus(pending, "ALIEN").map((match) => [
        match.entry.id,
        match.queueIndex,
      ])
    ).toEqual([
      ["b", 1],
      ["c", 2],
    ]);
  });

  test("requires every term to match across title, year, and notes", () => {
    expect(
      filterPendingSyllabus(pending, "alien 1986").map((m) => m.entry.id)
    ).toEqual(["c"]);
    expect(
      filterPendingSyllabus(pending, "director").map((m) => m.entry.id)
    ).toEqual(["b"]);
    expect(filterPendingSyllabus(pending, "arrival 1979")).toEqual([]);
  });
});
