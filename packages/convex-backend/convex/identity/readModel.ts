import type { Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import type {
  identityAdminUserValidator,
  identityRoleMembershipValidator,
} from "./validators.js";
import {
  MAX_ROLES_PER_USER,
  MAX_SYLLABUS_ENTRIES_PER_USER,
} from "./limits.js";

type AdminUser = Infer<typeof identityAdminUserValidator>;
type RoleMembership = Infer<
  typeof identityRoleMembershipValidator
>;

export function toIdentityRole(role: Doc<"roles">) {
  return {
    id: role._id,
    legacyId: role.legacyId ?? null,
    name: role.name,
    description: role.description,
    admin: role.admin,
    permissions: role.permissions,
  };
}

export async function hydrateRoleMemberships(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<RoleMembership[]> {
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
  return await Promise.all(
    memberships.map(async (membership) => {
      const role = await ctx.db.get("roles", membership.roleId);
      if (role === null) {
        domainError(
          "CONFLICT",
          "Identity read model found a missing role.",
          {
            details: {
              userRoleId: membership._id,
              roleId: membership.roleId,
            },
          },
        );
      }
      return {
        id: membership._id,
        assignedAt: membership.assignedAt ?? null,
        assignedBy: membership.assignedBy ?? null,
        role: toIdentityRole(role),
      };
    }),
  );
}

async function hydrateNextSyllabus(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<AdminUser["nextSyllabus"]> {
  const entries = await ctx.db
    .query("syllabusEntries")
    .withIndex("by_userId_and_order", (index) =>
      index.eq("userId", userId),
    )
    .order("desc")
    .take(MAX_SYLLABUS_ENTRIES_PER_USER + 1);
  if (entries.length > MAX_SYLLABUS_ENTRIES_PER_USER) {
    domainError(
      "CONFLICT",
      "User syllabus exceeds the supported admin-read limit.",
      {
        details: {
          limit: MAX_SYLLABUS_ENTRIES_PER_USER,
        },
      },
    );
  }
  const entry = entries.find(
    (candidate) => candidate.assignmentId === undefined,
  );
  if (entry === undefined) {
    return null;
  }
  const movie = await ctx.db.get("movies", entry.movieId);
  if (movie === null) {
    domainError(
      "CONFLICT",
      "Identity read model found a missing syllabus movie.",
      {
        details: {
          syllabusEntryId: entry._id,
          movieId: entry.movieId,
        },
      },
    );
  }
  return {
    id: entry._id,
    order: entry.order,
    notes: entry.notes ?? null,
    movie: {
      id: movie._id,
      title: movie.title,
    },
  };
}

export async function hydrateAdminUser(
  ctx: QueryCtx,
  user: Doc<"users">,
): Promise<AdminUser> {
  const [roles, nextSyllabus] = await Promise.all([
    hydrateRoleMemberships(ctx, user._id),
    hydrateNextSyllabus(ctx, user._id),
  ]);
  return {
    id: user._id,
    legacyId: user.legacyId ?? null,
    name: user.name ?? null,
    email: user.email ?? null,
    image: user.image ?? null,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    isAdmin: roles.some((membership) => membership.role.admin),
    roles,
    nextSyllabus,
  };
}
