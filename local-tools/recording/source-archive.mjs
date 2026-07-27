import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";

export const RECORDING_SOURCE_TABLES = Object.freeze([
  "sessions",
  "sessionInvites",
  "participants",
  "rtcPresence",
  "rtcSignals",
  "sessionEvents",
  "segmentTemplates",
  "sessionManifests",
  "sessionFavorites",
  "sounders",
  "recordingUploads",
]);

const SAFE_RUN_ID = /^[A-Za-z0-9._:-]{1,100}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const DEPLOYMENT =
  /^(?<kind>dev|prod):(?<name>[a-z0-9]+(?:-[a-z0-9]+)*)$/u;

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

export function validateRecordingSourceTarget({
  sourceUrl,
  deployment,
}) {
  if (
    typeof sourceUrl !== "string" ||
    typeof deployment !== "string"
  ) {
    throw new Error(
      "The recording source URL and deployment are required",
    );
  }
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error(
      "The recording source must be a Convex cloud URL",
    );
  }
  const deploymentMatch = DEPLOYMENT.exec(deployment);
  const deploymentName =
    deploymentMatch?.groups?.name;
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname.endsWith(".convex.cloud") ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    deploymentName === undefined ||
    parsed.hostname !== `${deploymentName}.convex.cloud`
  ) {
    throw new Error(
      "The recording source deployment does not match its Convex cloud URL",
    );
  }
  return {
    deployment,
    deploymentName,
    sourceFingerprint: sha256(
      `${deployment}\n${parsed.origin}\n`,
    ),
  };
}

export function recordingSourceArchivePaths({
  projectRoot,
  runId,
}) {
  if (
    typeof projectRoot !== "string" ||
    !path.isAbsolute(projectRoot) ||
    typeof runId !== "string" ||
    !SAFE_RUN_ID.test(runId)
  ) {
    throw new Error(
      "A project root and safe recording archive run ID are required",
    );
  }
  const archiveDirectory = path.join(
    projectRoot,
    ".local-migration",
    runId,
    "recording-source-archive",
  );
  return {
    archiveDirectory,
    snapshotPath: path.join(
      archiveDirectory,
      "recording-source-snapshot.zip",
    ),
    manifestPath: path.join(
      archiveDirectory,
      "manifest.json",
    ),
    restoreManifestPath: path.join(
      archiveDirectory,
      "restore-manifest.json",
    ),
    restoreRoot: path.join(
      projectRoot,
      ".local-migration",
      runId,
      "recording-source-restore",
    ),
  };
}

function validateTableEvidence(tables) {
  if (
    typeof tables !== "object" ||
    tables === null
  ) {
    throw new Error(
      "Recording source archive table evidence is invalid",
    );
  }
  const allowed = new Set(RECORDING_SOURCE_TABLES);
  const validated = {};
  for (const [table, evidence] of Object.entries(tables)) {
    if (
      !allowed.has(table) ||
      typeof evidence !== "object" ||
      evidence === null ||
      !Number.isSafeInteger(evidence.rows) ||
      evidence.rows < 0 ||
      typeof evidence.sha256 !== "string" ||
      !SHA256.test(evidence.sha256)
    ) {
      throw new Error(
        "Recording source archive table evidence is invalid",
      );
    }
    validated[table] = {
      rows: evidence.rows,
      sha256: evidence.sha256,
    };
  }
  return validated;
}

export function validateRecordingSourceArchiveManifest(
  manifest,
  expectedRunId,
) {
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    manifest.formatVersion !== 1 ||
    manifest.kind !== "recording-source-backup-only" ||
    typeof manifest.runId !== "string" ||
    !SAFE_RUN_ID.test(manifest.runId) ||
    manifest.runId !== expectedRunId ||
    typeof manifest.createdAt !== "string" ||
    Number.isNaN(new Date(manifest.createdAt).valueOf()) ||
    typeof manifest.sourceFingerprint !== "string" ||
    !SHA256.test(manifest.sourceFingerprint) ||
    typeof manifest.sourceCommit !== "string" ||
    !GIT_OID.test(manifest.sourceCommit) ||
    manifest.manifestContainsRowValues !== false ||
    manifest.snapshotContainsPrivateValues !== true ||
    manifest.plaintextCapabilitiesPresent !== true ||
    manifest.destinationPolicy !==
      "backup-only-never-import-into-shared-convex" ||
    typeof manifest.snapshotFile !== "string" ||
    manifest.snapshotFile !==
      "recording-source-snapshot.zip" ||
    typeof manifest.snapshotSha256 !== "string" ||
    !SHA256.test(manifest.snapshotSha256) ||
    !Number.isSafeInteger(manifest.snapshotRows) ||
    manifest.snapshotRows < 0
  ) {
    throw new Error(
      "Recording source archive manifest is invalid",
    );
  }
  const tables = validateTableEvidence(manifest.tables);
  const rows = Object.values(tables).reduce(
    (total, table) => total + table.rows,
    0,
  );
  if (
    rows !== manifest.snapshotRows ||
    (tables.sessionInvites?.rows ?? 0) < 1 ||
    (tables.participants?.rows ?? 0) < 1
  ) {
    throw new Error(
      "Recording source archive manifest is inconsistent",
    );
  }
  return {
    formatVersion: 1,
    kind: "recording-source-backup-only",
    runId: manifest.runId,
    createdAt: manifest.createdAt,
    sourceFingerprint: manifest.sourceFingerprint,
    sourceCommit: manifest.sourceCommit,
    manifestContainsRowValues: false,
    snapshotContainsPrivateValues: true,
    plaintextCapabilitiesPresent: true,
    destinationPolicy:
      "backup-only-never-import-into-shared-convex",
    snapshotFile: manifest.snapshotFile,
    snapshotSha256: manifest.snapshotSha256,
    snapshotRows: manifest.snapshotRows,
    tables,
  };
}

export function buildRecordingSourceArchiveManifest({
  runId,
  createdAt,
  sourceFingerprint,
  sourceCommit,
  snapshot,
}) {
  return validateRecordingSourceArchiveManifest(
    {
      formatVersion: 1,
      kind: "recording-source-backup-only",
      runId,
      createdAt,
      sourceFingerprint,
      sourceCommit,
      manifestContainsRowValues: false,
      snapshotContainsPrivateValues: true,
      plaintextCapabilitiesPresent: true,
      destinationPolicy:
        "backup-only-never-import-into-shared-convex",
      snapshotFile: "recording-source-snapshot.zip",
      snapshotSha256: snapshot.snapshotSha256,
      snapshotRows: snapshot.totalRows,
      tables: snapshot.tables,
    },
    runId,
  );
}

export function writeOrVerifyRecordingSourceArchiveManifest({
  manifestPath,
  manifest,
}) {
  const validated = validateRecordingSourceArchiveManifest(
    manifest,
    manifest?.runId,
  );
  if (fs.existsSync(manifestPath)) {
    const existing = validateRecordingSourceArchiveManifest(
      JSON.parse(fs.readFileSync(manifestPath, "utf8")),
      validated.runId,
    );
    if (
      existing.sourceFingerprint !==
        validated.sourceFingerprint ||
      existing.sourceCommit !== validated.sourceCommit ||
      existing.snapshotSha256 !==
        validated.snapshotSha256 ||
      JSON.stringify(existing.tables) !==
        JSON.stringify(validated.tables)
    ) {
      throw new Error(
        "Existing recording source archive manifest conflicts with the snapshot",
      );
    }
    fs.chmodSync(manifestPath, 0o600);
    return { manifest: existing, created: false };
  }
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(validated, null, 2)}\n`,
    {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    },
  );
  return { manifest: validated, created: true };
}

export function validateRecordingSourceRestoreManifest(
  manifest,
  expectedRunId,
) {
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    manifest.formatVersion !== 1 ||
    manifest.kind !==
      "recording-source-disposable-restore" ||
    typeof manifest.runId !== "string" ||
    !SAFE_RUN_ID.test(manifest.runId) ||
    manifest.runId !== expectedRunId ||
    typeof manifest.validatedAt !== "string" ||
    Number.isNaN(new Date(manifest.validatedAt).valueOf()) ||
    typeof manifest.sourceSnapshotSha256 !== "string" ||
    !SHA256.test(manifest.sourceSnapshotSha256) ||
    typeof manifest.restoredSnapshotSha256 !== "string" ||
    !SHA256.test(manifest.restoredSnapshotSha256) ||
    manifest.tableHashesMatched !== true ||
    manifest.disposableRestoreDeleted !== true ||
    manifest.manifestContainsRowValues !== false ||
    !Number.isSafeInteger(manifest.totalRows) ||
    manifest.totalRows < 0 ||
    !Number.isSafeInteger(manifest.tables) ||
    manifest.tables < 1
  ) {
    throw new Error(
      "Recording source restore manifest is invalid",
    );
  }
  return {
    formatVersion: 1,
    kind: "recording-source-disposable-restore",
    runId: manifest.runId,
    validatedAt: manifest.validatedAt,
    sourceSnapshotSha256:
      manifest.sourceSnapshotSha256,
    restoredSnapshotSha256:
      manifest.restoredSnapshotSha256,
    tableHashesMatched: true,
    disposableRestoreDeleted: true,
    manifestContainsRowValues: false,
    totalRows: manifest.totalRows,
    tables: manifest.tables,
  };
}

export function writeOrVerifyRecordingSourceRestoreManifest({
  manifestPath,
  manifest,
}) {
  const validated = validateRecordingSourceRestoreManifest(
    manifest,
    manifest?.runId,
  );
  if (fs.existsSync(manifestPath)) {
    const existing = validateRecordingSourceRestoreManifest(
      JSON.parse(fs.readFileSync(manifestPath, "utf8")),
      validated.runId,
    );
    if (
      existing.sourceSnapshotSha256 !==
        validated.sourceSnapshotSha256 ||
      existing.restoredSnapshotSha256 !==
        validated.restoredSnapshotSha256 ||
      existing.totalRows !== validated.totalRows ||
      existing.tables !== validated.tables
    ) {
      throw new Error(
        "Existing recording source restore manifest conflicts with the validation",
      );
    }
    fs.chmodSync(manifestPath, 0o600);
    return { manifest: existing, created: false };
  }
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(validated, null, 2)}\n`,
    {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    },
  );
  return { manifest: validated, created: true };
}
