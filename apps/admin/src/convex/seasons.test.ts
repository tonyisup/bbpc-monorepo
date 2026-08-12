import type { ConvexReactClient } from "convex/react";
import { describe, expect, test, vi } from "vitest";

import { BBPC_CLIENT_API_VERSION } from "./identity";
import {
  ADMIN_SEASONS_PAGE_SIZE,
  createConvexAdminSeason,
  deleteConvexAdminSeason,
  loadConvexAdminGameTypes,
  loadConvexAdminSeasonsPage,
  updateConvexAdminSeason,
} from "./seasons";

const gameType = {
  id: "game-type-1",
  title: "Standard",
  description: null,
  lookupId: "standard",
};

const season = {
  id: "season-1",
  title: "Season One",
  description: null,
  startedOn: "2026-01-01",
  endedOn: null,
  gameType,
  counts: {
    points: { count: 0, isExact: true },
    guesses: { count: 0, isExact: true },
    gamblingEntries: { count: 0, isExact: true },
    quoteSubmissions: { count: 0, isExact: true },
  },
};

const input = {
  title: season.title,
  description: season.description,
  gameTypeId: gameType.id,
  startedOn: season.startedOn,
  endedOn: season.endedOn,
};

describe("Convex admin season adapter", () => {
  test("validates paginated reads and versions every write", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([gameType])
      .mockResolvedValueOnce({
        page: [season],
        isDone: true,
        continueCursor: "done",
      });
    const mutation = vi
      .fn()
      .mockResolvedValueOnce(season)
      .mockResolvedValueOnce({ ...season, title: "Updated" })
      .mockResolvedValueOnce({ id: season.id });
    const client = { query, mutation } as unknown as ConvexReactClient;

    await expect(loadConvexAdminGameTypes(client)).resolves.toEqual([gameType]);
    await expect(loadConvexAdminSeasonsPage(client, null)).resolves.toEqual({
      seasons: [season],
      isDone: true,
      continueCursor: "done",
    });
    expect(query).toHaveBeenNthCalledWith(2, expect.anything(), {
      paginationOpts: {
        cursor: null,
        numItems: ADMIN_SEASONS_PAGE_SIZE,
      },
    });

    await createConvexAdminSeason(client, input);
    await updateConvexAdminSeason(client, season.id, {
      ...input,
      title: "Updated",
    });
    await deleteConvexAdminSeason(client, season.id);
    for (const call of mutation.mock.calls) {
      expect(call[1]).toEqual(
        expect.objectContaining({
          clientApiVersion: BBPC_CLIENT_API_VERSION,
        })
      );
    }
  });

  test("rejects drifted season responses", async () => {
    const query = vi.fn().mockResolvedValue({
      page: [{ ...season, counts: null }],
      isDone: true,
      continueCursor: "done",
    });
    const client = { query } as unknown as ConvexReactClient;

    await expect(loadConvexAdminSeasonsPage(client, null)).rejects.toThrow();
  });
});
