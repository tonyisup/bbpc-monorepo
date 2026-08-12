import type { ConvexReactClient } from "convex/react";
import { describe, expect, test, vi } from "vitest";

import { BBPC_CLIENT_API_VERSION } from "./identity";
import {
  createConvexAdminRankingType,
  deleteConvexAdminRankingType,
  loadConvexAdminRankingTypes,
  updateConvexAdminRankingType,
} from "./rankingTypes";

const rankingType = {
  id: "ranking-type-1",
  name: "Top movies",
  description: null,
  maxItems: 10,
  targetType: "MOVIE" as const,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

describe("Convex admin ranking-type adapter", () => {
  test("validates reads and versions every write", async () => {
    const query = vi.fn().mockResolvedValue([rankingType]);
    const mutation = vi
      .fn()
      .mockResolvedValueOnce(rankingType)
      .mockResolvedValueOnce({ ...rankingType, maxItems: 20 })
      .mockResolvedValueOnce({ id: rankingType.id });
    const client = { query, mutation } as unknown as ConvexReactClient;

    await expect(loadConvexAdminRankingTypes(client)).resolves.toEqual([
      rankingType,
    ]);
    await createConvexAdminRankingType(client, rankingType);
    await updateConvexAdminRankingType(client, rankingType.id, {
      ...rankingType,
      maxItems: 20,
    });
    await deleteConvexAdminRankingType(client, rankingType.id);

    for (const call of mutation.mock.calls) {
      expect(call[1]).toEqual(
        expect.objectContaining({
          clientApiVersion: BBPC_CLIENT_API_VERSION,
        })
      );
    }
  });

  test("rejects drifted target types", async () => {
    const query = vi
      .fn()
      .mockResolvedValue([{ ...rankingType, targetType: "BOOK" }]);
    const client = { query } as unknown as ConvexReactClient;

    await expect(loadConvexAdminRankingTypes(client)).rejects.toThrow();
  });
});
