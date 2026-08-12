import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import {
  clearTimeout,
  setTimeout as scheduleTimeout,
} from "node:timers";
import { fileURLToPath } from "node:url";

import {
  comparePortableSnapshots,
  inspectPortableSnapshot,
} from "../sql/portable-snapshot.mjs";
import {
  readRecordingCatalogManifest,
} from "./catalog-manifest.mjs";
import { parseNamedArguments } from "./cli.mjs";
import {
  RECORDING_SOURCE_TABLES,
  recordingSourceArchivePaths,
  validateRecordingSourceArchiveManifest,
  validateRecordingSourceRestoreManifest,
  writeOrVerifyRecordingSourceRestoreManifest,
} from "./source-archive.mjs";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolDirectory, "../..");
const RESTORE_ACK = "ack-private-recording-restore";
const DELETE_ACK =
  "ack-delete-disposable-recording-restore";

function usage() {
  return [
    "Usage:",
    "  npm run migration:recording-archive:restore -- --run-id <id> --dry-run",
    `  execute: --${RESTORE_ACK} --${DELETE_ACK}`,
    "",
    "Restores the private standalone recording snapshot into a",
    "disposable local backend on isolated ports, compares every table",
    "hash, and deletes the disposable backend. It never imports into",
    "the shared Convex deployment.",
  ].join("\n");
}

function runCommand(
  command,
  commandArgs,
  label,
  { cwd, capture = false } = {},
) {
  const result = spawnSync(command, commandArgs, {
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

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new Error(`${label} is invalid`);
  }
}

function createRestoreProject({
  restoreProject,
  sourceProject,
}) {
  fs.mkdirSync(restoreProject, {
    recursive: true,
    mode: 0o700,
  });
  for (const [name, type] of [
    ["convex", "dir"],
    ["node_modules", "dir"],
    ["package.json", "file"],
    ["tsconfig.json", "file"],
  ]) {
    fs.symlinkSync(
      path.join(sourceProject, name),
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
          "Disposable recording backend did not become ready",
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
          `Disposable recording backend exited early with code ${String(code)}`,
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

function requirePort(value, label) {
  const port = Number(value);
  if (
    !Number.isSafeInteger(port) ||
    port < 1_024 ||
    port > 65_535
  ) {
    throw new Error(`${label} must be a safe local port`);
  }
  return port;
}

const args = parseNamedArguments(process.argv.slice(2));
if (args.has("help")) {
  process.stdout.write(`${usage()}\n`);
  process.exit(0);
}
const runId = args.get("run-id");
if (
  typeof runId !== "string" ||
  !/^[A-Za-z0-9._:-]{1,100}$/u.test(runId)
) {
  throw new Error("A safe --run-id is required");
}
const dryRun = args.has("dry-run");
if (!dryRun) {
  for (const acknowledgement of [
    RESTORE_ACK,
    DELETE_ACK,
  ]) {
    if (!args.has(acknowledgement)) {
      throw new Error(
        `Explicit --${acknowledgement} acknowledgement is required`,
      );
    }
  }
}
const sourceProject = path.resolve(
  projectRoot,
  args.get("source-project") ?? "../bbpc-recording",
);
const sourcePackage = readJson(
  path.join(sourceProject, "package.json"),
  "Recording source package",
);
if (
  sourcePackage.name !== "bbpc-recording" ||
  !fs.statSync(path.join(sourceProject, "convex")).isDirectory()
) {
  throw new Error(
    "The source project is not the standalone bbpc-recording project",
  );
}
const cloudPort = requirePort(
  args.get("cloud-port") ?? "3320",
  "Cloud port",
);
const sitePort = requirePort(
  args.get("site-port") ?? "3321",
  "Site port",
);
if (cloudPort === sitePort) {
  throw new Error(
    "Disposable local Convex ports must be distinct",
  );
}
const paths = recordingSourceArchivePaths({
  projectRoot,
  runId,
});
const archiveManifest =
  validateRecordingSourceArchiveManifest(
    readJson(
      paths.manifestPath,
      "Recording source archive manifest",
    ),
    runId,
  );
const { manifest: catalogManifest } =
  readRecordingCatalogManifest({
    projectRoot,
    runId,
  });
const sourceSnapshot = inspectPortableSnapshot({
  snapshotPath: paths.snapshotPath,
  allowedTables: [...RECORDING_SOURCE_TABLES],
  expectedCounts: {
    sounders: catalogManifest.sounders,
    segmentTemplates: catalogManifest.templates,
  },
});
if (
  archiveManifest.snapshotSha256 !==
    sourceSnapshot.snapshotSha256 ||
  archiveManifest.snapshotRows !==
    sourceSnapshot.totalRows ||
  JSON.stringify(archiveManifest.tables) !==
    JSON.stringify(sourceSnapshot.tables)
) {
  throw new Error(
    "The private recording source snapshot does not match its manifest",
  );
}
if (fs.existsSync(paths.restoreManifestPath)) {
  const existing =
    validateRecordingSourceRestoreManifest(
      readJson(
        paths.restoreManifestPath,
        "Recording source restore manifest",
      ),
      runId,
    );
  if (
    existing.sourceSnapshotSha256 !==
      sourceSnapshot.snapshotSha256
  ) {
    throw new Error(
      "Existing restore evidence belongs to a different source snapshot",
    );
  }
  process.stdout.write(
    [
      "Existing disposable recording restore evidence verified.",
      `totalRows=${String(existing.totalRows)}`,
      `tables=${String(existing.tables)}`,
      "",
    ].join("\n"),
  );
  process.exit(0);
}

process.stdout.write(
  [
    "Verified private recording source snapshot for disposable restore.",
    `runId=${runId}`,
    `snapshotRows=${String(sourceSnapshot.totalRows)}`,
    `snapshotTables=${String(Object.keys(sourceSnapshot.tables).length)}`,
    `cloudPort=${String(cloudPort)}`,
    `sitePort=${String(sitePort)}`,
    "",
  ].join("\n"),
);
if (dryRun) {
  process.stdout.write(
    "Dry run complete; no disposable deployment was created.\n",
  );
  process.exit(0);
}
if (fs.existsSync(paths.restoreRoot)) {
  throw new Error(
    "Disposable recording restore directory already exists",
  );
}

const restoreProject = path.join(
  paths.restoreRoot,
  "project",
);
const restoredSnapshotPath = path.join(
  paths.restoreRoot,
  "restored-snapshot.zip",
);
createRestoreProject({
  restoreProject,
  sourceProject,
});
const convexExecutable = path.join(
  sourceProject,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "convex.cmd" : "convex",
);
let backend;
let restoredSnapshot;
try {
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
    "Disposable recording Convex configuration",
    { cwd: restoreProject },
  );
  backend = spawn(
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
  await waitForFunctionsReady(backend);
  runCommand(
    convexExecutable,
    [
      "import",
      "--replace-all",
      "--yes",
      paths.snapshotPath,
    ],
    "Disposable recording snapshot import",
    { cwd: restoreProject },
  );
  runCommand(
    convexExecutable,
    [
      "export",
      "--path",
      restoredSnapshotPath,
    ],
    "Disposable recording snapshot re-export",
    { cwd: restoreProject },
  );
  restoredSnapshot = inspectPortableSnapshot({
    snapshotPath: restoredSnapshotPath,
    allowedTables: [...RECORDING_SOURCE_TABLES],
    expectedCounts: {
      sounders: catalogManifest.sounders,
      segmentTemplates: catalogManifest.templates,
    },
  });
  comparePortableSnapshots(
    sourceSnapshot,
    restoredSnapshot,
  );
} finally {
  if (backend !== undefined) {
    await stopBackend(backend);
  }
  if (fs.existsSync(paths.restoreRoot)) {
    fs.rmSync(paths.restoreRoot, {
      recursive: true,
      force: true,
    });
  }
}
if (
  restoredSnapshot === undefined ||
  fs.existsSync(paths.restoreRoot)
) {
  throw new Error(
    "Disposable recording restore did not finish safely",
  );
}

writeOrVerifyRecordingSourceRestoreManifest({
  manifestPath: paths.restoreManifestPath,
  manifest: {
    formatVersion: 1,
    kind: "recording-source-disposable-restore",
    runId,
    validatedAt: new Date().toISOString(),
    sourceSnapshotSha256:
      sourceSnapshot.snapshotSha256,
    restoredSnapshotSha256:
      restoredSnapshot.snapshotSha256,
    tableHashesMatched: true,
    disposableRestoreDeleted: true,
    manifestContainsRowValues: false,
    totalRows: restoredSnapshot.totalRows,
    tables: Object.keys(restoredSnapshot.tables).length,
  },
});
process.stdout.write(
  [
    "Disposable recording source restore validation complete.",
    `totalRows=${String(restoredSnapshot.totalRows)}`,
    `tables=${String(Object.keys(restoredSnapshot.tables).length)}`,
    "All table counts and canonical document hashes matched.",
    "The disposable local restore was deleted.",
    "",
  ].join("\n"),
);
