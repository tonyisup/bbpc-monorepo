import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { BBPC_API_VERSION } from "../../contracts/index.js";
import {
  PORTABLE_BACKUP_TABLES,
  SOURCE_SCHEMA_FINGERPRINT,
} from "../../convex/migration/constants.ts";
import {
  countsFromVerifiedManifests,
  REHEARSAL_DOMAINS,
} from "./rehearsal-plan.mjs";
import {
  executePortableScrub,
  portableCountsFromRawCounts,
} from "./portable-backup-plan.mjs";
import { inspectPortableSnapshot } from "./portable-snapshot.mjs";
import { verifyDomainManifest } from "./manifest.mjs";
import {
  readRecordingCatalogManifest,
} from "../recording/catalog-manifest.mjs";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolDirectory, "../..");
const SOURCE_ACK = "--ack-production-derived-local-only";
const SCRUB_ACK = "--ack-one-way-portable-scrub";
const BACKUP_ACK = "--ack-private-portable-backup";

function usage() {
  return [
    "Usage:",
    "  npm run migration:backup:local -- --run-id <id> " +
      "[--batch-size <1..100>] [--dry-run] " +
      `${SOURCE_ACK}`,
    `  execute: ${SCRUB_ACK} ${BACKUP_ACK}`,
    "",
    "Validates the reconciled local run, executes the one-way portable",
    "scrub, exports a private local snapshot, and writes aggregate hashes.",
    "It never targets a cloud deployment.",
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
    ...(dryRun ? [] : [SCRUB_ACK, BACKUP_ACK]),
  ]) {
    if (!argv.includes(acknowledgement)) {
      throw new Error(
        `Explicit ${acknowledgement} acknowledgement is required`,
      );
    }
  }
  return { runId, batchSize, dryRun };
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

function assertRehearsalEvidence(evidence, totalRows) {
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
    evidence.checkpointSummary?.insertedRows !== totalRows ||
    evidence.checkpointSummary?.reusedRows !== totalRows
  ) {
    throw new Error(
      "The local rehearsal does not satisfy the portable backup gate",
    );
  }
}

function writeOrVerifyManifest(manifestPath, manifest) {
  if (fs.existsSync(manifestPath)) {
    const existing = JSON.parse(
      fs.readFileSync(manifestPath, "utf8"),
    );
    if (
      existing.runId !== manifest.runId ||
      existing.snapshotSha256 !== manifest.snapshotSha256 ||
      JSON.stringify(existing.tables) !==
        JSON.stringify(manifest.tables)
    ) {
      throw new Error(
        "Existing portable backup manifest does not match the snapshot",
      );
    }
    return;
  }
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    },
  );
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
const { manifest: recordingCatalogManifest } =
  readRecordingCatalogManifest({
    projectRoot,
    runId,
  });
const {
  canonicalCounts,
  domainRows,
  migrationRows,
  totalRows,
} = portableCountsFromRawCounts(rawCounts, {
  sounders: recordingCatalogManifest.sounders,
  templates: recordingCatalogManifest.templates,
});
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
const manifestPath = path.join(backupDirectory, "manifest.json");

process.stdout.write(
  [
    "Verified all eight immutable manifests for portable backup.",
    `runId=${runId}`,
    `canonicalTables=${String(Object.keys(canonicalCounts).length)}`,
    `canonicalRows=${String(totalRows)}`,
    `batchSize=${String(batchSize)}`,
    "",
  ].join("\n"),
);
if (dryRun) {
  process.stdout.write(
    "Dry run complete; no Convex state or backup files were changed.\n",
  );
  process.exit(0);
}

let portable = runConvex(
  "migration/rehearsal:inspectPortableTarget",
  { runId },
);
let scrubResult;
if (portable.portable !== true) {
  const scrubProgress = runConvex(
    "migration/rehearsal:inspectFinalScrubProgress",
    { runId },
  );
  if (scrubProgress.scrubStarted === true) {
    if (
      scrubProgress.systemStatePresent !== true ||
      scrubProgress.matchesRun !== true ||
      scrubProgress.cutoverStage !== "S1" ||
      scrubProgress.scrubStatus !== "running"
    ) {
      throw new Error(
        "The existing portable scrub is not safely resumable",
      );
    }
  } else {
    assertRehearsalEvidence(
      runConvex(
        "migration/rehearsal:inspectRehearsalEvidence",
        { runId },
      ),
      migrationRows,
    );
  }
  scrubResult = await executePortableScrub({
    runId,
    batchSize,
    domainRows,
    invoke: async (functionName, args) =>
      runConvex(functionName, args),
    onProgress: (label, progress) => {
      if (progress.done) {
        process.stdout.write(
          `${label}: completed totalDeleted=${String(progress.totalDeleted)} attempts=${String(progress.attempt)}\n`,
        );
      }
    },
  });
  portable = runConvex(
    "migration/rehearsal:inspectPortableTarget",
    { runId },
  );
}
if (
  portable.portable !== true ||
  portable.systemStatePresent !== false ||
  portable.completionAuditFound !== true ||
  portable.nonemptyTemporaryTables?.length !== 0
) {
  throw new Error(
    "The local deployment did not reach portable backup state",
  );
}

fs.mkdirSync(backupDirectory, {
  recursive: true,
  mode: 0o700,
});
fs.chmodSync(backupDirectory, 0o700);
if (!fs.existsSync(snapshotPath)) {
  runCommand(
    "npx",
    [
      "convex",
      "export",
      "--deployment",
      "local",
      "--path",
      snapshotPath,
    ],
    "Local portable snapshot export",
  );
}
fs.chmodSync(snapshotPath, 0o600);
const inspected = inspectPortableSnapshot({
  snapshotPath,
  allowedTables: [...PORTABLE_BACKUP_TABLES],
  expectedCounts: canonicalCounts,
});
const backendCommit = runCommand(
  "git",
  ["rev-parse", "HEAD"],
  "Backend commit inspection",
  true,
);
const manifest = {
  formatVersion: 1,
  runId,
  createdAt: new Date().toISOString(),
  sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
  apiVersion: BBPC_API_VERSION,
  backendCommit,
  manifestContainsRowValues: false,
  snapshotContainsProductionDerivedRowValues: true,
  snapshotFile: path.basename(snapshotPath),
  snapshotSha256: inspected.snapshotSha256,
  canonicalRows: totalRows,
  snapshotRows: inspected.totalRows,
  tables: inspected.tables,
  recordingCatalog: {
    digest: recordingCatalogManifest.digest,
    sounders: recordingCatalogManifest.sounders,
    templates: recordingCatalogManifest.templates,
  },
  ...(scrubResult === undefined
    ? {}
    : {
        scrub: {
          rawRowsDeleted: scrubResult.rawRowsDeleted,
          metadataDeleted: scrubResult.metadataDeleted,
          deploymentControlDeleted:
            scrubResult.deploymentControlDeleted,
          systemStateDeleted: scrubResult.systemStateDeleted,
        },
      }),
};
writeOrVerifyManifest(manifestPath, manifest);
fs.chmodSync(manifestPath, 0o600);

process.stdout.write(
  [
    "Portable local backup complete.",
    `snapshotRows=${String(inspected.totalRows)}`,
    `snapshotTables=${String(Object.keys(inspected.tables).length)}`,
    `snapshotSha256=${inspected.snapshotSha256}`,
    `snapshot=${snapshotPath}`,
    `manifest=${manifestPath}`,
    "The snapshot contains production-derived values and must remain private.",
    "",
  ].join("\n"),
);
