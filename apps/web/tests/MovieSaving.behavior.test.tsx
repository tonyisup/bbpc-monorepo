import type { ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import { describe, expect, test, vi } from "vitest";

import { upsertConvexExtraMovie } from "../src/convex/extras";
import { upsertConvexTmdbMovie } from "../src/convex/syllabus";

const searchMovie = {
  id: 329865,
  title: "Arrival",
  poster_path: "https://images.example.test/arrival.jpg",
  release_date: "2016-11-11",
  imdb_path: null,
};
const saved = {
  id: "movie-1",
  title: "Arrival",
  year: 2016,
  poster: searchMovie.poster_path,
  url: "https://www.imdb.com/title/tt2543164/",
  tmdbId: 329865,
};

for (const save of [upsertConvexExtraMovie, upsertConvexTmdbMovie]) {
  describe(save.name, () => {
    test("resolves IMDb from details before saving a search result", async () => {
      const action = vi
        .fn()
        .mockResolvedValue({ id: searchMovie.id, imdb_id: "tt2543164" });
      const mutation = vi.fn().mockResolvedValue(saved);
      const client = { action, mutation } as unknown as ConvexReactClient;
      await expect(save(client, searchMovie, 2016)).resolves.toEqual(saved);
      expect(getFunctionName(action.mock.calls[0]![0])).toBe(
        "catalog/external:getMovie"
      );
      expect(action).toHaveBeenCalledWith(expect.anything(), {
        id: searchMovie.id,
      });
      expect(mutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          url: saved.url,
          tmdbId: searchMovie.id,
        })
      );
    });
    test("uses TMDB when IMDb is absent, but never saves after a failed or invalid lookup", async () => {
      const action = vi
        .fn()
        .mockResolvedValue({ id: searchMovie.id, imdb_id: null });
      const mutation = vi.fn().mockResolvedValue(saved);
      const client = { action, mutation } as unknown as ConvexReactClient;
      await save(client, searchMovie, 2016);
      expect(mutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          url: "https://www.themoviedb.org/movie/329865",
        })
      );
      action.mockRejectedValueOnce(new Error("Temporary TMDB failure"));
      await expect(save(client, searchMovie, 2016)).rejects.toThrow();
      action.mockResolvedValueOnce({ id: 123, imdb_id: "tt2543164" });
      await expect(save(client, searchMovie, 2016)).rejects.toThrow();
      action.mockResolvedValueOnce({
        id: searchMovie.id,
        imdb_id: "not-an-id",
      });
      await expect(save(client, searchMovie, 2016)).rejects.toThrow();
      expect(mutation).toHaveBeenCalledTimes(1);
    });
  });
}
