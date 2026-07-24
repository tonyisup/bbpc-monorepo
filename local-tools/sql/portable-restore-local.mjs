import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import {
  clearTimeout,
  setTimeout as scheduleTimeout,
} from "node:timers";
import { fileURLToPath } from "node:url";

import { BBPC_API_VERSION } from "../../contracts/index.js";
import {
  PORTABLE_BACKUP_TABLES,
  SOURCE_SCHEMA_FINGERPRINT,
} from "../../convex/migration/constants.ts";
import {
  buildRehearsalPlan,
  countsFromVerifiedManifests,
  executeRehearsalPlan,
  REHEARSAL_DOMAINS,
} from "./rehearsal-plan.mjs";
import {
  comparePortableSnapshots,
  inspectPortableSnapshot,
} from "./portable-snapshot.mjs";
import {
  portableCountsFromRawCounts,
} from "./portable-backup-plan.mjs";
import { buildLocalImportSpec } from "./stage-import.mjs";
import { verifyDomainManifest } from "./manifest.mjs";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolDirectory, "../..");
const SOURCE_ACK = "--ack-production-derived-local-only";
const RESTORE_ACK = "--ack-private-restore-validation";
const DELETE_ACK = "--ack-delete-disposable-restore";
const convexExecutable = path.join(
  projectRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "convex.cmd" : "convex",
);

function usage() {
  return [
    "Usage:",
    "  npm run migration:restore:local -- --run-id <id> " +
      "[--batch-size <1..100>] [--dry-run] " +
      `${SOURCE_ACK}`,
    `  execute: ${RESTORE_ACK} ${DELETE_ACK}`,
    "",
    "Restores the private portable snapshot into a second disposable",
    "local Convex deployment, compares exact table hashes, reruns all",
    "transform/reconciliation checks, then deletes only that disposable",
    "deployment. It never targets a cloud deployment.",
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
    batchIndex < 0 ? 100 : Number(argv[batchIndex + 1]);
  const dryRun = argv.includes("--dry-run");
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
  for (const acknowledgement of [
    SOURCE_ACK,
    ...(dryRun ? [] : [RESTORE_ACK, DELETE_ACK]),
  ]) {
    if (!argv.includes(acknowledgement)) {
      throw new Error(
        `Explicit ${acknowledgement} acknowledgement is required`,
      );
    }
  }
  return { runId, batchSize, dryRun };
}

function runCommand(
  command,
  args,
  label,
  { cwd = projectRoot, capture = false } = {},
) {
  const result = spawnSync(command, args, {
    cwd,
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

function runConvex(cwd, functionName, args) {
  const output = runCommand(
    convexExecutable,
    [
      "run",
      "--deployment",
      "local",
      "--codegen",
      "disable",
      functionName,
      JSON.stringify(args),
    ],
    `Disposable local Convex call ${functionName}`,
    { cwd, capture: true },
  );
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(
      `Disposable local Convex call ${functionName} returned invalid JSON`,
    );
  }
}

function createRestoreProject(restoreProject) {
  fs.mkdirSync(restoreProject, {
    recursive: true,
    mode: 0o700,
  });
  for (const [name, type] of [
    ["convex", "dir"],
    ["contracts", "dir"],
    ["node_modules", "dir"],
    ["package.json", "file"],
  ]) {
    fs.symlinkSync(
      path.join(projectRoot, name),
      path.join(restoreProject, name),
      type,
    );
  }
}

function waitForFunctionsReady(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = scheduleTimeout(() => {
      reject(
        new Error(
          "Disposable local Convex backend did not become ready",
        ),
      );
    }, 60_000);
    const onData = (chunk) => {
      output += chunk.toString("utf8");
      if (output.includes("Convex functions ready!")) {
        clearTimeout(timeout);
        resolve();
      }
      if (output.length > 20_000) {
        output = output.slice(-10_000);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `Disposable local Convex backend exited early with code ${String(code)}`,
        ),
      );
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function stopBackend(child) {
  if (child.exitCode !== null) {
    return;
  }
  child.kill("SIGINT");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) =>
      scheduleTimeout(resolve, 10_000),
    ),
  ]);
  if (child.exitCode === null) {
    child.kill("SIGTERM");
  }
}

function stageVerifiedDomains({
  restoreProject,
  verifiedDomains,
}) {
  const emptyJsonArrayPath = path.join(
    restoreProject,
    "empty.json",
  );
  fs.writeFileSync(emptyJsonArrayPath, "[]\n", {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  for (const domain of REHEARSAL_DOMAINS) {
    for (const file of verifiedDomains[domain].files) {
      const importSpec = buildLocalImportSpec(
        file,
        emptyJsonArrayPath,
      );
      runCommand(
        convexExecutable,
        [
          "import",
          "--deployment",
          "local",
          "--table",
          file.table,
          "--format",
          importSpec.format,
          "--replace",
          "--yes",
          importSpec.filePath,
        ],
        `Disposable raw import ${file.table}`,
        { cwd: restoreProject },
      );
    }
  }
  fs.rmSync(emptyJsonArrayPath);
}

function assertRestoreEvidence(evidence, totalRows) {
  if (
    evidence?.runFound !== true ||
    evidence.cutoverStage !== "S1" ||
    evidence.apiVersion !== BBPC_API_VERSION ||
    evidence.sourceSchemaFingerprint !==
      SOURCE_SCHEMA_FINGERPRINT ||
    evidence.allDomainsReconciled !== true ||
    evidence.totalExpectedRows !== totalRows ||
    evidence.checkpointSummary?.running !== 0 ||
    evidence.checkpointSummary?.completed !==
      evidence.checkpointSummary?.total ||
    evidence.checkpointSummary?.processedRows !==
      totalRows * 2 ||
    evidence.checkpointSummary?.insertedRows !== 0 ||
    evidence.checkpointSummary?.reusedRows !== totalRows * 2
  ) {
    throw new Error(
      "The disposable restored deployment failed reconciliation",
    );
  }
}

const { runId, batchSize, dryRun } = parseArguments(
  process.argv.slice(2),
);
const verifiedDomains = Object.fromEntries(
  REHEARSAL_DOMAINS.map((domain) => [
    domain,
    verifyDomainManifest({ projectRoot, runId, domain }),
  ]),
);
const rawCounts = countsFromVerifiedManifests(verifiedDomains);
const { canonicalCounts, totalRows } =
  portableCountsFromRawCounts(rawCounts);
const steps = buildRehearsalPlan(rawCounts);
const backupDirectory = path.join(
  projectRoot,
  ".local-migration",
  runId,
  "portable-backup",
);
const snapshotPath = path.join(
  backupDirectory,
  "portable-snapshot.zip",
);
const backupManifestPath = path.join(
  backupDirectory,
  "manifest.json",
);
const restoreManifestPath = path.join(
  backupDirectory,
  "restore-manifest.json",
);
const restoreRoot = path.join(
  projectRoot,
  ".local-migration",
  runId,
  "restore-validation",
);
const restoreProject = path.join(restoreRoot, "project");
const restoredSnapshotPath = path.join(
  restoreRoot,
  "restored-snapshot.zip",
);

const backupManifest = JSON.parse(
  fs.readFileSync(backupManifestPath, "utf8"),
);
const sourceSnapshot = inspectPortableSnapshot({
  snapshotPath,
  allowedTables: [...PORTABLE_BACKUP_TABLES],
  expectedCounts: canonicalCounts,
});
if (
  backupManifest.runId !== runId ||
  backupManifest.snapshotSha256 !==
    sourceSnapshot.snapshotSha256
) {
  throw new Error(
    "The portable snapshot does not match its private manifest",
  );
}

process.stdout.write(
  [
    "Verified private portable snapshot for disposable restore.",
    `runId=${runId}`,
    `canonicalRows=${String(totalRows)}`,
    `snapshotTables=${String(Object.keys(sourceSnapshot.tables).length)}`,
    "",
  ].join("\n"),
);
if (dryRun) {
  process.stdout.write(
    "Dry run complete; no disposable deployment was created.\n",
  );
  process.exit(0);
}

if (fs.existsSync(restoreRoot)) {
  fs.rmSync(restoreRoot, { recursive: true, force: true });
}
createRestoreProject(restoreProject);
runCommand(
  convexExecutable,
  [
    "dev",
    "--configure",
    "existing",
    "--team",
    "tonyisup",
    "--project",
    "bbpc-convex",
    "--dev-deployment",
    "local",
    "--once",
    "--codegen",
    "disable",
    "--typecheck",
    "disable",
    "--tail-logs",
    "disable",
  ],
  "Disposable local Convex configuration",
  { cwd: restoreProject },
);

const backend = spawn(
  convexExecutable,
  [
    "dev",
    "--codegen",
    "disable",
    "--typecheck",
    "disable",
    "--tail-logs",
    "disable",
  ],
  {
    cwd: restoreProject,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let restoreEvidence;
try {
  await waitForFunctionsReady(backend);
  runCommand(
    convexExecutable,
    [
      "import",
      "--deployment",
      "local",
      "--replace-all",
      "--yes",
      snapshotPath,
    ],
    "Disposable portable snapshot restore",
    { cwd: restoreProject },
  );
  runCommand(
    convexExecutable,
    [
      "export",
      "--deployment",
      "local",
      "--path",
      restoredSnapshotPath,
    ],
    "Disposable restored snapshot export",
    { cwd: restoreProject },
  );
  const restoredSnapshot = inspectPortableSnapshot({
    snapshotPath: restoredSnapshotPath,
    allowedTables: [...PORTABLE_BACKUP_TABLES],
    expectedCounts: canonicalCounts,
  });
  const snapshotComparison = comparePortableSnapshots(
    sourceSnapshot,
    restoredSnapshot,
  );

  runConvex(restoreProject, "system/cutover:initialize", {
    cutoverRunId: runId,
    apiVersion: BBPC_API_VERSION,
    actor: "portable-restore-validation",
  });
  runConvex(restoreProject, "system/cutover:transition", {
    cutoverRunId: runId,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "portable-restore-validation",
  });
  stageVerifiedDomains({
    restoreProject,
    verifiedDomains,
  });
  await executeRehearsalPlan({
    steps,
    runId,
    batchSize,
    invoke: async (step, args) =>
      runConvex(restoreProject, step.functionName, args),
    onProgress: (step, progress) => {
      process.stdout.write(
        `${step.label}: restored validation complete attempts=${String(progress.attempts)}\n`,
      );
    },
  });
  const evidence = runConvex(
    restoreProject,
    "migration/rehearsal:inspectRehearsalEvidence",
    { runId },
  );
  assertRestoreEvidence(evidence, totalRows);

  restoreEvidence = {
    formatVersion: 1,
    runId,
    validatedAt: new Date().toISOString(),
    sourceSnapshotSha256: sourceSnapshot.snapshotSha256,
    restoredSnapshotSha256: restoredSnapshot.snapshotSha256,
    exactTableHashesMatched: snapshotComparison.matched,
    snapshotTables: snapshotComparison.tables,
    snapshotRows: snapshotComparison.totalRows,
    reconciliation: {
      domains: REHEARSAL_DOMAINS.length,
      checkpoints: evidence.checkpointSummary.total,
      processedRows: evidence.checkpointSummary.processedRows,
      insertedRows: evidence.checkpointSummary.insertedRows,
      reusedRows: evidence.checkpointSummary.reusedRows,
      allDomainsReconciled: evidence.allDomainsReconciled,
    },
    containsRowValues: false,
  };
} finally {
  await stopBackend(backend);
  if (restoreEvidence) {
    fs.rmSync(restoreRoot, { recursive: true, force: true });
  }
}

if (!restoreEvidence) {
  throw new Error(
    "Disposable restore validation ended without aggregate evidence",
  );
}
const restoreManifest = {
  ...restoreEvidence,
  disposableDeploymentDeleted: true,
};
fs.writeFileSync(
  restoreManifestPath,
  `${JSON.stringify(restoreManifest, null, 2)}\n`,
  {
    encoding: "utf8",
    flag: fs.existsSync(restoreManifestPath) ? "w" : "wx",
    mode: 0o600,
  },
);
fs.chmodSync(restoreManifestPath, 0o600);

process.stdout.write(
  [
    "Disposable portable restore validation passed.",
    "Every snapshot table hash matched before validation.",
    `canonicalRowsReused=${String(totalRows)}`,
    `restoreManifest=${restoreManifestPath}`,
    "The disposable production-derived deployment was deleted.",
    "",
  ].join("\n"),
);
