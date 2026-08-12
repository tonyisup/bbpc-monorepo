import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { adminMutation, adminQuery } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  assertActiveAdministratorRemains,
  assertRoleCatalogCapacity,
  assertRoleNameAvailable,
  assertUserEmailAvailable,
  assertUserRoleCapacity,
  requireRole,
  requireUser,
  userHasAdministratorRole,
  validateRoleInput,
  validateUserProfile,
} from "./adminWriteModel.js";
import {
  MAX_ROLE_CATALOG_SIZE,
  MAX_ROLE_MEMBERSHIPS_FOR_COUNT,
} from "./limits.js";
import { hydrateAdminUser, toIdentityRole } from "./readModel.js";
import {
  identityAdminUserValidator,
  identityAdminUserSnapshotValidator,
  identityRoleMembershipValidator,
  identityRoleMembershipSnapshotValidator,
  identityRoleValidator,
  identityRoleSummaryValidator,
  identityUserStatusValidator,
} from "./validators.js";

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

function userSnapshot(user: Doc<"users">) {
  return {
    name: nullable(user.name),
    email: nullable(user.email),
    status: user.status,
    updatedAt: user.updatedAt,
  };
}

function userSnapshotsMatch(
  actual: ReturnType<typeof userSnapshot>,
  expected: {
    name: string | null;
    email: string | null;
    status: "active" | "disabled";
    updatedAt: number;
  },
): boolean {
  return (
    actual.name === expected.name &&
    actual.email === expected.email &&
    actual.status === expected.status &&
    actual.updatedAt === expected.updatedAt
  );
}

async function roleSummary(
  ctx: QueryCtx,
  role: Doc<"roles">,
) {
  const memberships = await ctx.db
    .query("userRoles")
    .withIndex("by_roleId", (index) =>
      index.eq("roleId", role._id),
    )
    .take(MAX_ROLE_MEMBERSHIPS_FOR_COUNT + 1);
  return {
    ...toIdentityRole(role),
    userCount: Math.min(
      memberships.length,
      MAX_ROLE_MEMBERSHIPS_FOR_COUNT,
    ),
    userCountIsExact:
      memberships.length <= MAX_ROLE_MEMBERSHIPS_FOR_COUNT,
  };
}

export const getUser = adminQuery({
  args: { id: v.id("users") },
  returns: v.union(identityAdminUserValidator, v.null()),
  handler: async (ctx, args) => {
    const user = await ctx.db.get("users", args.id);
    return user === null
      ? null
      : await hydrateAdminUser(ctx, user);
  },
});

export const listUsersPage = adminQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(identityAdminUserValidator),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("users")
      .withIndex("by_name")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map((user) =>
          hydrateAdminUser(ctx, user),
        ),
      ),
    };
  },
});

export const getRole = adminQuery({
  args: { id: v.id("roles") },
  returns: v.union(identityRoleSummaryValidator, v.null()),
  handler: async (ctx, args) => {
    const role = await ctx.db.get("roles", args.id);
    return role === null
      ? null
      : await roleSummary(ctx, role);
  },
});

export const listRoles = adminQuery({
  args: {},
  returns: v.array(identityRoleSummaryValidator),
  handler: async (ctx) => {
    const roles = await ctx.db
      .query("roles")
      .withIndex("by_normalizedName")
      .take(MAX_ROLE_CATALOG_SIZE + 1);
    if (roles.length > MAX_ROLE_CATALOG_SIZE) {
      domainError(
        "CONFLICT",
        "Role list exceeds the supported admin-read limit.",
        { details: { limit: MAX_ROLE_CATALOG_SIZE } },
      );
    }
    return await Promise.all(
      roles.map((role) => roleSummary(ctx, role)),
    );
  },
});

export const createUser = adminMutation({
  args: {
    name: v.string(),
    email: v.string(),
  },
  returns: identityAdminUserValidator,
  handler: async (ctx, args) => {
    const profile = validateUserProfile(args.name, args.email);
    await assertUserEmailAvailable(ctx, profile.normalizedEmail);
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      ...profile,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "identity.admin.user.created",
      targetType: "user",
      targetId: userId,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    const user = await requireUser(ctx, userId);
    return await hydrateAdminUser(ctx, user);
  },
});

export const updateUser = adminMutation({
  args: {
    id: v.id("users"),
    expected: v.optional(identityAdminUserSnapshotValidator),
    name: v.string(),
    email: v.string(),
  },
  returns: identityAdminUserValidator,
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.id);
    if (
      args.expected !== undefined &&
      !userSnapshotsMatch(userSnapshot(user), args.expected)
    ) {
      domainError(
        "CONFLICT",
        "The user profile changed after it was loaded.",
      );
    }
    const profile = validateUserProfile(args.name, args.email);
    await assertUserEmailAvailable(
      ctx,
      profile.normalizedEmail,
      user._id,
    );
    const updatedAt = Date.now();
    await ctx.db.patch("users", user._id, {
      ...profile,
      updatedAt,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "identity.admin.user.updated",
      targetType: "user",
      targetId: user._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return await hydrateAdminUser(ctx, {
      ...user,
      ...profile,
      updatedAt,
    });
  },
});

export const setUserStatus = adminMutation({
  args: {
    id: v.id("users"),
    expected: v.optional(identityAdminUserSnapshotValidator),
    status: identityUserStatusValidator,
  },
  returns: identityAdminUserValidator,
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.id);
    if (
      args.expected !== undefined &&
      !userSnapshotsMatch(userSnapshot(user), args.expected)
    ) {
      domainError(
        "CONFLICT",
        "The user profile changed after it was loaded.",
      );
    }
    if (
      user.status === "active" &&
      args.status === "disabled" &&
      (await userHasAdministratorRole(ctx, user._id))
    ) {
      await assertActiveAdministratorRemains(ctx, {
        disabledUserId: user._id,
      });
    }
    if (user.status === args.status) {
      return await hydrateAdminUser(ctx, user);
    }
    const updatedAt = Date.now();
    await ctx.db.patch("users", user._id, {
      status: args.status,
      updatedAt,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "identity.admin.user.statusChanged",
      targetType: "user",
      targetId: user._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { status: args.status },
    });
    return await hydrateAdminUser(ctx, {
      ...user,
      status: args.status,
      updatedAt,
    });
  },
});

export const createRole = adminMutation({
  args: {
    name: v.string(),
    description: v.string(),
    admin: v.boolean(),
  },
  returns: identityRoleValidator,
  handler: async (ctx, args) => {
    const roleInput = validateRoleInput(
      args.name,
      args.description,
      args.admin,
    );
    await Promise.all([
      assertRoleCatalogCapacity(ctx),
      assertRoleNameAvailable(ctx, roleInput.normalizedName),
    ]);
    const now = Date.now();
    const roleId = await ctx.db.insert("roles", {
      ...roleInput,
      createdAt: now,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "identity.admin.role.created",
      targetType: "role",
      targetId: roleId,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { admin: roleInput.admin },
    });
    const role = await requireRole(ctx, roleId);
    return toIdentityRole(role);
  },
});

export const updateRole = adminMutation({
  args: {
    id: v.id("roles"),
    name: v.string(),
    description: v.string(),
    admin: v.boolean(),
  },
  returns: identityRoleValidator,
  handler: async (ctx, args) => {
    const role = await requireRole(ctx, args.id);
    const roleInput = validateRoleInput(
      args.name,
      args.description,
      args.admin,
    );
    await assertRoleNameAvailable(
      ctx,
      roleInput.normalizedName,
      role._id,
    );
    if (role.admin && !roleInput.admin) {
      await assertActiveAdministratorRemains(ctx, {
        demotedRoleId: role._id,
      });
    }
    const updatedAt = Date.now();
    await ctx.db.patch("roles", role._id, {
      ...roleInput,
      updatedAt,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "identity.admin.role.updated",
      targetType: "role",
      targetId: role._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { admin: roleInput.admin },
    });
    return toIdentityRole({
      ...role,
      ...roleInput,
      updatedAt,
    });
  },
});

export const deleteRole = adminMutation({
  args: { id: v.id("roles") },
  returns: v.object({ id: v.id("roles") }),
  handler: async (ctx, args) => {
    const role = await requireRole(ctx, args.id);
    const membership = await ctx.db
      .query("userRoles")
      .withIndex("by_roleId", (index) =>
        index.eq("roleId", role._id),
      )
      .first();
    if (membership !== null) {
      domainError(
        "CONFLICT",
        "A role with assigned users cannot be deleted.",
      );
    }
    await ctx.db.delete("roles", role._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "identity.admin.role.deleted",
      targetType: "role",
      targetId: role._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return { id: role._id };
  },
});

export const assignRole = adminMutation({
  args: {
    userId: v.id("users"),
    roleId: v.id("roles"),
  },
  returns: identityRoleMembershipValidator,
  handler: async (ctx, args) => {
    const [user, role] = await Promise.all([
      requireUser(ctx, args.userId),
      requireRole(ctx, args.roleId),
    ]);
    const existing = await ctx.db
      .query("userRoles")
      .withIndex("by_userId_and_roleId", (index) =>
        index.eq("userId", user._id).eq("roleId", role._id),
      )
      .unique();
    if (existing !== null) {
      domainError(
        "CONFLICT",
        "The user already has this role.",
      );
    }
    await assertUserRoleCapacity(ctx, user._id);
    const assignedAt = Date.now();
    const membershipId = await ctx.db.insert("userRoles", {
      userId: user._id,
      roleId: role._id,
      assignedAt,
      assignedBy: ctx.actor.user._id,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "identity.admin.roleMembership.assigned",
      targetType: "userRole",
      targetId: membershipId,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: {
        userId: user._id,
        roleId: role._id,
      },
    });
    return {
      id: membershipId,
      assignedAt,
      assignedBy: ctx.actor.user._id,
      role: toIdentityRole(role),
    };
  },
});

export const removeRoleMembership = adminMutation({
  args: {
    id: v.id("userRoles"),
    expected: v.optional(identityRoleMembershipSnapshotValidator),
  },
  returns: v.object({ id: v.id("userRoles") }),
  handler: async (ctx, args) => {
    const membership = await ctx.db.get("userRoles", args.id);
    if (membership === null) {
      domainError(
        "NOT_FOUND",
        "The role membership is unavailable.",
      );
    }
    if (
      args.expected !== undefined &&
      (membership.userId !== args.expected.userId ||
        membership.roleId !== args.expected.roleId ||
        nullable(membership.assignedAt) !== args.expected.assignedAt ||
        nullable(membership.assignedBy) !== args.expected.assignedBy)
    ) {
      domainError(
        "CONFLICT",
        "The role membership changed after it was loaded.",
      );
    }
    const role = await requireRole(ctx, membership.roleId);
    if (role.admin) {
      await assertActiveAdministratorRemains(ctx, {
        removedMembershipId: membership._id,
      });
    }
    await ctx.db.delete("userRoles", membership._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "identity.admin.roleMembership.removed",
      targetType: "userRole",
      targetId: membership._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: {
        userId: membership.userId,
        roleId: membership.roleId,
      },
    });
    return { id: membership._id };
  },
});
