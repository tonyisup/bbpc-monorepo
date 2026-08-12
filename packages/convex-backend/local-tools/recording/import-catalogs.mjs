import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { parseEnv } from "node:util";

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

import {
  canonicalizeRecordingCatalogs,
  publicRecordingCatalogRowsFromArchive,
  recordingCatalogDigest,
  recordingCatalogImportPayload,
} from "./catalog-import.mjs";
import {
  readRecordingCatalogManifest,
  writeOrVerifyRecordingCatalogManifest,
} from "./catalog-manifest.mjs";
import { parseNamedArguments } from "./cli.mjs";
import { inspectPortableSnapshot } from "../sql/portable-snapshot.mjs";
import {
  RECORDING_SOURCE_TABLES,
  recordingSourceArchivePaths,
  validateRecordingSourceArchiveManifest,
  validateRecordingSourceRestoreManifest,
} from "./source-archive.mjs";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolDirectory, "../..");

function runConvex(functionName, args) {
  const result = spawnSync(
    "npx",
    [
      "convex",
      "run",
      functionName,
      JSON.stringify(args),
      "--deployment",
      "local",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() ||
        `Convex command failed with status ${String(result.status)}`,
    );
  }
  return JSON.parse(result.stdout);
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new Error(`${label} is invalid`);
  }
}

function readSnapshotTable(snapshotPath, table, expectedRows) {
  const result = spawnSync(
    "/usr/bin/unzip",
    ["-p", snapshotPath, `${table}/documents.jsonl`],
    {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `Unable to read ${table} from the validated recording archive`,
    );
  }
  let documents;
  try {
    documents = result.stdout
      .split(/\r?\n/u)
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
  } catch {
    throw new Error(
      `Archived ${table} documents are invalid`,
    );
  }
  if (documents.length !== expectedRows) {
    throw new Error(
      `Archived ${table} count does not match its manifest`,
    );
  }
  return documents;
}

function readCatalogsFromValidatedArchive(sourceRunId) {
  const paths = recordingSourceArchivePaths({
    projectRoot,
    runId: sourceRunId,
  });
  const archiveManifest =
    validateRecordingSourceArchiveManifest(
      readJson(
        paths.manifestPath,
        "Recording source archive manifest",
      ),
      sourceRunId,
    );
  const restoreManifest =
    validateRecordingSourceRestoreManifest(
      readJson(
        paths.restoreManifestPath,
        "Recording source restore manifest",
      ),
      sourceRunId,
    );
  const expectedCounts = Object.fromEntries(
    Object.entries(archiveManifest.tables).map(
      ([table, evidence]) => [table, evidence.rows],
    ),
  );
  const snapshot = inspectPortableSnapshot({
    snapshotPath: paths.snapshotPath,
    allowedTables: [...RECORDING_SOURCE_TABLES],
    expectedCounts,
  });
  if (
    snapshot.snapshotSha256 !==
      archiveManifest.snapshotSha256 ||
    snapshot.totalRows !== archiveManifest.snapshotRows ||
    JSON.stringify(snapshot.tables) !==
      JSON.stringify(archiveManifest.tables) ||
    restoreManifest.sourceSnapshotSha256 !==
      archiveManifest.snapshotSha256 ||
    restoreManifest.tableHashesMatched !== true ||
    restoreManifest.disposableRestoreDeleted !== true
  ) {
    throw new Error(
      "The recording source archive or restore evidence does not match",
    );
  }
  const priorCatalog = readRecordingCatalogManifest({
    projectRoot,
    runId: sourceRunId,
  }).manifest;
  const publicRows =
    publicRecordingCatalogRowsFromArchive({
      sounders: readSnapshotTable(
        paths.snapshotPath,
        "sounders",
        priorCatalog.sounders,
      ),
      templates: readSnapshotTable(
        paths.snapshotPath,
        "segmentTemplates",
        priorCatalog.templates,
      ),
    });
  const catalogs = canonicalizeRecordingCatalogs(
    publicRows.sounders,
    publicRows.templates,
  );
  if (
    catalogs.sounders.length !== priorCatalog.sounders ||
    catalogs.templates.length !==
      priorCatalog.templates ||
    recordingCatalogDigest(catalogs) !== priorCatalog.digest
  ) {
    throw new Error(
      "Archived public recording catalogs do not match their original reconciliation digest",
    );
  }
  return {
    catalogs,
    sourceObservedAt: priorCatalog.sourceObservedAt,
  };
}

const args = parseNamedArguments(process.argv.slice(2));
const runId = args.get("run-id");
if (!runId) {
  throw new Error("--run-id is required");
}
const sourceArchiveRunId = args.get(
  "source-archive-run-id",
);
if (
  sourceArchiveRunId !== undefined &&
  args.has("source-env")
) {
  throw new Error(
    "--source-archive-run-id and --source-env are mutually exclusive",
  );
}
let catalogs;
let sourceObservedAt;
if (sourceArchiveRunId !== undefined) {
  if (
    !/^[A-Za-z0-9._:-]{1,100}$/u.test(
      sourceArchiveRunId,
    )
  ) {
    throw new Error(
      "A safe --source-archive-run-id is required",
    );
  }
  ({ catalogs, sourceObservedAt } =
    readCatalogsFromValidatedArchive(
      sourceArchiveRunId,
    ));
} else {
  const sourceEnvPath = path.resolve(
    args.get("source-env") ??
      "../bbpc-recording/.env.local",
  );
  const sourceEnv = parseEnv(
    await readFile(sourceEnvPath, "utf8"),
  );
  const sourceUrl = sourceEnv.NEXT_PUBLIC_CONVEX_URL;
  if (!sourceUrl) {
    throw new Error(
      "The source environment does not define NEXT_PUBLIC_CONVEX_URL",
    );
  }
  const source = new URL(sourceUrl);
  if (
    !(
      source.protocol === "https:" &&
      source.hostname.endsWith(".convex.cloud")
    ) &&
    !(
      source.protocol === "http:" &&
      (source.hostname === "127.0.0.1" ||
        source.hostname === "localhost")
    )
  ) {
    throw new Error(
      "The recording catalog source URL is not allowed",
    );
  }

  const client = new ConvexHttpClient(sourceUrl);
  const [rawSounders, rawTemplates] =
    await Promise.all([
      client.query(
        makeFunctionReference("sounders:list"),
        {},
      ),
      client.query(
        makeFunctionReference("segmentTemplates:list"),
        {},
      ),
    ]);
  catalogs = canonicalizeRecordingCatalogs(
    rawSounders,
    rawTemplates,
  );
  sourceObservedAt = Date.now();
}
const payload = recordingCatalogImportPayload(
  catalogs,
  sourceObservedAt,
);
const migrationArgs = {
  cutoverRunId: runId,
  operationId: "recording.catalogs.import",
  ...payload,
};
const imported = runConvex(
  "migration/recordingCatalog:importRecordingCatalogs",
  migrationArgs,
);
const evidence = runConvex(
  "migration/recordingCatalog:inspectRecordingCatalogs",
  {
    expectedDigest: payload.sourceDigest,
    expectedSounders: catalogs.sounders.length,
    expectedTemplates: catalogs.templates.length,
  },
);
if (!evidence.countsMatch || !evidence.digestMatches) {
  throw new Error(
    "Recording catalog reconciliation did not match the source",
  );
}
const catalogManifest =
  writeOrVerifyRecordingCatalogManifest({
    projectRoot,
    manifest: {
      formatVersion: 1,
      kind: "recording-catalog-reconciliation",
      runId,
      sourceObservedAt: payload.sourceObservedAt,
      digest: payload.sourceDigest,
      sounders: catalogs.sounders.length,
      templates: catalogs.templates.length,
      manifestContainsRowValues: false,
    },
  });
process.stdout.write(
  `${JSON.stringify({
    imported,
    evidence,
    manifest: {
      created: catalogManifest.created,
      path: catalogManifest.manifestPath,
    },
  })}\n`,
);
