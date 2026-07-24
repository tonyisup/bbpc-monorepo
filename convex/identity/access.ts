import { v } from "convex/values";

import { internalReadQuery } from "../functions.js";
import {
  requireServiceActor,
  requireUserActor,
} from "../lib/actors.js";

export const resolveUserForAction = internalReadQuery({
  args: {},
  returns: v.object({
    userId: v.id("users"),
    isAdmin: v.boolean(),
  }),
  handler: async (ctx) => {
    const actor = await requireUserActor(ctx);
    return {
      userId: actor.user._id,
      isAdmin: actor.isAdmin,
    };
  },
});

export const resolveServiceForAction = internalReadQuery({
  args: {},
  returns: v.object({
    servicePrincipalId: v.id("servicePrincipals"),
    permissions: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const actor = await requireServiceActor(ctx);
    return {
      servicePrincipalId: actor.servicePrincipal._id,
      permissions: actor.servicePrincipal.permissions,
    };
  },
});
