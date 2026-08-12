import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts", "migration/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["convex/**/*.ts"],
      exclude: [
        "convex/**/*.test.ts",
        "convex/_generated/**",
        "convex/auth.config.ts",
        "convex/convex.config.ts",
        "convex/schema.ts",
      ],
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
});
