import type { ConvexReactClient } from "convex/react";
import { describe, expect, test, vi } from "vitest";

import { BBPC_CLIENT_API_VERSION } from "./identity";
import {
  createConvexAdminRating,
  deleteConvexAdminRating,
  loadConvexAdminRatings,
  updateConvexAdminRating,
} from "./ratings";

const rating = {
  id: "rating-1",
  name: "Great",
  value: 4,
  sound: null,
  icon: null,
  category: "positive",
};

describe("Convex admin rating adapter", () => {
  test("validates reads and versions every write", async () => {
    const query = vi.fn().mockResolvedValue([rating]);
    const mutation = vi
      .fn()
      .mockResolvedValueOnce(rating)
      .mockResolvedValueOnce({ ...rating, value: 5 })
      .mockResolvedValueOnce({ id: rating.id });
    const client = { query, mutation } as unknown as ConvexReactClient;

    await expect(loadConvexAdminRatings(client)).resolves.toEqual([rating]);
    await createConvexAdminRating(client, rating);
    await updateConvexAdminRating(client, rating.id, {
      ...rating,
      value: 5,
    });
    await deleteConvexAdminRating(client, rating.id);

    for (const call of mutation.mock.calls) {
      expect(call[1]).toEqual(
        expect.objectContaining({
          clientApiVersion: BBPC_CLIENT_API_VERSION,
        })
      );
    }
  });

  test("rejects drifted rating responses", async () => {
    const query = vi.fn().mockResolvedValue([{ ...rating, value: "4" }]);
    const client = { query } as unknown as ConvexReactClient;

    await expect(loadConvexAdminRatings(client)).rejects.toThrow();
  });
});
