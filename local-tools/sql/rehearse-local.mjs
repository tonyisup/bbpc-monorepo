import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { BBPC_API_VERSION } from "../../contracts/index.js";
import {
  EXPECTED_SOURCE_FINGERPRINT,
  verifyDomainManifest,
} from "./manifest.mjs";
import {
  buildRehearsalPlan,
  countsFromVerifiedManifests,
  executeRehearsalPlan,
  isRehearsalStepComplete,
  REHEARSAL_DOMAINS,
  shouldStageForResume,
} from "./rehearsal-plan.mjs";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolDirectory, "../..");
const REQUIRED_SOURCE_ACK =
  "--ack-production-derived-local-only";
const REQUIRED_FRESH_ACK =
  "--ack-initialize-empty-local-deployment";
const REQUIRED_RESUME_ACK =
  "--ack-resume-local-rehearsal";
const REQUIRED_REPLACE_ACK =
  "--ack-replace-local-raw-staging";

function usage() {
  return [
    "Usage:",
    "  npm run migration:rehearse:local -- --run-id <id> " +
      "[--batch-size <1..100>] [--dry-run|--resume] " +
      `${REQUIRED_SOURCE_ACK}`,
    `  fresh:  ${REQUIRED_FRESH_ACK} ${REQUIRED_REPLACE_ACK}`,
    `  resume: ${REQUIRED_RESUME_ACK} ${REQUIRED_REPLACE_ACK}`,
    "",
    "Verifies all eight immutable manifests, requires an empty local Convex",
    "deployment, initializes S1, stages raw rows locally, then runs every",
    "transform and reconciliation checkpoint. It never runs the final scrub.",
  ].join("\n");
}

function parseArguments(argv) {
  if (argv.includes("--help")) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  const runIndex = argv.indexOf("--run-id");
  const batchIndex = argv.indexOf("--batch-size");
  const runId = runIndex < 0 ? undefined : argv[runIndex + 1];
  const batchSize =
    batchIndex < 0 ? 50 : Number(argv[batchIndex + 1]);
  if (
    typeof runId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,100}$/u.test(runId)
  ) {
    throw new Error("A safe --run-id is required");
  }
  if (
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 100
  ) {
    throw new Error("--batch-size must be an integer from 1 through 100");
  }
  const dryRun = argv.includes("--dry-run");
  const resume = argv.includes("--resume");
  if (dryRun && resume) {
    throw new Error("--dry-run and --resume cannot be combined");
  }
  const acknowledgements = [REQUIRED_SOURCE_ACK];
  if (!dryRun) {
    acknowledgements.push(
      REQUIRED_REPLACE_ACK,
      resume ? REQUIRED_RESUME_ACK : REQUIRED_FRESH_ACK,
    );
  }
  for (const acknowledgement of acknowledgements) {
    if (!argv.includes(acknowledgement)) {
      throw new Error(
        `Explicit ${acknowledgement} acknowledgement is required`,
      );
    }
  }
  return {
    runId,
    batchSize,
    dryRun,
    resume,
  };
}

function commandName(name) {
  return process.platform === "win32" && name === "npx"
    ? "npx.cmd"
    : name;
}

function runCommand(command, args, label, capture = false) {
  const result = spawnSync(commandName(command), args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (result.error || result.status !== 0) {
    if (capture && result.stderr) {
      process.stderr.write(result.stderr);
    }
    throw new Error(`${label} failed`);
  }
  return capture ? result.stdout.trim() : "";
}

function runConvex(functionName, args) {
  const output = runCommand(
    "npx",
    [
      "convex",
      "run",
      "--deployment",
      "local",
      "--codegen",
      "disable",
      functionName,
      JSON.stringify(args),
    ],
    `Local Convex call ${functionName}`,
    true,
  );
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(
      `Local Convex call ${functionName} returned invalid JSON`,
    );
  }
}

const { runId, batchSize, dryRun, resume } = parseArguments(
  process.argv.slice(2),
);
const verifiedDomains = Object.fromEntries(
  REHEARSAL_DOMAINS.map((domain) => [
    domain,
    verifyDomainManifest({ projectRoot, runId, domain }),
  ]),
);
const counts = countsFromVerifiedManifests(verifiedDomains);
const steps = buildRehearsalPlan(counts);

process.stdout.write(
  [
    "Verified all eight immutable local manifests.",
    `runId=${runId}`,
    `rawTables=${String(Object.keys(counts).length)}`,
    `planSteps=${String(steps.length)}`,
    `batchSize=${String(batchSize)}`,
    "",
  ].join("\n"),
);

if (dryRun) {
  for (const [index, step] of steps.entries()) {
    process.stdout.write(
      `${String(index + 1).padStart(2, "0")} ${step.label}\n`,
    );
  }
  process.stdout.write(
    "Dry run complete; no Convex state was changed.\n",
  );
  process.exit(0);
}

let initialProgress;
if (resume) {
  initialProgress = runConvex(
    "migration/rehearsal:inspectRunProgress",
    { runId },
  );
  if (
    initialProgress?.initialized !== true ||
    initialProgress.matchesRun !== true ||
    !["S0", "S1"].includes(initialProgress.cutoverStage) ||
    initialProgress.apiVersion !== BBPC_API_VERSION ||
    (initialProgress.sourceSchemaFingerprint !== undefined &&
      initialProgress.sourceSchemaFingerprint !==
        EXPECTED_SOURCE_FINGERPRINT)
  ) {
    throw new Error(
      "Existing local deployment is not resumable for this run and API version",
    );
  }
} else {
  const freshTarget = runConvex(
    "migration/rehearsal:inspectFreshTarget",
    {},
  );
  if (
    freshTarget?.fresh !== true ||
    !Array.isArray(freshTarget.nonemptyTables)
  ) {
    const tableNames = Array.isArray(freshTarget?.nonemptyTables)
      ? freshTarget.nonemptyTables.join(", ")
      : "unknown";
    throw new Error(
      `Local Convex deployment is not empty; nonempty tables: ${tableNames}`,
    );
  }
  runConvex("system/cutover:initialize", {
    cutoverRunId: runId,
    apiVersion: BBPC_API_VERSION,
    actor: "local-migration-rehearsal",
  });
  initialProgress = {
    initialized: true,
    matchesRun: true,
    cutoverStage: "S0",
    apiVersion: BBPC_API_VERSION,
    domainStatuses: {},
    checkpointStatuses: {},
  };
}
if (initialProgress.cutoverStage === "S0") {
  runConvex("system/cutover:transition", {
    cutoverRunId: runId,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "local-migration-rehearsal",
  });
}

const stageRawTables =
  !resume || shouldStageForResume(initialProgress);
if (stageRawTables) {
  for (const domain of REHEARSAL_DOMAINS) {
    runCommand(
      process.execPath,
      [
        path.join(toolDirectory, "stage-local.mjs"),
        "--run-id",
        runId,
        "--domain",
        domain,
        REQUIRED_SOURCE_ACK,
        REQUIRED_REPLACE_ACK,
      ],
      `Local ${domain} staging`,
    );
  }
} else {
  process.stdout.write(
    [
      "Preserving existing raw staging because migration progress exists.",
      "Replacing raw rows now would invalidate persisted checkpoint cursors.",
      "",
    ].join("\n"),
  );
}

await executeRehearsalPlan({
  steps,
  runId,
  batchSize,
  isComplete: async (step) =>
    isRehearsalStepComplete(step, initialProgress),
  invoke: async (step, args) =>
    runConvex(step.functionName, args),
  onProgress: (step, progress) => {
    process.stdout.write(
      `${step.label}: ${progress.skipped ? "already complete" : "completed"} attempts=${String(progress.attempts)}\n`,
    );
  },
});

process.stdout.write(
  [
    "All eight migration domains transformed and reconciled locally.",
    "The deployment remains in S1 with raw evidence intact.",
    "Do not run the portable scrub until backup/reconciliation approval.",
    "",
  ].join("\n"),
);
