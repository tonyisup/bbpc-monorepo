import type { ConvexReactClient } from "convex/react";
import { describe, expect, test, vi } from "vitest";

import {
  createConvexAdminRole,
  deleteConvexAdminRole,
  loadConvexAdminRoles,
  updateConvexAdminRole,
} from "./roles";
import { BBPC_CLIENT_API_VERSION } from "./identity";

const role = {
  id: "role-1",
  legacyId: 1,
  name: "Host",
  description: "Podcast host",
  admin: false,
  permissions: [],
};

describe("Convex admin role adapter", () => {
  test("validates role reads and writes", async () => {
    const query = vi
      .fn()
      .mockResolvedValue([{ ...role, userCount: 2, userCountIsExact: true }]);
    const mutation = vi
      .fn()
      .mockResolvedValueOnce(role)
      .mockResolvedValueOnce({ ...role, description: "Updated" })
      .mockResolvedValueOnce({ id: role.id });
    const client = { query, mutation } as unknown as ConvexReactClient;

    await expect(loadConvexAdminRoles(client)).resolves.toHaveLength(1);
    await expect(
      createConvexAdminRole(client, {
        name: role.name,
        description: role.description,
        admin: role.admin,
      })
    ).resolves.toBeUndefined();
    await expect(
      updateConvexAdminRole(client, role.id, {
        name: role.name,
        description: "Updated",
        admin: role.admin,
      })
    ).resolves.toBeUndefined();
    await expect(
      deleteConvexAdminRole(client, role.id)
    ).resolves.toBeUndefined();
    expect(mutation).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        clientApiVersion: BBPC_CLIENT_API_VERSION,
      })
    );
    expect(mutation).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        clientApiVersion: BBPC_CLIENT_API_VERSION,
        id: role.id,
      })
    );
    expect(mutation).toHaveBeenNthCalledWith(3, expect.anything(), {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: role.id,
    });
  });

  test("rejects drifted role responses", async () => {
    const query = vi
      .fn()
      .mockResolvedValue([
        { ...role, admin: "false", userCount: 0, userCountIsExact: true },
      ]);
    const client = { query } as unknown as ConvexReactClient;

    await expect(loadConvexAdminRoles(client)).rejects.toThrow();
  });
});
