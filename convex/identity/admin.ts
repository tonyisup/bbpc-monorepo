import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { adminQuery } from "../functions.js";
import { domainError } from "../lib/errors.js";
import { hydrateAdminUser, toIdentityRole } from "./readModel.js";
import {
  identityAdminUserValidator,
  identityRoleSummaryValidator,
} from "./validators.js";

const ROLE_PAGE_LIMIT = 50;
const USER_COUNT_READ_LIMIT = 100;

async function roleSummary(
  ctx: QueryCtx,
  role: Doc<"roles">,
) {
  const memberships = await ctx.db
    .query("userRoles")
    .withIndex("by_roleId", (index) =>
      index.eq("roleId", role._id),
    )
    .take(USER_COUNT_READ_LIMIT + 1);
  return {
    ...toIdentityRole(role),
    userCount: Math.min(
      memberships.length,
      USER_COUNT_READ_LIMIT,
    ),
    userCountIsExact:
      memberships.length <= USER_COUNT_READ_LIMIT,
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
      .take(ROLE_PAGE_LIMIT + 1);
    if (roles.length > ROLE_PAGE_LIMIT) {
      domainError(
        "CONFLICT",
        "Role list exceeds the supported admin-read limit.",
        { details: { limit: ROLE_PAGE_LIMIT } },
      );
    }
    return await Promise.all(
      roles.map((role) => roleSummary(ctx, role)),
    );
  },
});
