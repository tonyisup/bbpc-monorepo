import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { ConvexError } from "convex/values";

import {
  assertExpectedStagingState,
  deploymentUrl,
  expectDomainFailure,
  verifyStagingDeployment,
} from "./verify-staging-deployment.mjs";

const apiVersion = "0.1.0";
const stagingDeployment = "merry-shepherd-928";
const productionDeployment = "determined-wombat-872";

test("constructs only a canonical Convex deployment URL", () => {
  assert.equal(
    deploymentUrl("merry-shepherd-928"),
    "https://merry-shepherd-928.convex.cloud",
  );
  assert.throws(
    () => deploymentUrl("https://example.invalid"),
    /deployment name is invalid/u,
  );
});

test("requires the explicitly expected safe staging lifecycle state", () => {
  assert.doesNotThrow(() =>
    assertExpectedStagingState(
      {
        apiVersion,
        initialized: false,
        applicationWritesEnabled: false,
        cutoverStage: "uninitialized",
        firstApplicationWriteRecorded: false,
      },
      apiVersion,
      "uninitialized",
    ),
  );
  assert.doesNotThrow(() =>
    assertExpectedStagingState(
      {
        apiVersion,
        initialized: true,
        applicationWritesEnabled: false,
        cutoverStage: "S2",
        firstApplicationWriteRecorded: false,
      },
      apiVersion,
      "S2",
    ),
  );
  for (const firstApplicationWriteRecorded of [false, true]) {
    assert.doesNotThrow(() =>
      assertExpectedStagingState(
        {
          apiVersion,
          initialized: true,
          applicationWritesEnabled: true,
          cutoverStage: "S3",
          firstApplicationWriteRecorded,
        },
        apiVersion,
        "S3",
      ),
    );
  }
  for (const [readiness, expectedState] of [
    {
      readiness: {
        apiVersion,
        initialized: true,
        applicationWritesEnabled: false,
        cutoverStage: "S2",
        firstApplicationWriteRecorded: false,
      },
      expectedState: "uninitialized",
    },
    {
      readiness: {
        apiVersion,
        initialized: true,
        applicationWritesEnabled: true,
        cutoverStage: "S3",
        firstApplicationWriteRecorded: true,
      },
      expectedState: "S2",
    },
    {
      readiness: {
        apiVersion: "0.0.0",
        initialized: true,
        applicationWritesEnabled: false,
        cutoverStage: "S2",
        firstApplicationWriteRecorded: false,
      },
      expectedState: "S2",
    },
  ].map((value) => [
    value.readiness,
    value.expectedState,
  ])) {
    assert.throws(
      () =>
        assertExpectedStagingState(
          readiness,
          apiVersion,
          expectedState,
        ),
      /expected|write-disabled/u,
    );
  }
  assert.throws(
    () => assertExpectedStagingState({}, apiVersion, "S4"),
    /exactly uninitialized, S2, or S3/u,
  );
});

test("accepts only the expected structured domain failure", async () => {
  await assert.doesNotReject(() =>
    expectDomainFailure(
      async () => {
        throw new ConvexError({
          code: "WRITE_DISABLED",
          message: "Synthetic denial.",
          retryable: false,
        });
      },
      "WRITE_DISABLED",
      "Synthetic probe",
    ),
  );
  await assert.rejects(
    () =>
      expectDomainFailure(
        async () => {
          throw new Error("secret material");
        },
        "WRITE_DISABLED",
        "Synthetic probe",
      ),
    (error) => {
      assert.match(error.message, /unexpected failure/u);
      assert.doesNotMatch(error.message, /secret material/u);
      return true;
    },
  );
  await assert.rejects(
    () =>
      expectDomainFailure(
        async () => undefined,
        "WRITE_DISABLED",
        "Synthetic probe",
      ),
    /unexpectedly succeeded/u,
  );
});

test("verifies aggregate public, denial, and write-gate invariants", async () => {
  let queryCount = 0;
  let mutationCount = 0;
  const client = {
    async query() {
      queryCount += 1;
      if (queryCount === 1) {
        return {
          apiVersion,
          initialized: true,
          applicationWritesEnabled: false,
          cutoverStage: "S2",
          firstApplicationWriteRecorded: false,
        };
      }
      if (queryCount === 2 || queryCount === 3) {
        return [];
      }
      throw new ConvexError({
        code: "AUTHENTICATION_REQUIRED",
        message: "Authentication is required.",
        retryable: false,
      });
    },
    async mutation(_reference, args) {
      mutationCount += 1;
      assert.equal(args.clientApiVersion, apiVersion);
      throw new ConvexError({
        code: "WRITE_DISABLED",
        message: "Application writes are disabled.",
        retryable: false,
      });
    },
  };

  await assert.doesNotReject(async () => {
    assert.deepEqual(
      await verifyStagingDeployment({
        client,
        apiVersion,
        expectedState: "S2",
      }),
      {
        readiness: {
          apiVersion,
          initialized: true,
          applicationWritesEnabled: false,
          cutoverStage: "S2",
          firstApplicationWriteRecorded: false,
        },
        expectedState: "S2",
        publicCatalogCounts: {
          sounders: 0,
          templates: 0,
        },
        anonymousDenials: {
          member: "AUTHENTICATION_REQUIRED",
          administrator: "AUTHENTICATION_REQUIRED",
          pipeline: "AUTHENTICATION_REQUIRED",
        },
        recordingWriteGateProbe: "WRITE_DISABLED",
      },
    );
  });
  assert.equal(queryCount, 6);
  assert.equal(mutationCount, 1);
});

test("verifies the writable S3 gate without committing a probe write", async () => {
  let queryCount = 0;
  let mutationCount = 0;
  const client = {
    async query() {
      queryCount += 1;
      if (queryCount === 1) {
        return {
          apiVersion,
          initialized: true,
          applicationWritesEnabled: true,
          cutoverStage: "S3",
          firstApplicationWriteRecorded: false,
        };
      }
      if (queryCount === 2 || queryCount === 3) {
        return [];
      }
      throw new ConvexError({
        code: "AUTHENTICATION_REQUIRED",
        message: "Authentication is required.",
        retryable: false,
      });
    },
    async mutation(_reference, args) {
      mutationCount += 1;
      assert.equal(args.clientApiVersion, apiVersion);
      throw new ConvexError({
        code: "VALIDATION_FAILED",
        message: "The non-writing probe reached its handler.",
        retryable: false,
      });
    },
  };

  const result = await verifyStagingDeployment({
    client,
    apiVersion,
    expectedState: "S3",
  });

  assert.equal(result.readiness.applicationWritesEnabled, true);
  assert.equal(result.readiness.cutoverStage, "S3");
  assert.equal(
    result.recordingWriteGateProbe,
    "VALIDATION_FAILED",
  );
  assert.equal(queryCount, 6);
  assert.equal(mutationCount, 1);
});

test("CLI target failure does not expose deploy-key secret material", () => {
  const secretSuffix = "never-print-staging-secret";
  const result = spawnSync(
    process.execPath,
    [path.join(import.meta.dirname, "verify-staging-deployment.mjs")],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        CONVEX_DEPLOY_KEY:
          `prod:${productionDeployment}|${secretSuffix}`,
        BBPC_EXPECTED_CONVEX_DEPLOYMENT: stagingDeployment,
        BBPC_FORBIDDEN_CONVEX_DEPLOYMENT: productionDeployment,
      },
    },
  );

  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, new RegExp(secretSuffix, "u"));
  assert.doesNotMatch(result.stderr, new RegExp(secretSuffix, "u"));
  assert.doesNotMatch(
    result.stderr,
    new RegExp(productionDeployment, "u"),
  );
});

test("staging workflow runs invariant verification after deployment", () => {
  const workflow = fs.readFileSync(
    path.resolve(
      import.meta.dirname,
      "../../../.github/workflows/deploy-staging.yml",
    ),
    "utf8",
  );
  const deployIndex = workflow.indexOf("npx convex deploy");
  const invariantIndex = workflow.indexOf(
    "pnpm run deploy:staging:verify",
  );
  const contractIndex = workflow.indexOf(
    "pnpm run contract:compare",
  );

  assert.ok(deployIndex >= 0);
  assert.ok(invariantIndex > deployIndex);
  assert.ok(contractIndex > invariantIndex);
});
