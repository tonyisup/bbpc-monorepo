import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import {
  assertProductionDeployAuthorization,
  productionApproval,
  productionDeployment,
  productionOperation,
  stagingDeployment,
} from "./check-production-deploy-authorization.mjs";

const approvedCommit = "920beecaa31763471d143dfe793dc20e9b5d08d2";
const secretSuffix = "never-print-production-deploy-secret";

function authorizedInput(overrides = {}) {
  return {
    deployKey: `prod:${productionDeployment}|${secretSuffix}`,
    expectedEnvironment: "production",
    operation: productionOperation,
    approval: productionApproval,
    approvedCommit,
    actualCommit: `${approvedCommit}\n`,
    worktreeStatus: "",
    ...overrides,
  };
}

test("pins an inert production request to target, commit, and clean tree", () => {
  assert.deepEqual(
    assertProductionDeployAuthorization(authorizedInput()),
    {
      deployment: productionDeployment,
      commit: approvedCommit,
      operation: productionOperation,
    },
  );
});

test("rejects a wrong deployment or non-production key kind", () => {
  assert.throws(
    () =>
      assertProductionDeployAuthorization(
        authorizedInput({
          deployKey: `prod:${stagingDeployment}|${secretSuffix}`,
        }),
      ),
    /does not target the expected Convex deployment/u,
  );
  assert.throws(
    () =>
      assertProductionDeployAuthorization(
        authorizedInput({
          deployKey: `dev:${productionDeployment}|${secretSuffix}`,
        }),
      ),
    /must use a production deploy-key target/u,
  );
});

test("requires the exact environment, operation, and approval", () => {
  assert.throws(
    () =>
      assertProductionDeployAuthorization(
        authorizedInput({ expectedEnvironment: "staging" }),
      ),
    /must be exactly production/u,
  );
  assert.throws(
    () =>
      assertProductionDeployAuthorization(
        authorizedInput({ operation: "deploy" }),
      ),
    /does not authorize the inert deployment boundary/u,
  );
  assert.throws(
    () =>
      assertProductionDeployAuthorization(
        authorizedInput({ approval: "approved" }),
      ),
    /does not match the required exact approval/u,
  );
});

test("rejects an invalid or mismatched commit and any dirty worktree", () => {
  assert.throws(
    () =>
      assertProductionDeployAuthorization(
        authorizedInput({ approvedCommit: "main" }),
      ),
    /exact lowercase 40-character commit/u,
  );
  assert.throws(
    () =>
      assertProductionDeployAuthorization(
        authorizedInput({
          actualCommit: "1111111111111111111111111111111111111111",
        }),
      ),
    /does not match the approved production commit/u,
  );
  assert.throws(
    () =>
      assertProductionDeployAuthorization(
        authorizedInput({ worktreeStatus: " M package.json\n" }),
      ),
    /must be completely clean/u,
  );
});

test("CLI target failure never exposes deploy-key secret material", () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(
        import.meta.dirname,
        "check-production-deploy-authorization.mjs",
      ),
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        CONVEX_DEPLOY_KEY:
          `prod:${stagingDeployment}|${secretSuffix}`,
        BBPC_EXPECTED_ENVIRONMENT: "production",
        BBPC_PRODUCTION_OPERATION: productionOperation,
        BBPC_PRODUCTION_APPROVAL: productionApproval,
        BBPC_PRODUCTION_APPROVED_COMMIT: approvedCommit,
      },
    },
  );

  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, new RegExp(secretSuffix, "u"));
  assert.doesNotMatch(result.stderr, new RegExp(secretSuffix, "u"));
  assert.doesNotMatch(
    result.stderr,
    new RegExp(stagingDeployment, "u"),
  );
});

test("authorization guard has no deployment or mutation capability", () => {
  const source = fs.readFileSync(
    path.join(
      import.meta.dirname,
      "check-production-deploy-authorization.mjs",
    ),
    "utf8",
  );
  const executedPrograms = [
    ...source.matchAll(/execFileSync\(\s*"([^"]+)"/gu),
  ].map((match) => match[1]);
  const gitOperations = [
    ...source.matchAll(/runGit\(\[\s*"([^"]+)"/gu),
  ].map((match) => match[1]);

  assert.deepEqual(executedPrograms, ["git"]);
  assert.deepEqual(gitOperations, ["rev-parse", "status"]);
  assert.doesNotMatch(source, /\b(?:spawn|exec)Sync\s*\(/u);
  assert.doesNotMatch(source, /node_modules[\\/]\.bin/u);
  assert.doesNotMatch(source, /\b(?:writeFile|appendFile|unlink|rename)\b/u);
});
