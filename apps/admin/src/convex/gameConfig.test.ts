import type { ConvexReactClient } from "convex/react";
import { describe, expect, test, vi } from "vitest";

import { BBPC_CLIENT_API_VERSION } from "./identity";
import {
  createConvexAdminGamblingType,
  createConvexAdminGamePointType,
  createConvexAdminGameType,
  deleteConvexAdminGamblingType,
  deleteConvexAdminGamePointType,
  deleteConvexAdminGameType,
  loadConvexAdminGameCatalog,
  updateConvexAdminGamblingType,
  updateConvexAdminGamePointType,
  updateConvexAdminGameType,
} from "./gameConfig";

const gameType = {
  id: "game-type-1",
  title: "Standard",
  description: null,
  lookupId: "standard",
};

const pointType = {
  id: "point-type-1",
  title: "Correct pick",
  description: null,
  lookupId: "correct-pick",
  points: 5,
  gameType,
};

const gamblingType = {
  id: "gambling-type-1",
  title: "Standard wager",
  description: null,
  lookupId: "standard-wager",
  multiplier: 1.5,
  isActive: true,
  createdAt: 1_700_000_000_000,
};

describe("Convex admin game configuration adapter", () => {
  test("validates all bounded catalogs", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([gameType])
      .mockResolvedValueOnce([pointType])
      .mockResolvedValueOnce([gamblingType]);
    const client = { query } as unknown as ConvexReactClient;

    await expect(loadConvexAdminGameCatalog(client)).resolves.toEqual({
      gameTypes: [gameType],
      pointTypes: [pointType],
      gamblingTypes: [gamblingType],
    });
  });

  test("versions every catalog write", async () => {
    const mutation = vi
      .fn()
      .mockResolvedValueOnce(gameType)
      .mockResolvedValueOnce({ ...gameType, title: "Updated game" })
      .mockResolvedValueOnce({ id: gameType.id })
      .mockResolvedValueOnce(pointType)
      .mockResolvedValueOnce({ ...pointType, title: "Updated point" })
      .mockResolvedValueOnce({ id: pointType.id })
      .mockResolvedValueOnce(gamblingType)
      .mockResolvedValueOnce({
        ...gamblingType,
        title: "Updated wager",
      })
      .mockResolvedValueOnce({ id: gamblingType.id });
    const client = { mutation } as unknown as ConvexReactClient;

    await createConvexAdminGameType(client, {
      title: gameType.title,
      description: null,
      lookupId: gameType.lookupId,
    });
    await updateConvexAdminGameType(client, gameType.id, {
      title: "Updated game",
      description: null,
      lookupId: gameType.lookupId,
    });
    await deleteConvexAdminGameType(client, gameType.id);
    await createConvexAdminGamePointType(client, {
      title: pointType.title,
      description: null,
      lookupId: pointType.lookupId,
      points: pointType.points,
      gameTypeId: gameType.id,
    });
    await updateConvexAdminGamePointType(client, pointType.id, {
      title: "Updated point",
      description: null,
      lookupId: pointType.lookupId,
      points: pointType.points,
      gameTypeId: gameType.id,
    });
    await deleteConvexAdminGamePointType(client, pointType.id);
    await createConvexAdminGamblingType(client, {
      title: gamblingType.title,
      description: null,
      lookupId: gamblingType.lookupId,
      multiplier: gamblingType.multiplier,
      isActive: gamblingType.isActive,
    });
    await updateConvexAdminGamblingType(client, gamblingType.id, {
      title: "Updated wager",
      description: null,
      lookupId: gamblingType.lookupId,
      multiplier: gamblingType.multiplier,
      isActive: gamblingType.isActive,
    });
    await deleteConvexAdminGamblingType(client, gamblingType.id);

    expect(mutation).toHaveBeenCalledTimes(9);
    for (const call of mutation.mock.calls) {
      expect(call[1]).toEqual(
        expect.objectContaining({
          clientApiVersion: BBPC_CLIENT_API_VERSION,
        })
      );
    }
  });

  test("rejects a drifted relationship", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([gameType])
      .mockResolvedValueOnce([{ ...pointType, gameType: null }])
      .mockResolvedValueOnce([gamblingType]);
    const client = { query } as unknown as ConvexReactClient;

    await expect(loadConvexAdminGameCatalog(client)).rejects.toThrow();
  });
});
