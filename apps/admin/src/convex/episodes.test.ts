import type { ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import { describe, expect, test, vi } from "vitest";

import { BBPC_CLIENT_API_VERSION } from "./identity";
import {
  ADMIN_EPISODES_PAGE_SIZE,
  createConvexAdminEpisode,
  loadConvexAdminEpisodesPage,
  loadConvexAdminEpisodeSearchCatalog,
  searchConvexAdminEpisodeTranscripts,
  searchConvexAdminEpisodes,
} from "./episodes";

const episode = {
  id: "episode-1",
  number: 123,
  title: "Episode",
  recording: null,
  date: "2026-07-24",
  description: null,
  status: "pending",
  slug: "episode-123",
  assignments: [],
  extras: [],
  links: [],
};

describe("Convex admin episode catalog adapter", () => {
  test("validates native pagination and versions creation", async () => {
    const query = vi.fn().mockResolvedValue({
      page: [episode],
      isDone: true,
      continueCursor: "done",
    });
    const mutation = vi.fn().mockResolvedValue(episode);
    const client = { query, mutation } as unknown as ConvexReactClient;

    await expect(loadConvexAdminEpisodesPage(client, null)).resolves.toEqual({
      episodes: [episode],
      isDone: true,
      continueCursor: "done",
    });
    expect(query).toHaveBeenCalledWith(expect.anything(), {
      paginationOpts: {
        cursor: null,
        numItems: ADMIN_EPISODES_PAGE_SIZE,
      },
    });
    const listCall = query.mock.calls[0];
    if (listCall === undefined) {
      throw new Error("Expected the episode list query to run.");
    }
    expect(getFunctionName(listCall[0])).toBe("episodes/admin:listPage");

    await createConvexAdminEpisode(client, {
      number: episode.number,
      title: episode.title,
    });
    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      number: episode.number,
      title: episode.title,
    });
  });

  test("rejects drifted episode relationship collections", async () => {
    const query = vi.fn().mockResolvedValue({
      page: [{ ...episode, assignments: null }],
      isDone: true,
      continueCursor: "done",
    });
    const client = { query } as unknown as ConvexReactClient;

    await expect(loadConvexAdminEpisodesPage(client, null)).rejects.toThrow();
  });

  test("validates bounded episode target search", async () => {
    const query = vi.fn().mockResolvedValue([episode]);
    const client = { query } as unknown as ConvexReactClient;

    await expect(searchConvexAdminEpisodes(client, "episode")).resolves.toEqual(
      [episode]
    );
    expect(query).toHaveBeenCalledWith(expect.anything(), {
      query: "episode",
      limit: 10,
    });
  });

  test("search catalog follows every admin page and deduplicates canonical IDs", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        page: [episode],
        isDone: false,
        continueCursor: "next",
      })
      .mockResolvedValueOnce({
        page: [episode, { ...episode, id: "episode-2", status: "recording" }],
        isDone: true,
        continueCursor: "done",
      });
    const client = { query } as unknown as ConvexReactClient;
    const result = await loadConvexAdminEpisodeSearchCatalog(
      client,
      new AbortController().signal
    );
    expect(result.map((row) => row.id)).toEqual(["episode-1", "episode-2"]);
    expect(query.mock.calls.map((call) => getFunctionName(call[0]))).toEqual([
      "episodes/admin:listPage",
      "episodes/admin:listPage",
    ]);
    expect(query.mock.calls[1]?.[1].paginationOpts.cursor).toBe("next");
  });

  test("rejects incomplete catalogs and stops pagination after cancellation", async () => {
    const query = vi
      .fn()
      .mockResolvedValue({
        page: [episode],
        isDone: false,
        continueCursor: "repeated",
      });
    const client = { query } as unknown as ConvexReactClient;
    await expect(
      loadConvexAdminEpisodeSearchCatalog(client, new AbortController().signal)
    ).rejects.toThrow("did not advance");
    expect(query).toHaveBeenCalledTimes(2);
    const controller = new AbortController();
    query.mockImplementationOnce(async () => {
      controller.abort();
      return { page: [episode], isDone: false, continueCursor: "next" };
    });
    await expect(
      loadConvexAdminEpisodeSearchCatalog(client, controller.signal)
    ).rejects.toThrow();
    expect(query).toHaveBeenCalledTimes(3);
  });

  test("validates the existing transcript search contract and canonical episode ID", async () => {
    const response = {
      results: [{ episode, passages: [{ start: 65, end: 80, text: "Hello" }] }],
      limited: true,
    };
    const query = vi.fn().mockResolvedValue(response);
    const client = { query } as unknown as ConvexReactClient;
    await expect(
      searchConvexAdminEpisodeTranscripts(client, "hello")
    ).resolves.toEqual(response);
    expect(getFunctionName(query.mock.calls[0]?.[0])).toBe(
      "episodes/transcripts:search"
    );
    query.mockResolvedValue({
      ...response,
      results: [{ episode, passages: [{ start: -1, end: 80, text: "Hello" }] }],
    });
    await expect(
      searchConvexAdminEpisodeTranscripts(client, "hello")
    ).rejects.toThrow();
  });
});
