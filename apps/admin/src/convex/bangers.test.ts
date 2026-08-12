import type { ConvexReactClient } from "convex/react";
import { describe, expect, test, vi } from "vitest";

import {
  ADMIN_BANGERS_PAGE_SIZE,
  createConvexAdminBanger,
  deleteConvexAdminBanger,
  loadConvexAdminBangersPage,
  updateConvexAdminBanger,
} from "./bangers";
import { BBPC_CLIENT_API_VERSION } from "./identity";

const banger = {
  id: "banger-1",
  title: "A Song",
  artist: "An Artist",
  url: "https://example.invalid/song",
  episodeId: "episode-1",
  userId: "user-1",
  episode: {
    id: "episode-1",
    number: 10,
    title: "Episode Ten",
    status: "published",
  },
  user: {
    id: "user-1",
    name: "Example User",
    email: "user@example.invalid",
    image: null,
    status: "active" as const,
  },
};

const input = {
  title: banger.title,
  artist: banger.artist,
  url: banger.url,
  episodeId: banger.episodeId,
  userId: banger.userId,
};

describe("Convex Banger admin adapter", () => {
  test("validates native pages and versions CRUD writes", async () => {
    const query = vi.fn().mockResolvedValue({
      page: [banger],
      isDone: true,
      continueCursor: "done",
    });
    const mutation = vi
      .fn()
      .mockResolvedValueOnce(banger)
      .mockResolvedValueOnce({ ...banger, title: "Updated Song" })
      .mockResolvedValueOnce({ id: banger.id });
    const client = { query, mutation } as unknown as ConvexReactClient;

    await expect(loadConvexAdminBangersPage(client, null)).resolves.toEqual({
      bangers: [banger],
      isDone: true,
      continueCursor: "done",
    });
    expect(query).toHaveBeenCalledWith(expect.anything(), {
      paginationOpts: {
        cursor: null,
        numItems: ADMIN_BANGERS_PAGE_SIZE,
      },
    });

    await createConvexAdminBanger(client, input);
    await updateConvexAdminBanger(client, banger.id, {
      ...input,
      title: "Updated Song",
    });
    await deleteConvexAdminBanger(client, banger);

    for (const call of mutation.mock.calls) {
      expect(call[1]).toEqual(
        expect.objectContaining({
          clientApiVersion: BBPC_CLIENT_API_VERSION,
        })
      );
    }
    expect(mutation).toHaveBeenLastCalledWith(expect.anything(), {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: banger.id,
      expected: input,
    });
  });

  test("rejects drifted canonical relationships", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        page: [{ ...banger, episodeId: "different-episode" }],
        isDone: true,
        continueCursor: "done",
      })
      .mockResolvedValueOnce({
        page: [{ ...banger, user: null }],
        isDone: true,
        continueCursor: "done",
      });
    const client = { query } as unknown as ConvexReactClient;

    await expect(
      loadConvexAdminBangersPage(client, null)
    ).rejects.toThrow();
    await expect(
      loadConvexAdminBangersPage(client, null)
    ).rejects.toThrow();
  });
});
