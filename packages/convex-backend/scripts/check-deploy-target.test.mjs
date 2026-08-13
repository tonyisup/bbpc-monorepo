import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import {
  assertDeployTarget,
  parseDeployKeyTarget,
} from "./check-deploy-target.mjs";

const stagingDeployment = "merry-shepherd-928";
const productionDeployment = "determined-wombat-872";
const secretSuffix = "do-not-print-this-secret";

test("parses the deployment target without returning secret material", () => {
  assert.deepEqual(
    parseDeployKeyTarget(`prod:${stagingDeployment}|${secretSuffix}`),
    {
      kind: "prod",
      deployment: stagingDeployment,
    },
  );
});

test("accepts only the expected non-production deployment", () => {
  assert.deepEqual(
    assertDeployTarget({
      deployKey: `prod:${stagingDeployment}|${secretSuffix}`,
      expectedDeployment: stagingDeployment,
      forbiddenDeployment: productionDeployment,
    }),
    {
      kind: "prod",
      deployment: stagingDeployment,
    },
  );
});

test("rejects a valid key for the wrong deployment without leaking it", () => {
  assert.throws(
    () =>
      assertDeployTarget({
        deployKey: `prod:${productionDeployment}|${secretSuffix}`,
        expectedDeployment: stagingDeployment,
        forbiddenDeployment: productionDeployment,
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /does not target the expected Convex/u);
      assert.doesNotMatch(error.message, new RegExp(secretSuffix, "u"));
      assert.doesNotMatch(error.message, new RegExp(productionDeployment, "u"));
      return true;
    },
  );
});

test("rejects missing, malformed, and ambiguous configuration", () => {
  assert.throws(
    () => parseDeployKeyTarget(undefined),
    /CONVEX_DEPLOY_KEY is required/u,
  );
  assert.throws(
    () => parseDeployKeyTarget(`prod|${secretSuffix}`),
    /unsupported target header/u,
  );
  assert.throws(
    () =>
      assertDeployTarget({
        deployKey: `prod:${stagingDeployment}|${secretSuffix}`,
        expectedDeployment: stagingDeployment,
        forbiddenDeployment: stagingDeployment,
      }),
    /must be different/u,
  );
});

test("CLI failure output never includes the deploy-key secret", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(import.meta.dirname, "check-deploy-target.mjs")],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        CONVEX_DEPLOY_KEY: `prod:${productionDeployment}|${secretSuffix}`,
        BBPC_EXPECTED_CONVEX_DEPLOYMENT: stagingDeployment,
        BBPC_FORBIDDEN_CONVEX_DEPLOYMENT: productionDeployment,
      },
    },
  );

  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, new RegExp(secretSuffix, "u"));
  assert.doesNotMatch(result.stderr, new RegExp(secretSuffix, "u"));
  assert.doesNotMatch(result.stderr, new RegExp(productionDeployment, "u"));
});

test("staging workflow pins and verifies the key target before deployment", () => {
  const workflow = fs.readFileSync(
    path.resolve(
      import.meta.dirname,
      "../../../.github/workflows/deploy-staging.yml",
    ),
    "utf8",
  );
  const checkIndex = workflow.indexOf("pnpm run deploy:target:check");
  const deployIndex = workflow.indexOf("npx convex deploy");

  assert.match(
    workflow,
    new RegExp(
      `BBPC_EXPECTED_CONVEX_DEPLOYMENT: ${stagingDeployment}`,
      "u",
    ),
  );
  assert.match(
    workflow,
    new RegExp(
      `BBPC_FORBIDDEN_CONVEX_DEPLOYMENT: ${productionDeployment}`,
      "u",
    ),
  );
  assert.ok(checkIndex >= 0);
  assert.ok(deployIndex > checkIndex);
  assert.match(
    workflow,
    /BBPC_EXPECTED_STAGING_STATE: S3/u,
  );
  assert.match(
    workflow,
    /npx convex-helpers ts-api-spec --output-file/u,
  );
  assert.match(workflow, /pnpm run contract:compare contracts\/convexApi\.ts/u);
  assert.doesNotMatch(workflow, /ts-api-spec[^\n]*--prod/u);
});
