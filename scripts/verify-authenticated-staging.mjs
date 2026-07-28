import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { pathToFileURL } from "node:url";

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";

import { assertDeployTarget } from "./check-deploy-target.mjs";
import { deploymentUrl } from "./verify-staging-deployment.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const probeTimeoutMilliseconds = 15_000;
const jwtPattern =
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;

const readinessReference = makeFunctionReference(
  "system/health:readiness",
);
const memberProfileReference = makeFunctionReference(
  "identity/profile:me",
);
const administratorReference = makeFunctionReference(
  "admin/dashboard:overview",
);
const pipelineReference = makeFunctionReference(
  "pipeline/status:capabilities",
);
const memberWriteReference = makeFunctionReference(
  "system/health:memberWriteGateProbe",
);
const administratorWriteReference = makeFunctionReference(
  "system/health:administratorWriteGateProbe",
);
const pipelineWriteReference = makeFunctionReference(
  "system/health:pipelineWriteGateProbe",
);

export function readPrivateToken(filePath, label) {
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    stat.size < 20 ||
    stat.size > 16_384
  ) {
    throw new Error(
      `${label} must be a private regular token file.`,
    );
  }
  const token = fs.readFileSync(resolved, "utf8").trim();
  if (!jwtPattern.test(token)) {
    throw new Error(`${label} must contain one compact JWT.`);
  }
  return token;
}

export function assertInitializedReadiness(
  readiness,
  apiVersion,
) {
  if (
    typeof readiness !== "object" ||
    readiness === null ||
    readiness.apiVersion !== apiVersion ||
    readiness.initialized !== true ||
    readiness.applicationWritesEnabled !== false
  ) {
    throw new Error(
      "Authenticated staging must be initialized, write-disabled, and on the expected API version.",
    );
  }
}

async function withTimeout(operation, label) {
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
  } catch (error) {
    if (error instanceof ConvexError) {
      throw error;
    }
    throw new Error(`${label} failed.`);
  } finally {
    clearTimeout(timer);
  }
}

export async function expectDomainFailure(
  operation,
  expectedCode,
  label,
) {
  try {
    await withTimeout(operation, label);
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
  }
  throw new Error(`${label} unexpectedly succeeded.`);
}

export async function verifyAuthenticatedStaging({
  clients,
  apiVersion,
}) {
  const readiness = await withTimeout(
    () => clients.anonymous.query(readinessReference, {}),
    "Authenticated staging readiness query",
  );
  assertInitializedReadiness(readiness, apiVersion);

  const [memberProfile, administratorDashboard, pipelineCapabilities] =
    await Promise.all([
      withTimeout(
        () => clients.member.query(memberProfileReference, {}),
        "Member read probe",
      ),
      withTimeout(
        () =>
          clients.administrator.query(
            administratorReference,
            {},
          ),
        "Administrator read probe",
      ),
      withTimeout(
        () => clients.pipeline.query(pipelineReference, {}),
        "Pipeline read probe",
      ),
    ]);
  if (
    typeof memberProfile?.id !== "string" ||
    typeof administratorDashboard !== "object" ||
    administratorDashboard === null ||
    !Array.isArray(pipelineCapabilities?.permissions) ||
    pipelineCapabilities.permissions.length !== 1 ||
    pipelineCapabilities.permissions[0] !== "pipeline:publish"
  ) {
    throw new Error(
      "Authenticated staging read probes returned invalid results.",
    );
  }

  const unlinkedDenial = await expectDomainFailure(
    () => clients.unlinked.query(memberProfileReference, {}),
    "IDENTITY_NOT_LINKED",
    "Unlinked identity probe",
  );
  const blockedWrites = {
    member: await expectDomainFailure(
      () =>
        clients.member.mutation(memberWriteReference, {
          clientApiVersion: apiVersion,
        }),
      "WRITE_DISABLED",
      "Member write-gate probe",
    ),
    administrator: await expectDomainFailure(
      () =>
        clients.administrator.mutation(
          administratorWriteReference,
          { clientApiVersion: apiVersion },
        ),
      "WRITE_DISABLED",
      "Administrator write-gate probe",
    ),
    pipeline: await expectDomainFailure(
      () =>
        clients.pipeline.mutation(pipelineWriteReference, {
          clientApiVersion: apiVersion,
        }),
      "WRITE_DISABLED",
      "Pipeline write-gate probe",
    ),
  };

  return {
    readiness: {
      apiVersion: readiness.apiVersion,
      initialized: readiness.initialized,
      applicationWritesEnabled:
        readiness.applicationWritesEnabled,
    },
    reads: {
      member: "pass",
      administrator: "pass",
      pipeline: "pass",
    },
    unlinkedDenial,
    blockedWrites,
  };
}

function createClient(url, token) {
  const client = new ConvexHttpClient(url, { logger: false });
  client.setAuth(token);
  client.setDebug(false);
  return client;
}

export async function main(env = process.env) {
  const target = assertDeployTarget({
    deployKey: env.CONVEX_DEPLOY_KEY,
    expectedDeployment: env.BBPC_EXPECTED_CONVEX_DEPLOYMENT,
    forbiddenDeployment: env.BBPC_FORBIDDEN_CONVEX_DEPLOYMENT,
  });
  const tokenFiles = {
    administrator: env.BBPC_STAGING_ADMIN_TOKEN_FILE,
    member: env.BBPC_STAGING_MEMBER_TOKEN_FILE,
    pipeline: env.BBPC_STAGING_PIPELINE_TOKEN_FILE,
    unlinked: env.BBPC_STAGING_UNLINKED_TOKEN_FILE,
  };
  for (const [actor, filePath] of Object.entries(tokenFiles)) {
    if (typeof filePath !== "string" || filePath.length === 0) {
      throw new Error(
        `Missing private staging token file for ${actor}.`,
      );
    }
  }
  const tokens = Object.fromEntries(
    Object.entries(tokenFiles).map(([actor, filePath]) => [
      actor,
      readPrivateToken(filePath, `${actor} staging token`),
    ]),
  );
  if (new Set(Object.values(tokens)).size !== 4) {
    throw new Error(
      "Staging administrator, member, pipeline, and unlinked tokens must be distinct.",
    );
  }
  const packageJson = JSON.parse(
    fs.readFileSync(
      path.join(repositoryRoot, "package.json"),
      "utf8",
    ),
  );
  const url = deploymentUrl(target.deployment);
  await verifyAuthenticatedStaging({
    clients: {
      anonymous: new ConvexHttpClient(url, { logger: false }),
      administrator: createClient(url, tokens.administrator),
      member: createClient(url, tokens.member),
      pipeline: createClient(url, tokens.pipeline),
      unlinked: createClient(url, tokens.unlinked),
    },
    apiVersion: packageJson.version,
  });
  process.stdout.write(
    [
      "Authenticated staging gate passed.",
      `deployment=${target.deployment}`,
      `apiVersion=${packageJson.version}`,
      "cutoverStage=S2",
      "authenticatedReads=3",
      "unlinkedDenials=1",
      "blockedWrites=3",
      "tokensRetained=0",
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
        : "Unknown authenticated staging error.";
    process.stderr.write(
      `Authenticated staging gate failed: ${message}\n`,
    );
    process.exitCode = 1;
  }
}
