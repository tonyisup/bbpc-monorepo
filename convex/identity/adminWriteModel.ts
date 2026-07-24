import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import {
  normalizeEmail,
  normalizeLookupKey,
} from "../lib/normalize.js";
import {
  MAX_ADMIN_MEMBERSHIPS_TO_INSPECT,
  MAX_ROLE_CATALOG_SIZE,
  MAX_ROLES_PER_USER,
} from "./limits.js";

const MAX_USER_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 320;
const MAX_ROLE_NAME_LENGTH = 1000;
const MAX_ROLE_DESCRIPTION_LENGTH = 1000;

export function validateUserProfile(
  rawName: string,
  rawEmail: string,
): {
  name: string;
  email: string;
  normalizedEmail: string;
} {
  const name = rawName.trim().normalize("NFKC");
  if (name.length < 1 || name.length > MAX_USER_NAME_LENGTH) {
    domainError(
      "VALIDATION_FAILED",
      `Name must contain 1 through ${String(MAX_USER_NAME_LENGTH)} characters.`,
    );
  }

  const email = rawEmail.trim().normalize("NFKC");
  const atIndex = email.lastIndexOf("@");
  if (
    email.length < 3 ||
    email.length > MAX_EMAIL_LENGTH ||
    atIndex < 1 ||
    atIndex === email.length - 1 ||
    /\s/u.test(email)
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Email must be a valid address no longer than 320 characters.",
    );
  }
  return {
    name,
    email,
    normalizedEmail: normalizeEmail(email),
  };
}

export function validateRoleInput(
  rawName: string,
  rawDescription: string,
  admin: boolean,
): {
  name: string;
  normalizedName: string;
  description: string;
  admin: boolean;
  permissions: string[];
} {
  const name = rawName.trim().normalize("NFKC");
  if (name.length < 1 || name.length > MAX_ROLE_NAME_LENGTH) {
    domainError(
      "VALIDATION_FAILED",
      `Role name must contain 1 through ${String(MAX_ROLE_NAME_LENGTH)} characters.`,
    );
  }
  const description = rawDescription.trim().normalize("NFKC");
  if (
    description.length < 1 ||
    description.length > MAX_ROLE_DESCRIPTION_LENGTH
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Role description must contain 1 through ${String(MAX_ROLE_DESCRIPTION_LENGTH)} characters.`,
    );
  }
  return {
    name,
    normalizedName: normalizeLookupKey(name, "Role name"),
    description,
    admin,
    permissions: admin ? ["admin"] : [],
  };
}

export async function requireUser(
  ctx: MutationCtx,
  id: Id<"users">,
): Promise<Doc<"users">> {
  const user = await ctx.db.get("users", id);
  if (user === null) {
    domainError("NOT_FOUND", "The user is unavailable.");
  }
  return user;
}

export async function requireRole(
  ctx: MutationCtx,
  id: Id<"roles">,
): Promise<Doc<"roles">> {
  const role = await ctx.db.get("roles", id);
  if (role === null) {
    domainError("NOT_FOUND", "The role is unavailable.");
  }
  return role;
}

export async function assertUserEmailAvailable(
  ctx: MutationCtx,
  normalizedEmail: string,
  existingUserId?: Id<"users">,
): Promise<void> {
  const collision = await ctx.db
    .query("users")
    .withIndex("by_normalizedEmail", (index) =>
      index.eq("normalizedEmail", normalizedEmail),
    )
    .unique();
  if (
    collision !== null &&
    collision._id !== existingUserId
  ) {
    domainError(
      "CONFLICT",
      "Another user already has this normalized email address.",
    );
  }
}

export async function assertRoleNameAvailable(
  ctx: MutationCtx,
  normalizedName: string,
  existingRoleId?: Id<"roles">,
): Promise<void> {
  const collision = await ctx.db
    .query("roles")
    .withIndex("by_normalizedName", (index) =>
      index.eq("normalizedName", normalizedName),
    )
    .unique();
  if (
    collision !== null &&
    collision._id !== existingRoleId
  ) {
    domainError(
      "CONFLICT",
      "Another role already has this normalized name.",
    );
  }
}

export async function assertRoleCatalogCapacity(
  ctx: MutationCtx,
): Promise<void> {
  const roles = await ctx.db
    .query("roles")
    .withIndex("by_normalizedName")
    .take(MAX_ROLE_CATALOG_SIZE);
  if (roles.length >= MAX_ROLE_CATALOG_SIZE) {
    domainError(
      "CONFLICT",
      "The role catalog has reached its supported limit.",
      { details: { limit: MAX_ROLE_CATALOG_SIZE } },
    );
  }
}

export async function assertUserRoleCapacity(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<void> {
  const memberships = await ctx.db
    .query("userRoles")
    .withIndex("by_userId", (index) =>
      index.eq("userId", userId),
    )
    .take(MAX_ROLES_PER_USER);
  if (memberships.length >= MAX_ROLES_PER_USER) {
    domainError(
      "CONFLICT",
      "The user has reached the supported role-membership limit.",
      { details: { limit: MAX_ROLES_PER_USER } },
    );
  }
}

export async function userHasAdministratorRole(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<boolean> {
  const memberships = await ctx.db
    .query("userRoles")
    .withIndex("by_userId", (index) =>
      index.eq("userId", userId),
    )
    .take(MAX_ROLES_PER_USER + 1);
  if (memberships.length > MAX_ROLES_PER_USER) {
    domainError(
      "CONFLICT",
      "User role memberships exceed the supported limit.",
      { details: { limit: MAX_ROLES_PER_USER } },
    );
  }
  for (const membership of memberships) {
    const role = await ctx.db.get("roles", membership.roleId);
    if (role === null) {
      domainError(
        "CONFLICT",
        "Identity write validation found a missing role.",
        { details: { userRoleId: membership._id } },
      );
    }
    if (role.admin) {
      return true;
    }
  }
  return false;
}

export async function assertActiveAdministratorRemains(
  ctx: MutationCtx,
  exclusion: {
    disabledUserId?: Id<"users">;
    removedMembershipId?: Id<"userRoles">;
    demotedRoleId?: Id<"roles">;
  },
): Promise<void> {
  const roles = await ctx.db
    .query("roles")
    .withIndex("by_normalizedName")
    .take(MAX_ROLE_CATALOG_SIZE + 1);
  if (roles.length > MAX_ROLE_CATALOG_SIZE) {
    domainError(
      "CONFLICT",
      "The role catalog exceeds the supported administrator-safety limit.",
      { details: { limit: MAX_ROLE_CATALOG_SIZE } },
    );
  }

  let remainingMembershipBudget =
    MAX_ADMIN_MEMBERSHIPS_TO_INSPECT;
  for (const role of roles) {
    if (
      !role.admin ||
      role._id === exclusion.demotedRoleId
    ) {
      continue;
    }
    const memberships = await ctx.db
      .query("userRoles")
      .withIndex("by_roleId", (index) =>
        index.eq("roleId", role._id),
      )
      .take(remainingMembershipBudget + 1);
    const inspectable = memberships.slice(
      0,
      remainingMembershipBudget,
    );
    for (const membership of inspectable) {
      if (
        membership._id === exclusion.removedMembershipId ||
        membership.userId === exclusion.disabledUserId
      ) {
        continue;
      }
      const user = await ctx.db.get("users", membership.userId);
      if (user === null) {
        domainError(
          "CONFLICT",
          "Administrator-safety validation found a missing user.",
          { details: { userRoleId: membership._id } },
        );
      }
      if (user.status === "active") {
        return;
      }
    }
    if (memberships.length > remainingMembershipBudget) {
      domainError(
        "CONFLICT",
        "Administrator memberships exceed the supported safety limit.",
        {
          details: {
            limit: MAX_ADMIN_MEMBERSHIPS_TO_INSPECT,
          },
        },
      );
    }
    remainingMembershipBudget -= memberships.length;
  }
  domainError(
    "CONFLICT",
    "This change would remove the final active administrator.",
  );
}
