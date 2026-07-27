import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import {
  clearTimeout,
  setTimeout as scheduleTimeout,
} from "node:timers";
import { fileURLToPath } from "node:url";

import { BBPC_API_VERSION } from "../../contracts/index.js";
import {
  PORTABLE_BACKUP_TABLES,
  PORTABLE_SCRUBBED_TABLES,
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
import {
  readRecordingCatalogManifest,
} from "../recording/catalog-manifest.mjs";
import {
  assertS2RollbackEvidence,
  S2_ROLLBACK_ACTOR,
} from "./s2-rollback.mjs";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolDirectory, "../..");
const SOURCE_ACK = "--ack-production-derived-local-only";
const RESTORE_ACK = "--ack-private-restore-validation";
const DELETE_ACK = "--ack-delete-disposable-restore";
const S2_ROLLBACK_FLAG = "--validate-s2-rollback";
const S2_ROLLBACK_ACK =
  "--ack-s2-rollback-validation";
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
      "[--batch-size <1..100>] [--cloud-port <port>] " +
      "[--site-port <port>] [--validate-s2-rollback] " +
      "[--dry-run] " +
      `${SOURCE_ACK}`,
    `  execute: ${RESTORE_ACK} ${DELETE_ACK}`,
    `  S2 rollback execution: ${S2_ROLLBACK_ACK}`,
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
  const cloudPortIndex = argv.indexOf("--cloud-port");
  const sitePortIndex = argv.indexOf("--site-port");
  const runId = runIndex < 0 ? undefined : argv[runIndex + 1];
  const batchSize =
    batchIndex < 0 ? 100 : Number(argv[batchIndex + 1]);
  const cloudPort =
    cloudPortIndex < 0
      ? 3_310
      : Number(argv[cloudPortIndex + 1]);
  const sitePort =
    sitePortIndex < 0
      ? 3_311
      : Number(argv[sitePortIndex + 1]);
  const dryRun = argv.includes("--dry-run");
  const validateS2Rollback = argv.includes(
    S2_ROLLBACK_FLAG,
  );
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
  for (const [label, port] of [
    ["--cloud-port", cloudPort],
    ["--site-port", sitePort],
  ]) {
    if (
      !Number.isSafeInteger(port) ||
      port < 1_024 ||
      port > 65_535
    ) {
      throw new Error(
        `${label} must be an integer from 1024 through 65535`,
      );
    }
  }
  if (cloudPort === sitePort) {
    throw new Error(
      "Disposable local Convex ports must be distinct",
    );
  }
  if (
    !validateS2Rollback &&
    argv.includes(S2_ROLLBACK_ACK)
  ) {
    throw new Error(
      `${S2_ROLLBACK_ACK} requires ${S2_ROLLBACK_FLAG}`,
    );
  }
  for (const acknowledgement of [
    SOURCE_ACK,
    ...(dryRun ? [] : [RESTORE_ACK, DELETE_ACK]),
    ...(!dryRun && validateS2Rollback
      ? [S2_ROLLBACK_ACK]
      : []),
  ]) {
    if (!argv.includes(acknowledgement)) {
      throw new Error(
        `Explicit ${acknowledgement} acknowledgement is required`,
      );
    }
  }
  return {
    runId,
    batchSize,
    cloudPort,
    sitePort,
    dryRun,
    validateS2Rollback,
  };
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
    env: {
      ...process.env,
      CONVEX_AGENT_MODE: "anonymous",
      NO_COLOR: "1",
    },
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
  const sourceConvex = path.join(projectRoot, "convex");
  const restoreConvex = path.join(
    restoreProject,
    "convex",
  );
  fs.mkdirSync(restoreConvex, {
    mode: 0o700,
  });
  for (const entry of fs.readdirSync(sourceConvex, {
    withFileTypes: true,
  })) {
    // Anonymous local deployments do not support the project-linked
    // defineApp bundle, and the isolated CLI-admin restore does not use
    // Clerk authentication. All schema, migration, and application
    // function sources remain unchanged.
    if (
      entry.name === "convex.config.ts" ||
      entry.name === "auth.config.ts"
    ) {
      continue;
    }
    fs.cpSync(
      path.join(sourceConvex, entry.name),
      path.join(restoreConvex, entry.name),
      {
        recursive: entry.isDirectory(),
        preserveTimestamps: true,
      },
    );
  }
  for (const [name, type] of [
    ["contracts", "dir"],
    ["node_modules", "dir"],
    ["package.json", "file"],
    ["tsconfig.json", "file"],
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

function startDisposableBackend(restoreProject) {
  return spawn(
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
      env: {
        ...process.env,
        CONVEX_AGENT_MODE: "anonymous",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function isPortListening(port) {
  return new Promise((resolve) => {
    const socket = createConnection({
      host: "127.0.0.1",
      port,
    });
    let settled = false;
    const finish = (listening) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(listening);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(250, () => finish(false));
  });
}

async function waitForPortRelease(port) {
  const deadline = Date.now() + 15_000;
  while (await isPortListening(port)) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Disposable local Convex port ${String(port)} did not stop`,
      );
    }
    await new Promise((resolve) =>
      scheduleTimeout(resolve, 100),
    );
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

const {
  runId,
  batchSize,
  cloudPort,
  sitePort,
  dryRun,
  validateS2Rollback,
} = parseArguments(process.argv.slice(2));
const restoreActor = validateS2Rollback
  ? S2_ROLLBACK_ACTOR
  : "portable-restore-validation";
const verifiedDomains = Object.fromEntries(
  REHEARSAL_DOMAINS.map((domain) => [
    domain,
    verifyDomainManifest({ projectRoot, runId, domain }),
  ]),
);
const rawCounts = countsFromVerifiedManifests(verifiedDomains);
const { manifest: recordingCatalogManifest } =
  readRecordingCatalogManifest({
    projectRoot,
    runId,
  });
const {
  canonicalCounts,
  migrationRows,
  totalRows,
} = portableCountsFromRawCounts(rawCounts, {
  sounders: recordingCatalogManifest.sounders,
  templates: recordingCatalogManifest.templates,
});
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
const restoreImportSnapshotPath = path.join(
  restoreRoot,
  "restore-import-snapshot.zip",
);
const restoreRepushMarkerPath = path.join(
  restoreProject,
  "convex",
  "__restore_repush.ts",
);
const buildRestoreRepushMarker = (generation) =>
  [
    'import { v } from "convex/values";',
    'import { internalReadQuery } from "./functions.js";',
    "",
    "export const generation = internalReadQuery({",
    "  args: {},",
    "  returns: v.number(),",
    `  handler: async () => ${String(generation)},`,
    "});",
    "",
  ].join("\n");

const backupManifest = JSON.parse(
  fs.readFileSync(backupManifestPath, "utf8"),
);
const supplementalCounts =
  backupManifest.supplementalCounts;
if (
  backupManifest.formatVersion !== 2 ||
  typeof supplementalCounts !== "object" ||
  supplementalCounts === null ||
  !Number.isSafeInteger(
    supplementalCounts.authIdentities,
  ) ||
  supplementalCounts.authIdentities < 0 ||
  !Number.isSafeInteger(
    supplementalCounts.auditEvents,
  ) ||
  supplementalCounts.auditEvents < 1
) {
  throw new Error(
    "The portable backup manifest has invalid supplemental counts",
  );
}
const portableCounts = {
  ...canonicalCounts,
  authIdentities:
    supplementalCounts.authIdentities,
  auditEvents: supplementalCounts.auditEvents,
};
const portableRows = Object.values(portableCounts).reduce(
  (sum, count) => sum + count,
  0,
);
const sourceSnapshot = inspectPortableSnapshot({
  snapshotPath,
  allowedTables: [...PORTABLE_BACKUP_TABLES],
  allowedEmptyTables: [...PORTABLE_SCRUBBED_TABLES],
  expectedCounts: portableCounts,
});
if (
  backupManifest.runId !== runId ||
  backupManifest.canonicalRows !== totalRows ||
  backupManifest.portableRows !== portableRows ||
  backupManifest.snapshotRows !== portableRows ||
  backupManifest.snapshotSha256 !==
    sourceSnapshot.snapshotSha256 ||
  backupManifest.recordingCatalog?.digest !==
    recordingCatalogManifest.digest ||
  backupManifest.recordingCatalog?.sounders !==
    recordingCatalogManifest.sounders ||
  backupManifest.recordingCatalog?.templates !==
    recordingCatalogManifest.templates
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
    `portableRows=${String(portableRows)}`,
    `snapshotTables=${String(Object.keys(sourceSnapshot.tables).length)}`,
    `cloudPort=${String(cloudPort)}`,
    `sitePort=${String(sitePort)}`,
    `s2RollbackValidation=${validateS2Rollback ? "enabled" : "disabled"}`,
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
fs.writeFileSync(
  restoreRepushMarkerPath,
  buildRestoreRepushMarker(1),
  {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  },
);
fs.copyFileSync(
  snapshotPath,
  restoreImportSnapshotPath,
  fs.constants.COPYFILE_EXCL,
);
fs.chmodSync(restoreImportSnapshotPath, 0o600);
runCommand(
  "/usr/bin/zip",
  [
    "-q",
    "-d",
    restoreImportSnapshotPath,
    "_tables/*",
  ],
  "Disposable restore metadata exclusion",
);
const restoreImportSnapshot = inspectPortableSnapshot({
  snapshotPath: restoreImportSnapshotPath,
  allowedTables: [...PORTABLE_BACKUP_TABLES],
  allowedEmptyTables: [...PORTABLE_SCRUBBED_TABLES],
  expectedCounts: portableCounts,
});
comparePortableSnapshots(
  sourceSnapshot,
  restoreImportSnapshot,
);
runCommand(
  convexExecutable,
  [
    "dev",
    "--local-cloud-port",
    String(cloudPort),
    "--local-site-port",
    String(sitePort),
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
await waitForPortRelease(cloudPort);

let backend = startDisposableBackend(restoreProject);

let restoreEvidence;
try {
  await waitForFunctionsReady(backend);
  runCommand(
    convexExecutable,
    [
      "import",
      "--replace-all",
      "--yes",
      restoreImportSnapshotPath,
    ],
    "Disposable portable snapshot restore",
    { cwd: restoreProject },
  );
  runCommand(
    convexExecutable,
    [
      "export",
      "--path",
      restoredSnapshotPath,
    ],
    "Disposable restored snapshot export",
    { cwd: restoreProject },
  );
  const restoredSnapshot = inspectPortableSnapshot({
    snapshotPath: restoredSnapshotPath,
    allowedTables: [...PORTABLE_BACKUP_TABLES],
    allowedEmptyTables: [...PORTABLE_SCRUBBED_TABLES],
    expectedCounts: portableCounts,
  });
  const snapshotComparison = comparePortableSnapshots(
    sourceSnapshot,
    restoredSnapshot,
  );

  await stopBackend(backend);
  await waitForPortRelease(cloudPort);
  fs.writeFileSync(
    restoreRepushMarkerPath,
    buildRestoreRepushMarker(2),
    {
      encoding: "utf8",
      flag: "w",
      mode: 0o600,
    },
  );
  runCommand(
    convexExecutable,
    [
      "dev",
      "--once",
      "--codegen",
      "disable",
      "--typecheck",
      "disable",
      "--tail-logs",
      "disable",
    ],
    "Disposable local Convex forced function repush",
    { cwd: restoreProject },
  );
  await waitForPortRelease(cloudPort);
  backend = startDisposableBackend(restoreProject);
  await waitForFunctionsReady(backend);

  runConvex(restoreProject, "system/cutover:initialize", {
    cutoverRunId: runId,
    apiVersion: BBPC_API_VERSION,
    actor: restoreActor,
  });
  runConvex(restoreProject, "system/cutover:transition", {
    cutoverRunId: runId,
    expectedStage: "S0",
    nextStage: "S1",
    actor: restoreActor,
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
  assertRestoreEvidence(evidence, migrationRows);
  let s2Rollback;
  if (validateS2Rollback) {
    const enteredS2 = runConvex(
      restoreProject,
      "system/cutover:transition",
      {
        cutoverRunId: runId,
        expectedStage: "S1",
        nextStage: "S2",
        actor: restoreActor,
      },
    );
    if (
      enteredS2?.cutoverStage !== "S2" ||
      enteredS2.applicationWriteMode !== "disabled"
    ) {
      throw new Error(
        "The disposable target did not safely enter S2",
      );
    }
    const rolledBack = runConvex(
      restoreProject,
      "system/cutover:transition",
      {
        cutoverRunId: runId,
        expectedStage: "S2",
        nextStage: "S0",
        actor: restoreActor,
      },
    );
    if (
      rolledBack?.cutoverStage !== "S0" ||
      rolledBack.applicationWriteMode !== "disabled"
    ) {
      throw new Error(
        "The disposable target did not safely roll back to S0",
      );
    }
    s2Rollback = assertS2RollbackEvidence(
      runConvex(
        restoreProject,
        "migration/rehearsal:inspectS2RollbackEvidence",
        { runId, actor: restoreActor },
      ),
    );
  }

  restoreEvidence = {
    formatVersion: 2,
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
    ...(s2Rollback === undefined
      ? {}
      : { s2Rollback }),
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
    `migrationRowsReused=${String(migrationRows)}`,
    `recordingCatalogRowsPreserved=${String(totalRows - migrationRows)}`,
    ...(validateS2Rollback
      ? ["s2RollbackValidated=true"]
      : []),
    `restoreManifest=${restoreManifestPath}`,
    "The disposable production-derived deployment was deleted.",
    "",
  ].join("\n"),
);
