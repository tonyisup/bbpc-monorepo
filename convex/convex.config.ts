import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    CLERK_JWT_ISSUER_DOMAIN: v.string(),
    BBPC_ENVIRONMENT: v.union(
      v.literal("development"),
      v.literal("staging"),
      v.literal("production"),
    ),
    BBPC_API_VERSION: v.string(),
  },
});
