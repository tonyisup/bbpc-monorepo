import type { ConvexReactClient } from "convex/react";
import { describe, expect, test, vi } from "vitest";

import { BBPC_CLIENT_API_VERSION } from "./identity";
import {
  ADMIN_USERS_PAGE_SIZE,
  assignConvexAdminUserRole,
  createConvexAdminUser,
  loadConvexAdminUsersPage,
  removeConvexAdminUserRole,
  setConvexAdminUserStatus,
  updateConvexAdminUser,
} from "./users";

const role = {
  id: "role-1",
  legacyId: 1,
  name: "Host",
  description: "Podcast host",
  admin: false,
  permissions: [],
};

const membership = {
  id: "membership-1",
  assignedAt: 1,
  assignedBy: "user-admin",
  role,
};

const user = {
  id: "user-1",
  legacyId: "legacy-user",
  name: "Example User",
  email: "user@example.invalid",
  image: null,
  status: "active",
  createdAt: 1,
  updatedAt: 2,
  isAdmin: false,
  roles: [membership],
  nextSyllabus: null,
};

describe("Convex admin user adapter", () => {
  test("validates paginated reads and versions every write", async () => {
    const query = vi.fn().mockResolvedValue({
      page: [user],
      isDone: true,
      continueCursor: "done",
    });
    const mutation = vi
      .fn()
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce({ ...user, name: "Updated User" })
      .mockResolvedValueOnce({ ...user, status: "disabled" })
      .mockResolvedValueOnce(membership)
      .mockResolvedValueOnce({ id: membership.id });
    const client = { query, mutation } as unknown as ConvexReactClient;

    await expect(loadConvexAdminUsersPage(client, null)).resolves.toEqual({
      users: [user],
      isDone: true,
      continueCursor: "done",
    });
    expect(query).toHaveBeenCalledWith(expect.anything(), {
      paginationOpts: { cursor: null, numItems: ADMIN_USERS_PAGE_SIZE },
    });

    await createConvexAdminUser(client, {
      name: user.name,
      email: user.email,
    });
    await updateConvexAdminUser(client, user.id, {
      name: "Updated User",
      email: user.email,
    });
    await setConvexAdminUserStatus(client, user.id, "disabled");
    await assignConvexAdminUserRole(client, user.id, role.id);
    await removeConvexAdminUserRole(client, membership.id);

    for (const call of mutation.mock.calls) {
      expect(call[1]).toEqual(
        expect.objectContaining({
          clientApiVersion: BBPC_CLIENT_API_VERSION,
        })
      );
    }
  });

  test("rejects drifted user responses", async () => {
    const query = vi.fn().mockResolvedValue({
      page: [{ ...user, status: "archived" }],
      isDone: true,
      continueCursor: "done",
    });
    const client = { query } as unknown as ConvexReactClient;

    await expect(loadConvexAdminUsersPage(client, null)).rejects.toThrow();
  });
});
