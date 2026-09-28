import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    CLERK_JWT_ISSUER_DOMAIN: v.string(),
    CLERK_M2M_AUDIENCE: v.string(),
    BBPC_ENVIRONMENT: v.union(
      v.literal("development"),
      v.literal("staging"),
      v.literal("production"),
    ),
    BBPC_API_VERSION: v.string(),
    TMDB_API_KEY: v.optional(v.string()),
    UPLOADTHING_TOKEN: v.optional(v.string()),
    // Shared with the web server only, so that nothing but its locate route
    // can spend a Quote Finder assistant run.
    QUOTE_LOCATE_SERVER_KEY: v.optional(v.string()),
  },
});
