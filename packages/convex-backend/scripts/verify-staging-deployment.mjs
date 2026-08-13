import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { pathToFileURL } from "node:url";

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";

import { assertDeployTarget } from "./check-deploy-target.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const deploymentNamePattern = /^[a-z][a-z0-9-]*-[0-9]+$/u;
const probeTimeoutMilliseconds = 15_000;

const readinessReference = makeFunctionReference(
  "system/health:readiness",
);
const soundersReference = makeFunctionReference(
  "recording/sounders:list",
);
const templatesReference = makeFunctionReference(
  "recording/templates:list",
);
const memberReference = makeFunctionReference(
  "identity/profile:me",
);
const administratorReference = makeFunctionReference(
  "admin/dashboard:overview",
);
const pipelineReference = makeFunctionReference(
  "pipeline/status:capabilities",
);
const recordingWriteReference = makeFunctionReference(
  "system/health:applicationWriteGateProbe",
);

export function deploymentUrl(deployment) {
  if (
    typeof deployment !== "string" ||
    !deploymentNamePattern.test(deployment)
  ) {
    throw new Error("The staging deployment name is invalid.");
  }
  return `https://${deployment}.convex.cloud`;
}

export function assertExpectedStagingState(
  readiness,
  apiVersion,
  expectedState,
) {
  if (!["uninitialized", "S2", "S3"].includes(expectedState)) {
    throw new Error(
      "Expected staging state must be exactly uninitialized, S2, or S3.",
    );
  }
  const expected = {
    uninitialized: {
      initialized: false,
      applicationWritesEnabled: false,
      cutoverStage: "uninitialized",
      requireNoFirstApplicationWrite: true,
    },
    S2: {
      initialized: true,
      applicationWritesEnabled: false,
      cutoverStage: "S2",
      requireNoFirstApplicationWrite: true,
    },
    S3: {
      initialized: true,
      applicationWritesEnabled: true,
      cutoverStage: "S3",
      requireNoFirstApplicationWrite: false,
    },
  }[expectedState];
  if (
    typeof readiness !== "object" ||
    readiness === null ||
    readiness.apiVersion !== apiVersion ||
    readiness.initialized !== expected.initialized ||
    readiness.applicationWritesEnabled !==
      expected.applicationWritesEnabled ||
    readiness.cutoverStage !== expected.cutoverStage ||
    typeof readiness.firstApplicationWriteRecorded !== "boolean" ||
    (expected.requireNoFirstApplicationWrite &&
      readiness.firstApplicationWriteRecorded !== false)
  ) {
    throw new Error(
      "Staging readiness does not match the expected lifecycle state and API version.",
    );
  }
}

export async function expectDomainFailure(
  operation,
  expectedCode,
  label,
) {
  let timer;
  try {
    await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("probe timeout")),
          probeTimeoutMilliseconds,
        );
      }),
    ]);
  } catch (error) {
    if (
      error instanceof ConvexError &&
      typeof error.data === "object" &&
      error.data !== null &&
      error.data.code === expectedCode
    ) {
      return expectedCode;
    }
    throw new Error(`${label} returned an unexpected failure.`);
  } finally {
    clearTimeout(timer);
  }
  throw new Error(`${label} unexpectedly succeeded.`);
}

async function runProbe(operation, label) {
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("probe timeout")),
          probeTimeoutMilliseconds,
        );
      }),
    ]);
  } catch {
    throw new Error(`${label} failed.`);
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyStagingDeployment({
  client,
  apiVersion,
  expectedState,
}) {
  const readiness = await runProbe(
    () => client.query(readinessReference, {}),
    "Staging readiness query",
  );
  assertExpectedStagingState(
    readiness,
    apiVersion,
    expectedState,
  );

  const [sounders, templates] = await Promise.all([
    runProbe(
      () => client.query(soundersReference, {}),
      "Anonymous sounder query",
    ),
    runProbe(
      () => client.query(templatesReference, {}),
      "Anonymous template query",
    ),
  ]);
  if (!Array.isArray(sounders) || !Array.isArray(templates)) {
    throw new Error("Anonymous catalog probes returned invalid results.");
  }

  const anonymousDenials = {
    member: await expectDomainFailure(
      () => client.query(memberReference, {}),
      "AUTHENTICATION_REQUIRED",
      "Anonymous member read probe",
    ),
    administrator: await expectDomainFailure(
      () => client.query(administratorReference, {}),
      "AUTHENTICATION_REQUIRED",
      "Anonymous administrator read probe",
    ),
    pipeline: await expectDomainFailure(
      () => client.query(pipelineReference, {}),
      "AUTHENTICATION_REQUIRED",
      "Anonymous pipeline read probe",
    ),
  };

  const expectedWriteGateCode =
    expectedState === "S3"
      ? "VALIDATION_FAILED"
      : "WRITE_DISABLED";
  const recordingWriteGateProbe = await expectDomainFailure(
    () =>
      client.mutation(recordingWriteReference, {
        clientApiVersion: apiVersion,
      }),
    expectedWriteGateCode,
    "Recording write-gate probe",
  );

  return {
    readiness: {
      apiVersion: readiness.apiVersion,
      initialized: readiness.initialized,
      applicationWritesEnabled:
        readiness.applicationWritesEnabled,
      cutoverStage: readiness.cutoverStage,
      firstApplicationWriteRecorded:
        readiness.firstApplicationWriteRecorded,
    },
    expectedState,
    publicCatalogCounts: {
      sounders: sounders.length,
      templates: templates.length,
    },
    anonymousDenials,
    recordingWriteGateProbe,
  };
}

export async function main(env = process.env) {
  const target = assertDeployTarget({
    deployKey: env.CONVEX_DEPLOY_KEY,
    expectedDeployment: env.BBPC_EXPECTED_CONVEX_DEPLOYMENT,
    forbiddenDeployment: env.BBPC_FORBIDDEN_CONVEX_DEPLOYMENT,
  });
  const packageJson = JSON.parse(
    fs.readFileSync(
      path.join(repositoryRoot, "package.json"),
      "utf8",
    ),
  );
  const result = await verifyStagingDeployment({
    client: new ConvexHttpClient(deploymentUrl(target.deployment)),
    apiVersion: packageJson.version,
    expectedState: env.BBPC_EXPECTED_STAGING_STATE,
  });
  process.stdout.write(
    [
      "Staging deployment invariant gate passed.",
      `deployment=${target.deployment}`,
      `apiVersion=${result.readiness.apiVersion}`,
      `expectedState=${result.expectedState}`,
      `initialized=${String(result.readiness.initialized)}`,
      `applicationWritesEnabled=${String(result.readiness.applicationWritesEnabled)}`,
      "anonymousReads=3",
      "anonymousCatalogReads=2",
      `writeGateProbe=${result.recordingWriteGateProbe}`,
      `sounders=${String(result.publicCatalogCounts.sounders)}`,
      `templates=${String(result.publicCatalogCounts.templates)}`,
      "",
    ].join(" "),
  );
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(invokedPath).href
) {
  try {
    await main();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown staging-invariant error.";
    process.stderr.write(
      `Staging deployment invariant gate failed: ${message}\n`,
    );
    process.exitCode = 1;
  }
}
