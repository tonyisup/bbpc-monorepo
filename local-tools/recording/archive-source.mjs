import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

import { inspectPortableSnapshot } from "../sql/portable-snapshot.mjs";
import {
  readRecordingCatalogManifest,
} from "./catalog-manifest.mjs";
import { parseNamedArguments } from "./cli.mjs";
import {
  buildRecordingSourceArchiveManifest,
  RECORDING_SOURCE_TABLES,
  recordingSourceArchivePaths,
  validateRecordingSourceArchiveManifest,
  validateRecordingSourceTarget,
  writeOrVerifyRecordingSourceArchiveManifest,
} from "./source-archive.mjs";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolDirectory, "../..");
const PRIVATE_ACK = "ack-private-recording-source";
const BACKUP_ONLY_ACK = "ack-backup-only-no-shared-import";
const SHA256 = /^[0-9a-f]{64}$/u;

function usage() {
  return [
    "Usage:",
    "  npm run migration:recording-archive -- --run-id <id> --dry-run",
    "  execute: --source-fingerprint <sha256> " +
      `--${PRIVATE_ACK} --${BACKUP_ONLY_ACK}`,
    "",
    "Exports the old standalone recording deployment into a private",
    "backup-only ZIP. It never writes to the source or shared Convex",
    "deployments, and it never prints row values or deployment names.",
  ].join("\n");
}

function runCommand(
  command,
  commandArgs,
  label,
  cwd,
  capture = false,
  suppressCapturedOutput = false,
) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (result.error || result.status !== 0) {
    if (
      capture &&
      !suppressCapturedOutput &&
      result.stderr
    ) {
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
const sourceEnvPath = path.resolve(
  sourceProject,
  args.get("source-env") ?? ".env.local",
);
const sourceEnv = parseEnv(
  fs.readFileSync(sourceEnvPath, "utf8"),
);
const source = validateRecordingSourceTarget({
  sourceUrl: sourceEnv.NEXT_PUBLIC_CONVEX_URL,
  deployment: sourceEnv.CONVEX_DEPLOYMENT,
});
const expectedFingerprint = args.get(
  "source-fingerprint",
);
if (!dryRun) {
  if (
    typeof expectedFingerprint !== "string" ||
    !SHA256.test(expectedFingerprint) ||
    expectedFingerprint !== source.sourceFingerprint
  ) {
    throw new Error(
      "The exact dry-run --source-fingerprint is required",
    );
  }
  for (const acknowledgement of [
    PRIVATE_ACK,
    BACKUP_ONLY_ACK,
  ]) {
    if (!args.has(acknowledgement)) {
      throw new Error(
        `Explicit --${acknowledgement} acknowledgement is required`,
      );
    }
  }
}
const { manifest: catalogManifest } =
  readRecordingCatalogManifest({
    projectRoot,
    runId,
  });
const paths = recordingSourceArchivePaths({
  projectRoot,
  runId,
});

process.stdout.write(
  [
    "Validated standalone recording archive target.",
    `runId=${runId}`,
    `sourceFingerprint=${source.sourceFingerprint}`,
    `expectedSounders=${String(catalogManifest.sounders)}`,
    `expectedTemplates=${String(catalogManifest.templates)}`,
    "",
  ].join("\n"),
);
if (dryRun) {
  process.stdout.write(
    "Dry run complete; no source rows were read and no backup files were created.\n",
  );
  process.exit(0);
}

const snapshotExists = fs.existsSync(paths.snapshotPath);
const manifestExists = fs.existsSync(paths.manifestPath);
if (snapshotExists !== manifestExists) {
  throw new Error(
    "The recording source archive is incomplete and will not be overwritten",
  );
}
if (snapshotExists && manifestExists) {
  const snapshot = inspectPortableSnapshot({
    snapshotPath: paths.snapshotPath,
    allowedTables: [...RECORDING_SOURCE_TABLES],
    expectedCounts: {
      sounders: catalogManifest.sounders,
      segmentTemplates: catalogManifest.templates,
    },
  });
  const existing =
    validateRecordingSourceArchiveManifest(
      readJson(
        paths.manifestPath,
        "Recording source archive manifest",
      ),
      runId,
    );
  if (
    existing.sourceFingerprint !==
      source.sourceFingerprint ||
    existing.snapshotSha256 !==
      snapshot.snapshotSha256 ||
    existing.snapshotRows !== snapshot.totalRows ||
    JSON.stringify(existing.tables) !==
      JSON.stringify(snapshot.tables)
  ) {
    throw new Error(
      "The existing recording source archive does not match its manifest",
    );
  }
  process.stdout.write(
    [
      "Existing private recording source archive verified.",
      `snapshotRows=${String(snapshot.totalRows)}`,
      `snapshotTables=${String(Object.keys(snapshot.tables).length)}`,
      `snapshotSha256=${snapshot.snapshotSha256}`,
      "",
    ].join("\n"),
  );
  process.exit(0);
}

fs.mkdirSync(paths.archiveDirectory, {
  recursive: true,
  mode: 0o700,
});
fs.chmodSync(paths.archiveDirectory, 0o700);
const partialSnapshotPath = path.join(
  paths.archiveDirectory,
  `.recording-source-snapshot-${String(process.pid)}.partial.zip`,
);
if (fs.existsSync(partialSnapshotPath)) {
  throw new Error(
    "A recording source archive partial file already exists",
  );
}
const convexExecutable = path.join(
  sourceProject,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "convex.cmd" : "convex",
);
try {
  runCommand(
    convexExecutable,
    [
      "export",
      "--deployment",
      source.deployment,
      "--path",
      partialSnapshotPath,
    ],
    "Private recording source export",
    sourceProject,
    true,
    true,
  );
  fs.chmodSync(partialSnapshotPath, 0o600);
  const snapshot = inspectPortableSnapshot({
    snapshotPath: partialSnapshotPath,
    allowedTables: [...RECORDING_SOURCE_TABLES],
    expectedCounts: {
      sounders: catalogManifest.sounders,
      segmentTemplates: catalogManifest.templates,
    },
  });
  fs.renameSync(partialSnapshotPath, paths.snapshotPath);
  fs.chmodSync(paths.snapshotPath, 0o600);
  const sourceCommit = runCommand(
    "git",
    ["rev-parse", "HEAD"],
    "Recording source commit inspection",
    sourceProject,
    true,
  );
  const manifest = buildRecordingSourceArchiveManifest({
    runId,
    createdAt: new Date().toISOString(),
    sourceFingerprint: source.sourceFingerprint,
    sourceCommit,
    snapshot,
  });
  writeOrVerifyRecordingSourceArchiveManifest({
    manifestPath: paths.manifestPath,
    manifest,
  });
  process.stdout.write(
    [
      "Private recording source backup-only archive complete.",
      `snapshotRows=${String(snapshot.totalRows)}`,
      `snapshotTables=${String(Object.keys(snapshot.tables).length)}`,
      `snapshotSha256=${snapshot.snapshotSha256}`,
      `snapshot=${paths.snapshotPath}`,
      `manifest=${paths.manifestPath}`,
      "The snapshot contains plaintext legacy capabilities and private row values.",
      "It must never be imported into the shared Convex deployment.",
      "",
    ].join("\n"),
  );
} finally {
  if (fs.existsSync(partialSnapshotPath)) {
    fs.rmSync(partialSnapshotPath);
  }
}
