import { expect, test } from "vitest";
import { prioritizeExactMovieMatches } from "./search-order";

test.each(["Arrival", "  ＡＲＲＩＶＡＬ y:2016  ", "y:2016 Arrival"])(
  "promotes normalized exact titles and preserves ties for %s",
  (query) => {
    const movies = Object.freeze([
      { id: 1, title: "Z Arrival" },
      { id: 2, title: "Arrival" },
      { id: 3, title: "A Arrival" },
      { id: 4, title: "ARRIVAL" },
    ]);
    expect(
      prioritizeExactMovieMatches(movies, query, (movie) => movie.title).map(
        (movie) => movie.id
      )
    ).toEqual([2, 4, 1, 3]);
    expect(movies.map((movie) => movie.id)).toEqual([1, 2, 3, 4]);
  }
);

test.each(["", "y:2016", "unmatched"])("preserves order for %s", (query) => {
  const titles = ["Z Arrival", "Arrival", "A Arrival"];
  expect(prioritizeExactMovieMatches(titles, query, (title) => title)).toEqual(
    titles
  );
});

test("keeps bare numeric movie titles searchable", () => {
  expect(
    prioritizeExactMovieMatches(
      ["1917: The Real Story", "1917"],
      "1917",
      (title) => title
    )
  ).toEqual(["1917", "1917: The Real Story"]);
});
