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

export function assertUninitializedReadiness(readiness, apiVersion) {
  if (
    typeof readiness !== "object" ||
    readiness === null ||
    readiness.apiVersion !== apiVersion ||
    readiness.initialized !== false ||
    readiness.applicationWritesEnabled !== false
  ) {
    throw new Error(
      "Staging readiness must be uninitialized, write-disabled, and on the expected API version.",
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
}) {
  const readiness = await runProbe(
    () => client.query(readinessReference, {}),
    "Staging readiness query",
  );
  assertUninitializedReadiness(readiness, apiVersion);

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

  const blockedRecordingWrite = await expectDomainFailure(
    () =>
      client.mutation(recordingWriteReference, {
        clientApiVersion: apiVersion,
      }),
    "WRITE_DISABLED",
    "Recording write-gate probe",
  );

  return {
    readiness: {
      apiVersion: readiness.apiVersion,
      initialized: readiness.initialized,
      applicationWritesEnabled:
        readiness.applicationWritesEnabled,
    },
    publicCatalogCounts: {
      sounders: sounders.length,
      templates: templates.length,
    },
    anonymousDenials,
    blockedRecordingWrite,
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
  });
  process.stdout.write(
    [
      "Staging deployment invariant gate passed.",
      `deployment=${target.deployment}`,
      `apiVersion=${result.readiness.apiVersion}`,
      "initialized=false",
      "applicationWritesEnabled=false",
      "anonymousReads=3",
      "anonymousCatalogReads=2",
      "blockedWrites=1",
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
