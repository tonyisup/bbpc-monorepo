import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

const restrictedServerImports = {
  paths: [
    {
      name: "./_generated/server",
      importNames: [
        "query",
        "mutation",
        "action",
        "internalQuery",
        "internalMutation",
        "internalAction",
      ],
      message:
        "Import function builders from convex/functions.ts; raw builders are restricted to that boundary.",
    },
  ],
  patterns: [
    {
      group: ["**/_generated/server"],
      importNames: [
        "query",
        "mutation",
        "action",
        "internalQuery",
        "internalMutation",
        "internalAction",
      ],
      message:
        "Import function builders from convex/functions.ts; raw builders are restricted to that boundary.",
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "coverage/**",
      "dist/**",
      "eslint.config.mjs",
      "contracts/convexApi.ts",
      "contracts/generated/**",
      "convex/_generated/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/array-type": ["error", { default: "array-simple" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/require-await": "off",
      "no-restricted-imports": ["error", restrictedServerImports],
    },
  },
  {
    files: ["convex/functions.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    files: ["scripts/**/*.mjs", "contracts/**/*.js"],
    ...tseslint.configs.disableTypeChecked,
  },
);
