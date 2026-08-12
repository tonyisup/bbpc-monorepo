import { v } from "convex/values";

import { authenticatedQuery } from "../functions.js";
import { hydrateRoleMemberships } from "./readModel.js";
import { identityRoleMembershipValidator } from "./validators.js";

export const mine = authenticatedQuery({
  args: {},
  returns: v.array(identityRoleMembershipValidator),
  handler: async (ctx) => {
    return await hydrateRoleMemberships(
      ctx,
      ctx.actor.user._id,
    );
  },
});
