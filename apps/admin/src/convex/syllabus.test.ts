import type { ConvexReactClient } from "convex/react";
import { describe, expect, test, vi } from "vitest";

import { BBPC_CLIENT_API_VERSION } from "./identity";
import {
  ADMIN_SYLLABUS_PAGE_SIZE,
  loadConvexAdminSyllabusPage,
  removeConvexAdminSyllabusEntry,
} from "./syllabus";

const entry = {
  id: "syllabus-1",
  order: 1,
  createdAt: 1_700_000_000_000,
  notes: null,
  movie: {
    id: "movie-1",
    title: "Movie",
    year: 2024,
    poster: null,
    url: "movie",
    tmdbId: 123,
  },
  assignment: {
    id: "assignment-1",
    type: "host",
    playable: false,
    slug: "assignment",
    episode: {
      id: "episode-1",
      number: 123,
      title: "Episode",
      status: "published",
      slug: "episode",
    },
  },
  user: {
    id: "user-1",
    name: "Host",
    email: "host@example.test",
    status: "active" as const,
  },
};

describe("Convex admin syllabus adapter", () => {
  test("validates native pagination and versions deletion", async () => {
    const query = vi.fn().mockResolvedValue({
      page: [entry],
      isDone: true,
      continueCursor: "done",
    });
    const mutation = vi.fn().mockResolvedValue({ id: entry.id });
    const client = { query, mutation } as unknown as ConvexReactClient;

    await expect(loadConvexAdminSyllabusPage(client, null)).resolves.toEqual({
      entries: [entry],
      isDone: true,
      continueCursor: "done",
    });
    expect(query).toHaveBeenCalledWith(expect.anything(), {
      paginationOpts: {
        cursor: null,
        numItems: ADMIN_SYLLABUS_PAGE_SIZE,
      },
    });

    await removeConvexAdminSyllabusEntry(client, entry.id);
    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: entry.id,
    });
  });

  test("rejects drifted syllabus relationships", async () => {
    const query = vi.fn().mockResolvedValue({
      page: [{ ...entry, movie: null }],
      isDone: true,
      continueCursor: "done",
    });
    const client = { query } as unknown as ConvexReactClient;

    await expect(loadConvexAdminSyllabusPage(client, null)).rejects.toThrow();
  });
});
