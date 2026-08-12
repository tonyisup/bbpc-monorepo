/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const ADMIN_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|identity-admin",
  issuer: "https://issuer.example.test",
  subject: "identity-admin",
};
const MEMBER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|identity-member",
  issuer: "https://issuer.example.test",
  subject: "identity-member",
};

function createTestBackend() {
  return convexTest(schema, modules);
}

type TestBackend = ReturnType<typeof createTestBackend>;

function requireValue<T>(
  value: T | null | undefined,
  message: string,
): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}

async function expectDomainError(
  promise: Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ConvexError);
    if (!(error instanceof ConvexError)) {
      throw error;
    }
    expect(error.data).toMatchObject({ code: expectedCode });
    return;
  }
  throw new Error(`Expected domain error ${expectedCode}`);
}

async function seedUser(
  t: TestBackend,
  input: {
    identity?: typeof ADMIN_IDENTITY;
    name: string;
    email: string;
  },
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: input.name,
      email: input.email,
      normalizedEmail: input.email.toLowerCase(),
      image: `https://images.example/${encodeURIComponent(input.name)}.png`,
      status: "active",
      createdAt: 1,
      updatedAt: 2,
    });
    if (input.identity !== undefined) {
      await ctx.db.insert("authIdentities", {
        ...input.identity,
        userId,
        linkedAt: 1,
        lastSeenAt: 2,
      });
    }
    return userId;
  });
}

async function seedRole(
  t: TestBackend,
  input: {
    name: string;
    admin?: boolean;
    legacyId?: number;
  },
): Promise<Id<"roles">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("roles", {
      name: input.name,
      normalizedName: input.name.toLowerCase(),
      description: `${input.name} role`,
      admin: input.admin ?? false,
      permissions:
        input.admin === true ? ["admin"] : ["member"],
      createdAt: 1,
      updatedAt: 1,
      ...(input.legacyId === undefined
        ? {}
        : { legacyId: input.legacyId }),
    });
  });
}

async function seedAdmin(
  t: TestBackend,
): Promise<{
  adminId: Id<"users">;
  adminRoleId: Id<"roles">;
}> {
  const adminId = await seedUser(t, {
    identity: ADMIN_IDENTITY,
    name: "Zed Admin",
    email: "zed@example.test",
  });
  const adminRoleId = await seedRole(t, {
    name: "Administrator",
    admin: true,
    legacyId: 1,
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("userRoles", {
      userId: adminId,
      roleId: adminRoleId,
      assignedAt: 1,
    });
  });
  return { adminId, adminRoleId };
}

describe("administrator identity reads", () => {
  test("requires an administrator for user and role administration", async () => {
    const t = createTestBackend();
    await seedAdmin(t);
    await seedUser(t, {
      identity: MEMBER_IDENTITY,
      name: "Member",
      email: "member@example.test",
    });

    await expectDomainError(
      t.query(api.identity.admin.listUsersPage, {
        paginationOpts: { cursor: null, numItems: 10 },
      }),
      "AUTHENTICATION_REQUIRED",
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.identity.admin.listRoles,
        {},
      ),
      "FORBIDDEN",
    );
  });

  test("paginates users by name with roles and the next unassigned syllabus item", async () => {
    const t = createTestBackend();
    const { adminId } = await seedAdmin(t);
    const memberId = await seedUser(t, {
      identity: MEMBER_IDENTITY,
      name: "Alice Member",
      email: "alice@example.test",
    });
    const memberRoleId = await seedRole(t, {
      name: "Member",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("userRoles", {
        userId: memberId,
        roleId: memberRoleId,
        assignedAt: 10,
        assignedBy: adminId,
      });
      const movieId = await ctx.db.insert("movies", {
        title: "Next Movie",
        normalizedTitle: "next movie",
        year: 2026,
        url: "https://movies.example/next",
      });
      const episodeId = await ctx.db.insert("episodes", {
        number: 1,
        title: "Episode One",
      });
      const assignmentId = await ctx.db.insert("assignments", {
        userId: memberId,
        episodeId,
        movieId,
        type: "HOMEWORK",
        playable: true,
      });
      await ctx.db.insert("syllabusEntries", {
        userId: memberId,
        movieId,
        order: 3,
        createdAt: 1,
        assignmentId,
      });
      await ctx.db.insert("syllabusEntries", {
        userId: memberId,
        movieId,
        order: 2,
        createdAt: 2,
        notes: "Watch next",
      });
    });

    const firstPage = await t.withIdentity(ADMIN_IDENTITY).query(
      api.identity.admin.listUsersPage,
      {
        paginationOpts: { cursor: null, numItems: 1 },
      },
    );
    expect(firstPage.page).toHaveLength(1);
    const listedUser = requireValue(
      firstPage.page[0],
      "Expected the first user page to contain one user",
    );
    expect(listedUser.id).toBe(memberId);
    expect(listedUser.name).toBe("Alice Member");
    expect(listedUser.email).toBe("alice@example.test");
    expect(listedUser.isAdmin).toBe(false);
    expect(listedUser.roles).toHaveLength(1);
    const listedRole = requireValue(
      listedUser.roles[0],
      "Expected the listed user to have one role",
    );
    expect(listedRole.assignedAt).toBe(10);
    expect(listedRole.assignedBy).toBe(adminId);
    expect(listedRole.role.name).toBe("Member");
    expect(listedRole.role.admin).toBe(false);
    expect(listedUser.nextSyllabus?.order).toBe(2);
    expect(listedUser.nextSyllabus?.notes).toBe("Watch next");
    expect(listedUser.nextSyllabus?.movie.title).toBe(
      "Next Movie",
    );
    expect(firstPage.isDone).toBe(false);
  });

  test("gets exact users and returns null for a deleted user", async () => {
    const t = createTestBackend();
    await seedAdmin(t);
    const memberId = await seedUser(t, {
      name: "Member",
      email: "member@example.test",
    });

    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.identity.admin.getUser,
        { id: memberId },
      ),
    ).resolves.toMatchObject({
      id: memberId,
      roles: [],
      nextSyllabus: null,
    });
    await t.run(async (ctx) => {
      await ctx.db.delete("users", memberId);
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.identity.admin.getUser,
        { id: memberId },
      ),
    ).resolves.toBeNull();
  });

  test("hydrates nullable user fields, admin status, and syllabus notes", async () => {
    const t = createTestBackend();
    const { adminId } = await seedAdmin(t);
    const sparseUserId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        status: "disabled",
        createdAt: 1,
        updatedAt: 1,
      });
      const movieId = await ctx.db.insert("movies", {
        title: "Sparse Movie",
        normalizedTitle: "sparse movie",
        year: 2026,
        url: "https://movies.example/sparse",
      });
      await ctx.db.insert("syllabusEntries", {
        userId,
        movieId,
        order: 1,
        createdAt: 1,
      });
      return userId;
    });

    const adminUser = await t.withIdentity(ADMIN_IDENTITY).query(
      api.identity.admin.getUser,
      { id: adminId },
    );
    expect(adminUser).not.toBeNull();
    const presentAdminUser = requireValue(
      adminUser,
      "Expected the administrator user to exist",
    );
    expect(presentAdminUser.isAdmin).toBe(true);
    expect(presentAdminUser.roles).toHaveLength(1);
    const adminRole = requireValue(
      presentAdminUser.roles[0],
      "Expected the administrator to have one role",
    );
    expect(adminRole.role.legacyId).toBe(1);
    expect(adminRole.role.admin).toBe(true);
    const sparseUser = await t.withIdentity(ADMIN_IDENTITY).query(
      api.identity.admin.getUser,
      { id: sparseUserId },
    );
    expect(sparseUser).toMatchObject({
      legacyId: null,
      name: null,
      email: null,
      image: null,
      status: "disabled",
      isAdmin: false,
    });
    expect(sparseUser?.nextSyllabus?.notes).toBeNull();
  });

  test("returns current-user role memberships to an authenticated member", async () => {
    const t = createTestBackend();
    const memberId = await seedUser(t, {
      identity: MEMBER_IDENTITY,
      name: "Member",
      email: "member@example.test",
    });
    const roleId = await seedRole(t, { name: "Member" });
    await t.run(async (ctx) => {
      await ctx.db.insert("userRoles", {
        userId: memberId,
        roleId,
      });
    });

    const memberships = await t.withIdentity(MEMBER_IDENTITY).query(
      api.identity.roles.mine,
      {},
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.assignedAt).toBeNull();
    expect(memberships[0]?.assignedBy).toBeNull();
    expect(memberships[0]?.role.id).toBe(roleId);
  });

  test("lists role summaries and marks capped counts as inexact", async () => {
    const t = createTestBackend();
    const { adminRoleId } = await seedAdmin(t);
    const memberId = await seedUser(t, {
      name: "Member",
      email: "member@example.test",
    });
    await t.run(async (ctx) => {
      for (let index = 0; index < 101; index += 1) {
        await ctx.db.insert("userRoles", {
          userId: memberId,
          roleId: adminRoleId,
        });
      }
    });

    const roles = await t.withIdentity(ADMIN_IDENTITY).query(
      api.identity.admin.listRoles,
      {},
    );
    expect(roles).toEqual([
      expect.objectContaining({
        id: adminRoleId,
        userCount: 100,
        userCountIsExact: false,
      }),
    ]);
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.identity.admin.getRole,
        { id: adminRoleId },
      ),
    ).resolves.toMatchObject({
      userCount: 100,
      userCountIsExact: false,
    });
  });

  test("returns null for a deleted role", async () => {
    const t = createTestBackend();
    const { adminRoleId } = await seedAdmin(t);
    const transientRoleId = await seedRole(t, {
      name: "Transient",
    });
    await t.run(async (ctx) => {
      await ctx.db.delete("roles", transientRoleId);
    });

    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.identity.admin.getRole,
        { id: transientRoleId },
      ),
    ).resolves.toBeNull();
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.identity.admin.getRole,
        { id: adminRoleId },
      ),
    ).resolves.toMatchObject({
      userCount: 1,
      userCountIsExact: true,
    });
  });

  test("fails closed on missing role and syllabus-movie parents", async () => {
    const missingRole = createTestBackend();
    await seedAdmin(missingRole);
    const memberId = await seedUser(missingRole, {
      name: "Member",
      email: "member@example.test",
    });
    const roleId = await seedRole(missingRole, {
      name: "Transient",
    });
    await missingRole.run(async (ctx) => {
      await ctx.db.insert("userRoles", {
        userId: memberId,
        roleId,
      });
      await ctx.db.delete("roles", roleId);
    });
    await expectDomainError(
      missingRole.withIdentity(ADMIN_IDENTITY).query(
        api.identity.admin.getUser,
        { id: memberId },
      ),
      "CONFLICT",
    );

    const missingMovie = createTestBackend();
    await seedAdmin(missingMovie);
    const syllabusUserId = await seedUser(missingMovie, {
      name: "Syllabus User",
      email: "syllabus@example.test",
    });
    await missingMovie.run(async (ctx) => {
      const movieId = await ctx.db.insert("movies", {
        title: "Transient",
        normalizedTitle: "transient",
        year: 2026,
        url: "https://movies.example/transient",
      });
      await ctx.db.insert("syllabusEntries", {
        userId: syllabusUserId,
        movieId,
        order: 1,
        createdAt: 1,
      });
      await ctx.db.delete("movies", movieId);
    });
    await expectDomainError(
      missingMovie.withIdentity(ADMIN_IDENTITY).query(
        api.identity.admin.getUser,
        { id: syllabusUserId },
      ),
      "CONFLICT",
    );
  });

  test("fails closed when a user or the role catalog exceeds read limits", async () => {
    const roleOverflow = createTestBackend();
    await seedAdmin(roleOverflow);
    for (let index = 0; index < 50; index += 1) {
      await seedRole(roleOverflow, {
        name: `Role ${String(index).padStart(2, "0")}`,
      });
    }
    await expectDomainError(
      roleOverflow.withIdentity(ADMIN_IDENTITY).query(
        api.identity.admin.listRoles,
        {},
      ),
      "CONFLICT",
    );

    const membershipOverflow = createTestBackend();
    await seedAdmin(membershipOverflow);
    const memberId = await seedUser(membershipOverflow, {
      name: "Member",
      email: "member@example.test",
    });
    const roleId = await seedRole(membershipOverflow, {
      name: "Member",
    });
    await membershipOverflow.run(async (ctx) => {
      for (let index = 0; index < 51; index += 1) {
        await ctx.db.insert("userRoles", {
          userId: memberId,
          roleId,
        });
      }
    });
    await expectDomainError(
      membershipOverflow.withIdentity(ADMIN_IDENTITY).query(
        api.identity.admin.getUser,
        { id: memberId },
      ),
      "CONFLICT",
    );
  });

  test("fails closed when a user's syllabus exceeds the read bound", async () => {
    const t = createTestBackend();
    await seedAdmin(t);
    const memberId = await seedUser(t, {
      name: "Syllabus Overflow",
      email: "overflow@example.test",
    });
    await t.run(async (ctx) => {
      const movieId = await ctx.db.insert("movies", {
        title: "Overflow Movie",
        normalizedTitle: "overflow movie",
        year: 2026,
        url: "https://movies.example/overflow",
      });
      for (let index = 0; index < 101; index += 1) {
        await ctx.db.insert("syllabusEntries", {
          userId: memberId,
          movieId,
          order: index,
          createdAt: index,
        });
      }
    });

    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.identity.admin.getUser,
        { id: memberId },
      ),
      "CONFLICT",
    );
  });
});
