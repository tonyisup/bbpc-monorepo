import { BBPC_API_VERSION } from "../../contracts/index.js";
import { v } from "convex/values";
import { anonymousQuery } from "../functions.js";
import { getSystemState } from "../lib/writeGate.js";

export const readiness = anonymousQuery({
  args: {},
  returns: v.object({
    apiVersion: v.string(),
    initialized: v.boolean(),
    applicationWritesEnabled: v.boolean(),
  }),
  handler: async (ctx) => {
    const state = await getSystemState(ctx);
    return {
      apiVersion: BBPC_API_VERSION,
      initialized: state !== null,
      applicationWritesEnabled:
        state?.applicationWriteMode === "enabled",
    };
  },
});
