import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  assertExpectedEnvironmentValue,
  assertRequiredEnvironmentNames,
  parseEnvironmentNames,
} from "./check-deployment-environment.mjs";

const requiredNames = [
  "BBPC_API_VERSION",
  "BBPC_ENVIRONMENT",
  "CLERK_JWT_ISSUER_DOMAIN",
  "CLERK_M2M_AUDIENCE",
];

test("parses environment names without accepting values or status text", () => {
  assert.deepEqual(
    [
      ...parseEnvironmentNames(
        [
          "BBPC_API_VERSION",
          "BBPC_ENVIRONMENT",
          "not a variable",
          "CLERK_JWT_ISSUER_DOMAIN=value",
          "",
        ].join("\n"),
      ),
    ],
    ["BBPC_API_VERSION", "BBPC_ENVIRONMENT"],
  );
});

test("requires the complete staging environment-name contract", () => {
  assert.doesNotThrow(() =>
    assertRequiredEnvironmentNames(new Set(requiredNames), requiredNames),
  );
  assert.throws(
    () =>
      assertRequiredEnvironmentNames(
        new Set(requiredNames.slice(0, -1)),
        requiredNames,
      ),
    /CLERK_M2M_AUDIENCE/u,
  );
});

test("compares known non-secret environment values exactly", () => {
  assert.doesNotThrow(() =>
    assertExpectedEnvironmentValue({
      name: "BBPC_ENVIRONMENT",
      actualValue: "staging\n",
      expectedValue: "staging",
    }),
  );
  assert.throws(
    () =>
      assertExpectedEnvironmentValue({
        name: "BBPC_ENVIRONMENT",
        actualValue: "production\n",
        expectedValue: "staging",
      }),
    /does not match the expected staging value/u,
  );
});

test("workflow checks staging environment before deployment", () => {
  const workflow = fs.readFileSync(
    path.resolve(import.meta.dirname, "../.github/workflows/deploy-staging.yml"),
    "utf8",
  );
  const environmentCheckIndex = workflow.indexOf(
    "npm run deploy:environment:check",
  );
  const deployIndex = workflow.indexOf("npx convex deploy");

  assert.match(workflow, /BBPC_EXPECTED_ENVIRONMENT: staging/u);
  assert.ok(environmentCheckIndex >= 0);
  assert.ok(deployIndex > environmentCheckIndex);
});
