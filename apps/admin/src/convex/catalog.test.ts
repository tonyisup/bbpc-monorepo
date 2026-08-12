import type { ConvexReactClient } from "convex/react";
import { describe, expect, test, vi } from "vitest";

import {
  ADMIN_CATALOG_PAGE_SIZE,
  deleteConvexAdminMovie,
  deleteConvexAdminShow,
  loadConvexAdminMoviesPage,
  loadConvexAdminShowsPage,
  searchConvexCatalogMovies,
  searchConvexTmdbMovies,
  upsertConvexAdminMovie,
  upsertConvexAdminShow,
} from "./catalog";
import { BBPC_CLIENT_API_VERSION } from "./identity";

const movie = {
  id: "movie-1",
  title: "Arrival",
  year: 2016,
  poster: null,
  url: "https://www.themoviedb.org/movie/329865",
  tmdbId: 329865,
};

const show = {
  id: "show-1",
  title: "Severance",
  year: 2022,
  poster: null,
  url: "https://www.themoviedb.org/tv/95396",
};

const tmdbTitle = {
  id: 329865,
  title: "Arrival",
  backdrop_path: null,
  poster_path: "/arrival.jpg",
  overview: "First contact.",
  release_date: "2016-11-11",
  first_air_date: null,
  vote_average: 7.6,
  vote_count: 18_000,
  popularity: 25,
  media_type: "movie",
  imdb_id: "tt2543164",
  imdb_path: "https://www.imdb.com/title/tt2543164",
};

describe("Convex admin media catalog adapter", () => {
  test("validates bounded native movie and show pages", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        page: [movie],
        isDone: false,
        continueCursor: "movie-next",
      })
      .mockResolvedValueOnce({
        page: [show],
        isDone: true,
        continueCursor: "show-done",
      });
    const client = { query } as unknown as ConvexReactClient;

    await expect(loadConvexAdminMoviesPage(client, null)).resolves.toEqual({
      items: [movie],
      isDone: false,
      continueCursor: "movie-next",
    });
    await expect(loadConvexAdminShowsPage(client, "show-cursor")).resolves.toEqual(
      {
        items: [show],
        isDone: true,
        continueCursor: "show-done",
      }
    );
    expect(query).toHaveBeenNthCalledWith(1, expect.anything(), {
      paginationOpts: {
        cursor: null,
        numItems: ADMIN_CATALOG_PAGE_SIZE,
      },
    });
    expect(query).toHaveBeenNthCalledWith(2, expect.anything(), {
      paginationOpts: {
        cursor: "show-cursor",
        numItems: ADMIN_CATALOG_PAGE_SIZE,
      },
    });
  });

  test("validates TMDB search responses", async () => {
    const action = vi.fn().mockResolvedValue({
      page: 1,
      results: [tmdbTitle],
    });
    const client = { action } as unknown as ConvexReactClient;

    await expect(searchConvexTmdbMovies(client, "arrival")).resolves.toEqual([
      tmdbTitle,
    ]);
    expect(action).toHaveBeenCalledWith(expect.anything(), {
      query: "arrival",
      page: 1,
    });
  });

  test("keeps ranked-list target search inside the canonical catalog", async () => {
    const query = vi.fn().mockResolvedValue([movie]);
    const client = { query } as unknown as ConvexReactClient;

    await expect(
      searchConvexCatalogMovies(client, "arrival")
    ).resolves.toEqual([movie]);
    expect(query).toHaveBeenCalledWith(expect.anything(), {
      query: "arrival",
      limit: 10,
    });
  });

  test("versions every catalog write and preserves the TMDB movie ID", async () => {
    const mutation = vi
      .fn()
      .mockResolvedValueOnce(movie)
      .mockResolvedValueOnce(show)
      .mockResolvedValueOnce({ id: movie.id })
      .mockResolvedValueOnce({ id: show.id });
    const client = { mutation } as unknown as ConvexReactClient;

    await upsertConvexAdminMovie(client, tmdbTitle);
    await upsertConvexAdminShow(client, {
      ...tmdbTitle,
      id: 95396,
      title: "Severance",
      release_date: "",
      first_air_date: "2022-02-18",
    });
    await deleteConvexAdminMovie(client, movie.id);
    await deleteConvexAdminShow(client, show.id);

    expect(mutation).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        clientApiVersion: BBPC_CLIENT_API_VERSION,
        tmdbId: tmdbTitle.id,
        year: 2016,
      })
    );
    expect(mutation).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        clientApiVersion: BBPC_CLIENT_API_VERSION,
        year: 2022,
      })
    );
    for (const call of mutation.mock.calls) {
      expect(call[1]).toEqual(
        expect.objectContaining({
          clientApiVersion: BBPC_CLIENT_API_VERSION,
        })
      );
    }
  });

  test("rejects drifted catalog rows and TMDB payloads", async () => {
    const query = vi.fn().mockResolvedValue({
      page: [{ ...movie, tmdbId: "329865" }],
      isDone: true,
      continueCursor: "done",
    });
    const action = vi.fn().mockResolvedValue({
      page: 1,
      results: [{ ...tmdbTitle, poster_path: 123 }],
    });
    const client = { query, action } as unknown as ConvexReactClient;

    await expect(loadConvexAdminMoviesPage(client, null)).rejects.toThrow();
    await expect(searchConvexTmdbMovies(client, "arrival")).rejects.toThrow();
  });
});
