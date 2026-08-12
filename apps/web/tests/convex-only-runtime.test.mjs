import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";

import {
  PredictionRoundError,
  PredictionRoundState,
  getPredictionRoundState,
} from "../src/lib/predictionRound.mjs";

const root = new URL("..", import.meta.url);
const read = (/** @type {string} */ path) =>
  readFileSync(new URL(path, root), "utf8");

function sourceFiles(/** @type {string} */ directory) {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
    } else if ([".js", ".mjs", ".ts", ".tsx"].includes(extname(path))) {
      files.push(path);
    }
  }
  return files;
}

test("public runtime has no SQL selector, Prisma, tRPC, or NextAuth path", () => {
  const sourceRoot = new URL("src", root).pathname;
  const source = sourceFiles(sourceRoot)
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  const packageJson = JSON.parse(read("package.json"));
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  assert.doesNotMatch(source, /NEXT_PUBLIC_BBPC_BACKEND/);
  assert.doesNotMatch(
    source,
    /@prisma|@trpc|next-auth|@\/server\/(?:db|auth|sql)|@\/trpc/
  );
  for (const dependency of [
    "@next-auth/prisma-adapter",
    "@prisma/adapter-mssql",
    "@prisma/client",
    "@trpc/client",
    "@trpc/next",
    "@trpc/react-query",
    "@trpc/server",
    "mssql",
    "next-auth",
    "prisma",
  ]) {
    assert.equal(dependencies[dependency], undefined, dependency);
  }

  assert.equal(existsSync(new URL("src/server/api", root)), false);
  assert.equal(existsSync(new URL("src/server/sql", root)), false);
  assert.equal(existsSync(new URL("src/trpc", root)), false);
  assert.equal(existsSync(new URL("prisma", root)), false);
});

test("Convex and Clerk configuration is mandatory", () => {
  const runtimeEnv = read("src/env.mjs");
  const exampleEnv = read(".env.example");

  assert.match(runtimeEnv, /CLERK_SECRET_KEY: z\.string\(\)\.min\(1\)/);
  assert.match(
    runtimeEnv,
    /NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z\.string\(\)\.min\(1\)/
  );
  assert.match(runtimeEnv, /NEXT_PUBLIC_CONVEX_URL: z\.string\(\)\.url\(\)/);
  assert.doesNotMatch(exampleEnv, /DATABASE_URL|NEXTAUTH_|BBPC_BACKEND/);
});

test("prediction rounds retain the production lock rules", () => {
  assert.equal(getPredictionRoundState("next"), PredictionRoundState.OPEN);
  assert.equal(
    getPredictionRoundState("next", false),
    PredictionRoundState.LOCKED
  );
  assert.equal(
    getPredictionRoundState("recording"),
    PredictionRoundState.LOCKED
  );
  assert.equal(
    getPredictionRoundState("published"),
    PredictionRoundState.LOCKED
  );
  assert.equal(
    getPredictionRoundState("draft"),
    PredictionRoundState.UNAVAILABLE
  );
  assert.equal(PredictionRoundError.ROUND_LOCKED, "ROUND_LOCKED");
});
