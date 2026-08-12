import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import { anonymousQuery } from "../functions.js";
import { domainError } from "../lib/errors.js";
import {
  MAX_PUBLIC_HOST_MEMBERSHIPS_TO_INSPECT,
  MAX_ROLE_CATALOG_SIZE,
} from "./limits.js";
import { identityPublicHostValidator } from "./validators.js";

function compareHosts(left: Doc<"users">, right: Doc<"users">) {
  return (
    (left.name ?? "").localeCompare(right.name ?? "") ||
    left._creationTime - right._creationTime
  );
}

export const listHosts = anonymousQuery({
  args: {},
  returns: v.array(identityPublicHostValidator),
  handler: async (ctx) => {
    const roles = await ctx.db
      .query("roles")
      .take(MAX_ROLE_CATALOG_SIZE + 1);
    if (roles.length > MAX_ROLE_CATALOG_SIZE) {
      domainError(
        "CONFLICT",
        "The role catalog exceeds the public host read limit.",
        { details: { limit: MAX_ROLE_CATALOG_SIZE } },
      );
    }

    const hostIds = new Map<Id<"users">, Id<"users">>();
    let inspectedMemberships = 0;
    for (const role of roles) {
      if (!role.admin) {
        continue;
      }
      const remaining =
        MAX_PUBLIC_HOST_MEMBERSHIPS_TO_INSPECT -
        inspectedMemberships;
      const memberships = await ctx.db
        .query("userRoles")
        .withIndex("by_roleId", (index) =>
          index.eq("roleId", role._id),
        )
        .take(remaining + 1);
      inspectedMemberships += memberships.length;
      if (
        inspectedMemberships >
        MAX_PUBLIC_HOST_MEMBERSHIPS_TO_INSPECT
      ) {
        domainError(
          "CONFLICT",
          "Host memberships exceed the public read limit.",
          {
            details: {
              limit: MAX_PUBLIC_HOST_MEMBERSHIPS_TO_INSPECT,
            },
          },
        );
      }
      for (const membership of memberships) {
        hostIds.set(membership.userId, membership.userId);
      }
    }

    const hosts = await Promise.all(
      [...hostIds.values()].map(async (userId) => {
        const user = await ctx.db.get("users", userId);
        if (user === null) {
          domainError(
            "CONFLICT",
            "A host membership references a missing user.",
          );
        }
        return user;
      }),
    );

    return hosts
      // convex-query-audit: allow-filter bounded in-memory host membership results
      .filter((host) => host.status === "active")
      .sort(compareHosts)
      .map((host) => ({
        id: host._id,
        name: host.name ?? null,
        image: host.image ?? null,
      }));
  },
});
