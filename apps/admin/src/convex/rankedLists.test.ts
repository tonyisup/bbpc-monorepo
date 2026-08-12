import type { ConvexReactClient } from "convex/react";
import { describe, expect, test, vi } from "vitest";

import { BBPC_CLIENT_API_VERSION } from "./identity";
import {
  ADMIN_RANKED_LISTS_PAGE_SIZE,
  changeConvexRankedListOwner,
  createMyConvexRankedList,
  deleteConvexRankedList,
  loadConvexAdminRankedListsPage,
  loadConvexRankedList,
  loadMyConvexRankedLists,
  moveConvexRankedItem,
  removeConvexRankedItem,
  updateConvexRankedList,
  upsertConvexRankedItem,
} from "./rankedLists";

const type = {
  id: "type-1",
  name: "Top movies",
  description: null,
  maxItems: 10,
  targetType: "MOVIE" as const,
  createdAt: 1,
  updatedAt: 2,
};

const owner = {
  id: "user-1",
  name: "Example User",
  image: null,
};

const movie = {
  id: "movie-1",
  title: "Arrival",
  year: 2016,
  poster: null,
  url: "https://example.invalid/arrival",
  tmdbId: 329865,
};

const item = {
  id: "item-1",
  rankedListId: "list-1",
  targetType: "movie" as const,
  movieId: movie.id,
  showId: null,
  episodeId: null,
  movie,
  show: null,
  episode: null,
  rank: 1,
  comment: null,
  createdAt: 1,
  updatedAt: 2,
};

const summary = {
  id: "list-1",
  userId: owner.id,
  rankedListTypeId: type.id,
  status: "DRAFT" as const,
  title: null,
  createdAt: 1,
  updatedAt: 2,
  user: owner,
  type,
  itemCount: 1,
};

const detail = {
  ...summary,
  items: [item],
};

describe("Convex ranked-list adapter", () => {
  test("validates owner and paginated administrator reads", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([summary])
      .mockResolvedValueOnce({
        page: [summary],
        isDone: true,
        continueCursor: "done",
      })
      .mockResolvedValueOnce(detail);
    const client = { query } as unknown as ConvexReactClient;

    await expect(loadMyConvexRankedLists(client)).resolves.toEqual([summary]);
    await expect(
      loadConvexAdminRankedListsPage(client, null)
    ).resolves.toEqual({
      lists: [summary],
      isDone: true,
      continueCursor: "done",
    });
    await expect(loadConvexRankedList(client, detail.id)).resolves.toEqual(
      detail
    );
    expect(query).toHaveBeenNthCalledWith(2, expect.anything(), {
      paginationOpts: {
        cursor: null,
        numItems: ADMIN_RANKED_LISTS_PAGE_SIZE,
      },
    });
  });

  test("versions list and item writes", async () => {
    const mutation = vi
      .fn()
      .mockResolvedValueOnce(detail)
      .mockResolvedValueOnce({ ...detail, title: "Favorites" })
      .mockResolvedValueOnce(detail)
      .mockResolvedValueOnce(item)
      .mockResolvedValueOnce(item)
      .mockResolvedValueOnce({ id: item.id, rank: 1 })
      .mockResolvedValueOnce({ id: detail.id, deletedItems: 1 });
    const client = { mutation } as unknown as ConvexReactClient;

    await createMyConvexRankedList(client, type.id);
    await updateConvexRankedList(client, detail.id, { title: "Favorites" });
    await changeConvexRankedListOwner(client, detail.id, "user-2");
    await upsertConvexRankedItem(client, {
      rankedListId: detail.id,
      target: { kind: "movie", id: movie.id },
      rank: 1,
    });
    await moveConvexRankedItem(client, item.id, 2);
    await removeConvexRankedItem(client, item.id);
    await expect(
      deleteConvexRankedList(client, detail.id)
    ).resolves.toBe(1);

    for (const call of mutation.mock.calls) {
      expect(call[1]).toEqual(
        expect.objectContaining({
          clientApiVersion: BBPC_CLIENT_API_VERSION,
        })
      );
    }
  });

  test("rejects cross-target response drift", async () => {
    const query = vi.fn().mockResolvedValue({
      ...detail,
      items: [{ ...item, showId: "show-1" }],
    });
    const client = { query } as unknown as ConvexReactClient;

    await expect(loadConvexRankedList(client, detail.id)).rejects.toThrow();
  });
});
