import type { ConvexReactClient } from "convex/react";
import { describe, expect, test, vi } from "vitest";

import {
  createConvexAdminMerchItem,
  deleteConvexAdminMerchItem,
  loadConvexAdminMerchItems,
  moveConvexAdminMerchItem,
  setConvexAdminMerchItemVisible,
  updateConvexAdminMerchItem,
} from "./merch";
import { BBPC_CLIENT_API_VERSION } from "./identity";

const item = {
  id: "merch-1",
  title: "Bad Boys Logo Tee",
  description: null,
  url: "https://www.teepublic.com/t-shirt/1-bad-boys-logo",
  imageUrl: null,
  priceLabel: "From $22",
  badge: null,
  featured: false,
  visible: true,
  sortOrder: 0,
  createdAt: 500,
  updatedAt: 500,
};

const input = {
  title: item.title,
  description: "Classic logo.",
  url: item.url,
  imageUrl: "https://images.example.test/tee.jpg",
  priceLabel: item.priceLabel,
  badge: "New",
  featured: true,
  visible: true,
};

describe("Convex admin merch adapter", () => {
  test("validates the item list", async () => {
    const query = vi.fn().mockResolvedValueOnce([item]);
    const client = { query } as unknown as ConvexReactClient;

    await expect(loadConvexAdminMerchItems(client)).resolves.toEqual([item]);
    expect(query).toHaveBeenCalledWith(expect.anything(), {});

    query.mockResolvedValueOnce([{ ...item, visible: "yes" }]);
    await expect(loadConvexAdminMerchItems(client)).rejects.toThrow();
  });

  test("versions every merch write", async () => {
    const mutation = vi
      .fn()
      .mockResolvedValueOnce(item)
      .mockResolvedValueOnce(item)
      .mockResolvedValueOnce(item)
      .mockResolvedValueOnce([item])
      .mockResolvedValueOnce({ id: item.id });
    const client = { mutation } as unknown as ConvexReactClient;

    await createConvexAdminMerchItem(client, input);
    await updateConvexAdminMerchItem(client, item.id, input);
    await setConvexAdminMerchItemVisible(client, item.id, false);
    await expect(
      moveConvexAdminMerchItem(client, item.id, "down")
    ).resolves.toEqual([item]);
    await deleteConvexAdminMerchItem(client, item.id);

    expect(mutation.mock.calls.map((call) => call[1] as unknown)).toEqual([
      { clientApiVersion: BBPC_CLIENT_API_VERSION, ...input },
      { clientApiVersion: BBPC_CLIENT_API_VERSION, id: item.id, ...input },
      { clientApiVersion: BBPC_CLIENT_API_VERSION, id: item.id, visible: false },
      {
        clientApiVersion: BBPC_CLIENT_API_VERSION,
        id: item.id,
        direction: "down",
      },
      { clientApiVersion: BBPC_CLIENT_API_VERSION, id: item.id },
    ]);
  });
});
