/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "identity-admin-write-test";
const ADMIN_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|write-admin",
  issuer: "https://issuer.example.test",
  subject: "write-admin",
};
const MEMBER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|write-member",
  issuer: "https://issuer.example.test",
  subject: "write-member",
};

function createTestBackend() {
  return convexTest(schema, modules);
}

type TestBackend = ReturnType<typeof createTestBackend>;

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

async function seedRole(
  t: TestBackend,
  input: {
    name: string;
    admin?: boolean;
  },
): Promise<Id<"roles">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("roles", {
      name: input.name,
      normalizedName: input.name.trim().toLowerCase(),
      description: `${input.name} role`,
      admin: input.admin ?? false,
      permissions: input.admin === true ? ["admin"] : [],
      createdAt: 1,
      updatedAt: 1,
    });
  });
}

async function seedUser(
  t: TestBackend,
  input: {
    name: string;
    email: string;
    identity?: typeof ADMIN_IDENTITY;
    roleId?: Id<"roles">;
    status?: "active" | "disabled";
  },
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: input.name,
      email: input.email,
      normalizedEmail: input.email.trim().toLowerCase(),
      status: input.status ?? "active",
      createdAt: 1,
      updatedAt: 1,
    });
    if (input.identity !== undefined) {
      await ctx.db.insert("authIdentities", {
        ...input.identity,
        userId,
        linkedAt: 1,
        lastSeenAt: 1,
      });
    }
    if (input.roleId !== undefined) {
      await ctx.db.insert("userRoles", {
        userId,
        roleId: input.roleId,
        assignedAt: 1,
      });
    }
    return userId;
  });
}

async function seedAdmin(
  t: TestBackend,
): Promise<{
  userId: Id<"users">;
  roleId: Id<"roles">;
  membershipId: Id<"userRoles">;
}> {
  const roleId = await seedRole(t, {
    name: "Administrator",
    admin: true,
  });
  const userId = await seedUser(t, {
    name: "Write Admin",
    email: "admin@example.test",
    identity: ADMIN_IDENTITY,
  });
  const membershipId = await t.run(async (ctx) => {
    return await ctx.db.insert("userRoles", {
      userId,
      roleId,
      assignedAt: 1,
    });
  });
  return { userId, roleId, membershipId };
}

async function initializeS1(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "identity-admin-write-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "identity-admin-write-test",
  });
}

async function transitionS1ToS3(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S1",
    nextStage: "S2",
    actor: "identity-admin-write-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S2",
    nextStage: "S3",
    actor: "identity-admin-write-test",
    approvedBackupId: "identity-admin-write-backup",
    approvedBackupChecksum: "sha256:identity-admin-write",
  });
}

async function advanceToS3(t: TestBackend): Promise<void> {
  await initializeS1(t);
  await transitionS1ToS3(t);
}

describe("administrator identity mutations", () => {
  test("requires an administrator and the application write gate", async () => {
    const t = createTestBackend();
    await seedAdmin(t);
    await seedUser(t, {
      name: "Member",
      email: "member@example.test",
      identity: MEMBER_IDENTITY,
    });

    await expectDomainError(
      t.mutation(api.identity.admin.createUser, {
        clientApiVersion: BBPC_API_VERSION,
        name: "Created User",
        email: "created@example.test",
      }),
      "AUTHENTICATION_REQUIRED",
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.identity.admin.createUser,
        {
          clientApiVersion: BBPC_API_VERSION,
          name: "Created User",
          email: "created@example.test",
        },
      ),
      "FORBIDDEN",
    );
    await initializeS1(t);
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.createUser,
        {
          clientApiVersion: BBPC_API_VERSION,
          name: "Created User",
          email: "created@example.test",
        },
      ),
      "WRITE_DISABLED",
    );
    await transitionS1ToS3(t);
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.createUser,
        {
          clientApiVersion: "stale-client",
          name: "Created User",
          email: "created@example.test",
        },
      ),
      "STALE_CLIENT",
    );
  });

  test("creates and updates normalized users without auditing PII", async () => {
    const t = createTestBackend();
    await seedAdmin(t);
    await advanceToS3(t);

    const created = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.identity.admin.createUser,
      {
        clientApiVersion: BBPC_API_VERSION,
        name: "  New User  ",
        email: "  New.User@Example.Test  ",
      },
    );
    expect(created).toMatchObject({
      name: "New User",
      email: "New.User@Example.Test",
      status: "active",
      roles: [],
      nextSyllabus: null,
    });

    const updated = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.identity.admin.updateUser,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: created.id,
        name: "  Updated User ",
        email: " Updated@Example.Test ",
      },
    );
    expect(updated).toMatchObject({
      id: created.id,
      name: "Updated User",
      email: "Updated@Example.Test",
    });

    const snapshot = await t.run(async (ctx) => {
      const user = await ctx.db.get("users", created.id);
      const audits = await ctx.db
        .query("auditEvents")
        .withIndex("by_createdAt")
        .take(20);
      return { user, audits };
    });
    expect(snapshot.user).toMatchObject({
      normalizedEmail: "updated@example.test",
    });
    expect(snapshot.audits.map((audit) => audit.action)).toEqual(
      expect.arrayContaining([
        "identity.admin.user.created",
        "identity.admin.user.updated",
      ]),
    );
    const serializedAudits = JSON.stringify(snapshot.audits);
    expect(serializedAudits).not.toContain("Updated User");
    expect(serializedAudits).not.toContain("Updated@Example.Test");
  });

  test("validates user profiles, uniqueness, and missing targets", async () => {
    const t = createTestBackend();
    await seedAdmin(t);
    const existingId = await seedUser(t, {
      name: "Existing",
      email: "existing@example.test",
    });
    const missingId = await seedUser(t, {
      name: "Missing",
      email: "missing@example.test",
    });
    await t.run(async (ctx) => {
      await ctx.db.delete("users", missingId);
    });
    await advanceToS3(t);

    for (const input of [
      { name: " ", email: "valid@example.test" },
      { name: "x".repeat(101), email: "valid@example.test" },
      { name: "Valid", email: "not-an-email" },
      {
        name: "Valid",
        email: `${"x".repeat(310)}@example.test`,
      },
    ]) {
      await expectDomainError(
        t.withIdentity(ADMIN_IDENTITY).mutation(
          api.identity.admin.createUser,
          {
            clientApiVersion: BBPC_API_VERSION,
            ...input,
          },
        ),
        "VALIDATION_FAILED",
      );
    }

    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.createUser,
        {
          clientApiVersion: BBPC_API_VERSION,
          name: "Duplicate",
          email: " EXISTING@EXAMPLE.TEST ",
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.updateUser,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: existingId,
          name: "Existing",
          email: "ADMIN@EXAMPLE.TEST",
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.updateUser,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: missingId,
          name: "Missing",
          email: "missing@example.test",
        },
      ),
      "NOT_FOUND",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.setUserStatus,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: missingId,
          status: "disabled",
        },
      ),
      "NOT_FOUND",
    );
  });

  test("uses status changes instead of deleting users", async () => {
    const t = createTestBackend();
    await seedAdmin(t);
    const memberId = await seedUser(t, {
      name: "Member",
      email: "member@example.test",
      identity: MEMBER_IDENTITY,
    });
    await advanceToS3(t);

    const disabled = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.identity.admin.setUserStatus,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: memberId,
        status: "disabled",
      },
    );
    expect(disabled.status).toBe("disabled");
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.identity.profile.me,
        {},
      ),
      "ACCOUNT_DISABLED",
    );

    const unchanged = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.identity.admin.setUserStatus,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: memberId,
        status: "disabled",
      },
    );
    expect(unchanged.status).toBe("disabled");
    const active = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.identity.admin.setUserStatus,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: memberId,
        status: "active",
      },
    );
    expect(active.status).toBe("active");

    const persisted = await t.run(async (ctx) => {
      return await ctx.db.get("users", memberId);
    });
    expect(persisted?.status).toBe("active");
  });

  test("prevents disabling the final active administrator", async () => {
    const t = createTestBackend();
    const admin = await seedAdmin(t);
    await advanceToS3(t);

    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.setUserStatus,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: admin.userId,
          status: "disabled",
        },
      ),
      "CONFLICT",
    );

    const secondAdminId = await seedUser(t, {
      name: "Second Admin",
      email: "second-admin@example.test",
      roleId: admin.roleId,
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.setUserStatus,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: secondAdminId,
          status: "disabled",
        },
      ),
    ).resolves.toMatchObject({ status: "disabled" });
  });

  test("creates, updates, and deletes unassigned roles", async () => {
    const t = createTestBackend();
    await seedAdmin(t);
    await advanceToS3(t);

    const created = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.identity.admin.createRole,
      {
        clientApiVersion: BBPC_API_VERSION,
        name: "  Producers ",
        description: "  Produce episodes ",
        admin: false,
      },
    );
    expect(created).toMatchObject({
      name: "Producers",
      description: "Produce episodes",
      admin: false,
      permissions: [],
    });

    const updated = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.identity.admin.updateRole,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: created.id,
        name: "Executive Producers",
        description: "Full production access",
        admin: true,
      },
    );
    expect(updated).toMatchObject({
      name: "Executive Producers",
      admin: true,
      permissions: ["admin"],
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.deleteRole,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: created.id,
        },
      ),
    ).resolves.toEqual({ id: created.id });
  });

  test("validates role input, uniqueness, capacity, and deletion conflicts", async () => {
    const t = createTestBackend();
    const admin = await seedAdmin(t);
    const assignedRoleId = await seedRole(t, {
      name: "Assigned",
    });
    const memberId = await seedUser(t, {
      name: "Member",
      email: "member@example.test",
      roleId: assignedRoleId,
    });
    const missingRoleId = await seedRole(t, {
      name: "Missing",
    });
    await t.run(async (ctx) => {
      await ctx.db.delete("roles", missingRoleId);
    });
    await advanceToS3(t);

    for (const input of [
      { name: " ", description: "Valid", admin: false },
      {
        name: "x".repeat(1001),
        description: "Valid",
        admin: false,
      },
      { name: "Valid", description: " ", admin: false },
      {
        name: "Valid",
        description: "x".repeat(1001),
        admin: false,
      },
    ]) {
      await expectDomainError(
        t.withIdentity(ADMIN_IDENTITY).mutation(
          api.identity.admin.createRole,
          {
            clientApiVersion: BBPC_API_VERSION,
            ...input,
          },
        ),
        "VALIDATION_FAILED",
      );
    }
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.createRole,
        {
          clientApiVersion: BBPC_API_VERSION,
          name: " ADMINISTRATOR ",
          description: "Duplicate",
          admin: true,
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.updateRole,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: assignedRoleId,
          name: "Administrator",
          description: "Duplicate",
          admin: false,
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.deleteRole,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: assignedRoleId,
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.deleteRole,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: missingRoleId,
        },
      ),
      "NOT_FOUND",
    );
    expect(admin.userId).not.toBe(memberId);

    for (let index = 0; index < 48; index += 1) {
      await seedRole(t, {
        name: `Capacity ${String(index).padStart(2, "0")}`,
      });
    }
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.createRole,
        {
          clientApiVersion: BBPC_API_VERSION,
          name: "One Too Many",
          description: "Capacity rejection",
          admin: false,
        },
      ),
      "CONFLICT",
    );
  });

  test("assigns and removes roles with actor and audit evidence", async () => {
    const t = createTestBackend();
    const admin = await seedAdmin(t);
    const memberId = await seedUser(t, {
      name: "Member",
      email: "member@example.test",
    });
    const roleId = await seedRole(t, { name: "Member" });
    await advanceToS3(t);

    const membership = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.identity.admin.assignRole,
      {
        clientApiVersion: BBPC_API_VERSION,
        userId: memberId,
        roleId,
      },
    );
    expect(membership).toMatchObject({
      assignedBy: admin.userId,
      role: { id: roleId, name: "Member" },
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.assignRole,
        {
          clientApiVersion: BBPC_API_VERSION,
          userId: memberId,
          roleId,
        },
      ),
      "CONFLICT",
    );
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.removeRoleMembership,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: membership.id,
        },
      ),
    ).resolves.toEqual({ id: membership.id });

    const snapshot = await t.run(async (ctx) => {
      const deleted = await ctx.db.get("userRoles", membership.id);
      const audits = await ctx.db
        .query("auditEvents")
        .withIndex("by_createdAt")
        .take(20);
      return { deleted, audits };
    });
    expect(snapshot.deleted).toBeNull();
    expect(snapshot.audits.map((audit) => audit.action)).toEqual(
      expect.arrayContaining([
        "identity.admin.roleMembership.assigned",
        "identity.admin.roleMembership.removed",
      ]),
    );
  });

  test("validates role-assignment targets and membership capacity", async () => {
    const t = createTestBackend();
    await seedAdmin(t);
    const memberId = await seedUser(t, {
      name: "Member",
      email: "member@example.test",
    });
    const roleId = await seedRole(t, { name: "Member" });
    const extraRoleId = await seedRole(t, { name: "Extra" });
    const missingUserId = await seedUser(t, {
      name: "Missing",
      email: "missing@example.test",
    });
    const missingRoleId = await seedRole(t, {
      name: "Missing",
    });
    const missingMembershipId = await t.run(async (ctx) => {
      await ctx.db.delete("users", missingUserId);
      await ctx.db.delete("roles", missingRoleId);
      const id = await ctx.db.insert("userRoles", {
        userId: memberId,
        roleId,
      });
      await ctx.db.delete("userRoles", id);
      for (let index = 0; index < 50; index += 1) {
        await ctx.db.insert("userRoles", {
          userId: memberId,
          roleId,
        });
      }
      return id;
    });
    await advanceToS3(t);

    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.assignRole,
        {
          clientApiVersion: BBPC_API_VERSION,
          userId: missingUserId,
          roleId,
        },
      ),
      "NOT_FOUND",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.assignRole,
        {
          clientApiVersion: BBPC_API_VERSION,
          userId: memberId,
          roleId: missingRoleId,
        },
      ),
      "NOT_FOUND",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.assignRole,
        {
          clientApiVersion: BBPC_API_VERSION,
          userId: memberId,
          roleId: extraRoleId,
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.removeRoleMembership,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: missingMembershipId,
        },
      ),
      "NOT_FOUND",
    );
  });

  test("prevents removing or demoting the final administrator grant", async () => {
    const t = createTestBackend();
    const admin = await seedAdmin(t);
    await advanceToS3(t);

    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.removeRoleMembership,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: admin.membershipId,
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.updateRole,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: admin.roleId,
          name: "Administrator",
          description: "No longer admin",
          admin: false,
        },
      ),
      "CONFLICT",
    );

    const backupRoleId = await seedRole(t, {
      name: "Backup Administrator",
      admin: true,
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("userRoles", {
        userId: admin.userId,
        roleId: backupRoleId,
      });
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.removeRoleMembership,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: admin.membershipId,
        },
      ),
    ).resolves.toEqual({ id: admin.membershipId });
  });

  test("fails closed on broken or over-limit administrator state", async () => {
    const broken = createTestBackend();
    const brokenAdmin = await seedAdmin(broken);
    const transientRoleId = await seedRole(broken, {
      name: "Transient Administrator",
      admin: true,
    });
    const targetId = await seedUser(broken, {
      name: "Target Admin",
      email: "target@example.test",
      roleId: transientRoleId,
    });
    await broken.run(async (ctx) => {
      const targetMembership = await ctx.db
        .query("userRoles")
        .withIndex("by_userId", (index) =>
          index.eq("userId", targetId),
        )
        .unique();
      await ctx.db.delete("roles", transientRoleId);
      expect(targetMembership).not.toBeNull();
    });
    await advanceToS3(broken);
    await expectDomainError(
      broken.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.setUserStatus,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: targetId,
          status: "disabled",
        },
      ),
      "CONFLICT",
    );
    expect(brokenAdmin.userId).not.toBe(targetId);

    const overflow = createTestBackend();
    const overflowAdmin = await seedAdmin(overflow);
    for (let index = 0; index < 50; index += 1) {
      const roleId = await seedRole(overflow, {
        name: `Overflow ${String(index).padStart(2, "0")}`,
      });
      await overflow.run(async (ctx) => {
        await ctx.db.insert("userRoles", {
          userId: overflowAdmin.userId,
          roleId,
        });
      });
    }
    await advanceToS3(overflow);
    await expectDomainError(
      overflow.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.setUserStatus,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: overflowAdmin.userId,
          status: "disabled",
        },
      ),
      "CONFLICT",
    );

    const catalogOverflow = createTestBackend();
    const catalogAdmin = await seedAdmin(catalogOverflow);
    for (let index = 0; index < 50; index += 1) {
      await seedRole(catalogOverflow, {
        name: `Catalog Overflow ${String(index).padStart(2, "0")}`,
      });
    }
    await advanceToS3(catalogOverflow);
    await expectDomainError(
      catalogOverflow.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.removeRoleMembership,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: catalogAdmin.membershipId,
        },
      ),
      "CONFLICT",
    );

    const missingAdministrator = createTestBackend();
    const presentAdmin = await seedAdmin(missingAdministrator);
    const brokenRoleId = await seedRole(missingAdministrator, {
      name: "Broken Administrator",
      admin: true,
    });
    const brokenUserId = await seedUser(missingAdministrator, {
      name: "Broken Admin",
      email: "broken-admin@example.test",
      roleId: brokenRoleId,
    });
    await missingAdministrator.run(async (ctx) => {
      await ctx.db.delete("users", brokenUserId);
    });
    await advanceToS3(missingAdministrator);
    await expectDomainError(
      missingAdministrator.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.removeRoleMembership,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: presentAdmin.membershipId,
        },
      ),
      "CONFLICT",
    );

    const membershipOverflow = createTestBackend();
    const soleAdmin = await seedAdmin(membershipOverflow);
    const overflowRoleId = await seedRole(membershipOverflow, {
      name: "Overflow Administrator",
      admin: true,
    });
    const disabledUserId = await seedUser(membershipOverflow, {
      name: "Disabled Admin",
      email: "disabled-admin@example.test",
      status: "disabled",
    });
    await membershipOverflow.run(async (ctx) => {
      for (let index = 0; index < 101; index += 1) {
        await ctx.db.insert("userRoles", {
          userId: disabledUserId,
          roleId: overflowRoleId,
        });
      }
    });
    await advanceToS3(membershipOverflow);
    await expectDomainError(
      membershipOverflow.withIdentity(ADMIN_IDENTITY).mutation(
        api.identity.admin.removeRoleMembership,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: soleAdmin.membershipId,
        },
      ),
      "CONFLICT",
    );
  });
});
