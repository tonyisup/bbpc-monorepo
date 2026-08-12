import { spawnSync } from "node:child_process";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BBPC_API_VERSION } from "../../contracts/index.js";
import { assertDeployTarget } from "../../scripts/check-deploy-target.mjs";
import { main as checkDeploymentEnvironment } from "../../scripts/check-deployment-environment.mjs";
import { EXPECTED_SOURCE_FINGERPRINT } from "../sql/manifest.mjs";
import {
  executeRehearsalPlan,
  isRehearsalStepComplete,
  shouldStageForResume,
} from "../sql/rehearsal-plan.mjs";
import { verifySyntheticFixture } from "./synthetic-fixture.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const runIdPattern = /^[A-Za-z0-9._:-]{1,100}$/u;
const requiredStagingAcknowledgement =
  "--ack-synthetic-staging-only";
const requiredInitializationAcknowledgement =
  "--ack-initialize-empty-staging";
const rawIdentityTables = [
  "migrationRawUsers",
  "migrationRawRoles",
  "migrationRawUserRoles",
];

function identityStartStep(manifest) {
  return {
    kind: "once",
    label: "Start synthetic identity",
    functionName: "migration/identity:startIdentityRun",
    operationId: "identity.start",
    args: {
      sourceSchemaFingerprint: EXPECTED_SOURCE_FINGERPRINT,
      expectedUsers:
        manifest.tables.migrationRawUsers.rowCount,
      expectedRoles:
        manifest.tables.migrationRawRoles.rowCount,
      expectedUserRoles:
        manifest.tables.migrationRawUserRoles.rowCount,
    },
    completion: {
      kind: "domainExists",
      domain: "identity",
    },
  };
}

function batchStep(
  label,
  functionName,
  operationId,
  expectedCount,
) {
  return {
    kind: "batch",
    label,
    functionName,
    operationId,
    expectedCount,
    completion: {
      kind: "checkpointCompleted",
      operation: operationId,
    },
  };
}

function finishStep(
  label,
  functionName,
  operationId,
  completionKind,
) {
  return {
    kind: "once",
    label,
    functionName,
    operationId,
    args: {},
    completion: {
      kind: completionKind,
      domain: "identity",
    },
  };
}

export function buildSyntheticIdentityPlan(manifest) {
  const counts = {
    users: manifest?.tables?.migrationRawUsers?.rowCount,
    roles: manifest?.tables?.migrationRawRoles?.rowCount,
    userRoles:
      manifest?.tables?.migrationRawUserRoles?.rowCount,
  };
  if (
    counts.users !== 2 ||
    counts.roles !== 1 ||
    counts.userRoles !== 1
  ) {
    throw new Error(
      "Synthetic staging identity counts must be exactly 2/1/1.",
    );
  }
  return [
    identityStartStep(manifest),
    batchStep(
      "Transform synthetic roles",
      "migration/identity:transformRolesBatch",
      "identity.roles",
      counts.roles,
    ),
    batchStep(
      "Transform synthetic users",
      "migration/identity:transformUsersBatch",
      "identity.users",
      counts.users,
    ),
    batchStep(
      "Transform synthetic user-role links",
      "migration/identity:transformUserRolesBatch",
      "identity.userRoles",
      counts.userRoles,
    ),
    finishStep(
      "Finish synthetic identity transform",
      "migration/identity:finishIdentityRun",
      "identity.finish",
      "domainTransformed",
    ),
    batchStep(
      "Reconcile synthetic users",
      "migration/identityReconciliation:reconcileUsersBatch",
      "identity.reconcile.users",
      counts.users,
    ),
    batchStep(
      "Reconcile synthetic roles",
      "migration/identityReconciliation:reconcileRolesBatch",
      "identity.reconcile.roles",
      counts.roles,
    ),
    batchStep(
      "Reconcile synthetic user-role links",
      "migration/identityReconciliation:reconcileUserRolesBatch",
      "identity.reconcile.userRoles",
      counts.userRoles,
    ),
    finishStep(
      "Finish synthetic identity reconciliation",
      "migration/identityReconciliation:finishIdentityReconciliation",
      "identity.reconcile.finish",
      "domainReconciled",
    ),
  ];
}

export function assertFreshTarget(result) {
  if (
    result?.fresh !== true ||
    !Array.isArray(result.nonemptyTables) ||
    result.nonemptyTables.length !== 0
  ) {
    throw new Error(
      "Staging must be completely empty before fresh synthetic initialization.",
    );
  }
}

export function assertResumableTarget(progress) {
  if (
    progress?.initialized !== true ||
    progress.matchesRun !== true ||
    !["S0", "S1", "S2"].includes(progress.cutoverStage) ||
    progress.apiVersion !== BBPC_API_VERSION ||
    typeof progress.domainStatuses !== "object" ||
    progress.domainStatuses === null ||
    typeof progress.checkpointStatuses !== "object" ||
    progress.checkpointStatuses === null
  ) {
    throw new Error(
      "Staging is not resumable for the requested synthetic run.",
    );
  }
}

export function assertUserEvidence(evidence, expectedStage = "S1") {
  const stageMatches =
    expectedStage === "S1"
      ? evidence?.cutoverStageS1 === true
      : expectedStage === "S2" &&
        evidence?.cutoverStageS2 === true;
  if (
    evidence?.runMatches !== true ||
    !stageMatches ||
    evidence.applicationWritesDisabled !== true ||
    evidence.firstApplicationWriteAbsent !== true ||
    evidence.linkedIdentityCount !== 2 ||
    evidence.linkedUserCount !== 2 ||
    evidence.linkedActiveUserCount !== 2 ||
    evidence.linkedAdminUserCount !== 1 ||
    evidence.preprovisionAuditCount !== 2 ||
    evidence.ordinaryLinkAuditCount !== 0
  ) {
    throw new Error(
      "Synthetic administrator/member evidence is incomplete.",
    );
  }
}

export function assertPipelineEvidence(
  evidence,
  expectedStage = "S1",
) {
  const stageMatches =
    expectedStage === "S1"
      ? evidence?.cutoverStageS1 === true
      : expectedStage === "S2" &&
        evidence?.cutoverStageS2 === true;
  if (
    evidence?.runMatches !== true ||
    !stageMatches ||
    evidence.applicationWritesDisabled !== true ||
    evidence.firstApplicationWriteAbsent !== true ||
    evidence.principalFound !== true ||
    evidence.principalRunMatches !== true ||
    evidence.principalActive !== true ||
    evidence.permissionCount !== 1 ||
    evidence.publishOnly !== true ||
    evidence.preprovisionAuditCount !== 1 ||
    evidence.statusChangeAuditCount !== 2 ||
    evidence.statusChangeTransitionsValid !== true
  ) {
    throw new Error(
      "Synthetic pipeline evidence is incomplete.",
    );
  }
}

function parseArguments(argv) {
  const options = {
    runId: null,
    fixtureDirectory: null,
    batchSize: 10,
    dryRun: false,
    resume: false,
    acknowledgements: new Set(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--run-id" || name === "--fixture-directory") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`Missing value for ${name}.`);
      }
      if (name === "--run-id") {
        options.runId = value;
      } else {
        options.fixtureDirectory = path.resolve(value);
      }
      index += 1;
    } else if (name === "--batch-size") {
      const value = Number(argv[index + 1]);
      if (!Number.isSafeInteger(value)) {
        throw new Error("--batch-size must be an integer.");
      }
      options.batchSize = value;
      index += 1;
    } else if (name === "--dry-run") {
      options.dryRun = true;
    } else if (name === "--resume") {
      options.resume = true;
    } else if (
      name === requiredStagingAcknowledgement ||
      name === requiredInitializationAcknowledgement
    ) {
      options.acknowledgements.add(name);
    } else {
      throw new Error(`Unknown argument: ${String(name)}`);
    }
  }
  if (
    typeof options.runId !== "string" ||
    !runIdPattern.test(options.runId)
  ) {
    throw new Error("A safe --run-id is required.");
  }
  if (options.fixtureDirectory === null) {
    throw new Error("--fixture-directory is required.");
  }
  if (
    options.batchSize < 1 ||
    options.batchSize > 100
  ) {
    throw new Error("--batch-size must be from 1 through 100.");
  }
  if (
    !options.dryRun &&
    (!options.acknowledgements.has(
      requiredStagingAcknowledgement,
    ) ||
      !options.acknowledgements.has(
        requiredInitializationAcknowledgement,
      ))
  ) {
    throw new Error(
      "Both synthetic staging initialization acknowledgements are required.",
    );
  }
  return options;
}

function commandName(name) {
  return process.platform === "win32" && name === "npx"
    ? "npx.cmd"
    : name;
}

function runCommand(command, args, label) {
  const result = spawnSync(commandName(command), args, {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    maxBuffer: 4 * 1024 * 1024,
    stdio: "pipe",
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed.`);
  }
  return result.stdout.trim();
}

function runConvex(functionName, args) {
  const output = runCommand(
    "npx",
    [
      "convex",
      "run",
      "--codegen",
      "disable",
      functionName,
      JSON.stringify(args),
    ],
    `Staging Convex call ${functionName}`,
  );
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(
      `Staging Convex call ${functionName} returned invalid JSON.`,
    );
  }
}

function importRawTable(table, filePath) {
  runCommand(
    "npx",
    [
      "convex",
      "import",
      "--table",
      table,
      "--format",
      "jsonLines",
      "--replace",
      "--yes",
      filePath,
    ],
    `Synthetic staging import ${table}`,
  );
}

function initializeAndEnterS1(runId) {
  runConvex("system/cutover:initialize", {
    cutoverRunId: runId,
    apiVersion: BBPC_API_VERSION,
    actor: "synthetic-staging-initializer",
  });
  runConvex("system/cutover:transition", {
    cutoverRunId: runId,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "synthetic-staging-initializer",
  });
}

function provisionPrincipals(
  runId,
  provisioning,
  { cyclePipelineStatus = true } = {},
) {
  for (const actor of ["admin", "member"]) {
    const user = provisioning.users[actor];
    runConvex(
      "identity/provisioning:preprovisionSmokeUser",
      {
        cutoverRunId: runId,
        operationId: `identity.preprovision.${actor}`,
        ...user,
      },
    );
  }
  const pipeline = runConvex(
    "identity/provisioning:preprovisionPipelineService",
    {
      cutoverRunId: runId,
      operationId: "identity.preprovision.pipeline",
      ...provisioning.pipeline,
    },
  );
  if (typeof pipeline?.servicePrincipalId !== "string") {
    throw new Error(
      "Synthetic pipeline provisioning returned an invalid principal.",
    );
  }
  const transitions = [
    {
      operationId: "identity.pipeline.disable",
      expectedStatus: "active",
      status: "disabled",
    },
    {
      operationId: "identity.pipeline.reenable",
      expectedStatus: "disabled",
      status: "active",
    },
  ];
  for (const transition of cyclePipelineStatus
    ? transitions
    : []) {
    runConvex(
      "identity/provisioning:setPipelineServiceStatus",
      {
        cutoverRunId: runId,
        servicePrincipalId: pipeline.servicePrincipalId,
        ...transition,
      },
    );
  }
  return pipeline.servicePrincipalId;
}

function verifyProvisioning(
  runId,
  servicePrincipalId,
  expectedStage,
) {
  const userEvidence = runConvex(
    "migration/rehearsal:inspectUserIdentityEvidence",
    { runId },
  );
  const pipelineEvidence = runConvex(
    "migration/rehearsal:inspectPipelineIdentityEvidence",
    { runId, servicePrincipalId },
  );
  assertUserEvidence(userEvidence, expectedStage);
  assertPipelineEvidence(pipelineEvidence, expectedStage);
}

export async function main(
  argv = process.argv.slice(2),
  env = process.env,
) {
  const options = parseArguments(argv);
  const fixture = verifySyntheticFixture(
    options.fixtureDirectory,
  );
  if (fixture.manifest.runId !== options.runId) {
    throw new Error(
      "Synthetic staging fixture run ID does not match.",
    );
  }
  const plan = buildSyntheticIdentityPlan(
    fixture.manifest,
  );
  if (options.dryRun) {
    process.stdout.write(
      [
        "Synthetic staging initialization dry run passed.",
        `runId=${options.runId}`,
        "targetMutations=20",
        "rawImports=3",
        `identitySteps=${String(plan.length)}`,
        "humanPrincipals=2",
        "pipelinePrincipals=1",
        "productionRows=0",
        "",
      ].join(" "),
    );
    return;
  }

  assertDeployTarget({
    deployKey: env.CONVEX_DEPLOY_KEY,
    expectedDeployment:
      env.BBPC_EXPECTED_CONVEX_DEPLOYMENT,
    forbiddenDeployment:
      env.BBPC_FORBIDDEN_CONVEX_DEPLOYMENT,
  });
  checkDeploymentEnvironment(env);

  let progress;
  let stageRawTables = true;
  if (options.resume) {
    progress = runConvex(
      "migration/rehearsal:inspectRunProgress",
      { runId: options.runId },
    );
    assertResumableTarget(progress);
    if (progress.cutoverStage === "S2") {
      const servicePrincipalId = provisionPrincipals(
        options.runId,
        fixture.provisioning,
        { cyclePipelineStatus: false },
      );
      verifyProvisioning(
        options.runId,
        servicePrincipalId,
        "S2",
      );
      process.stdout.write(
        [
          "Synthetic staging initialization already complete.",
          `runId=${options.runId}`,
          "cutoverStage=S2",
          "applicationWritesEnabled=false",
          "",
        ].join(" "),
      );
      return;
    }
    stageRawTables = shouldStageForResume(progress);
  } else {
    assertFreshTarget(
      runConvex(
        "migration/rehearsal:inspectFreshTarget",
        {},
      ),
    );
    progress = {
      initialized: false,
      matchesRun: false,
      domainStatuses: {},
      checkpointStatuses: {},
    };
  }

  if (stageRawTables) {
    for (const table of rawIdentityTables) {
      importRawTable(table, fixture.tableFiles[table]);
    }
  }
  if (progress.initialized !== true) {
    initializeAndEnterS1(options.runId);
    progress = {
      initialized: true,
      matchesRun: true,
      cutoverStage: "S1",
      apiVersion: BBPC_API_VERSION,
      domainStatuses: {},
      checkpointStatuses: {},
    };
  } else if (progress.cutoverStage === "S0") {
    runConvex("system/cutover:transition", {
      cutoverRunId: options.runId,
      expectedStage: "S0",
      nextStage: "S1",
      actor: "synthetic-staging-initializer",
    });
  }

  await executeRehearsalPlan({
    steps: plan,
    runId: options.runId,
    batchSize: options.batchSize,
    isComplete: async (step) =>
      isRehearsalStepComplete(step, progress),
    invoke: async (step, args) =>
      runConvex(step.functionName, args),
    onProgress: (step, result) => {
      process.stdout.write(
        `${step.label}: ${result.skipped ? "already complete" : "complete"}\n`,
      );
    },
  });
  const servicePrincipalId = provisionPrincipals(
    options.runId,
    fixture.provisioning,
  );
  verifyProvisioning(
    options.runId,
    servicePrincipalId,
    "S1",
  );
  runConvex("system/cutover:transition", {
    cutoverRunId: options.runId,
    expectedStage: "S1",
    nextStage: "S2",
    actor: "synthetic-staging-initializer",
  });
  const finalProgress = runConvex(
    "migration/rehearsal:inspectRunProgress",
    { runId: options.runId },
  );
  if (
    finalProgress?.matchesRun !== true ||
    finalProgress.cutoverStage !== "S2" ||
    finalProgress.apiVersion !== BBPC_API_VERSION ||
    finalProgress.domainStatuses?.identity !== "reconciled"
  ) {
    throw new Error(
      "Synthetic staging initialization final evidence is incomplete.",
    );
  }
  verifyProvisioning(
    options.runId,
    servicePrincipalId,
    "S2",
  );
  process.stdout.write(
    [
      "Synthetic staging initialization passed.",
      `runId=${options.runId}`,
      "cutoverStage=S2",
      "applicationWritesEnabled=false",
      "identityDomain=reconciled",
      "humanPrincipals=2",
      "pipelinePrincipals=1",
      "productionRows=0",
      "",
    ].join(" "),
  );
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  path.resolve(invokedPath) ===
    path.resolve(fileURLToPath(import.meta.url))
) {
  try {
    await main();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown synthetic staging initialization error.";
    process.stderr.write(
      `Synthetic staging initialization failed: ${message}\n`,
    );
    process.exitCode = 1;
  }
}
