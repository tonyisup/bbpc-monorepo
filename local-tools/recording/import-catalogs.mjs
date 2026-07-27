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
  recordingCatalogImportPayload,
} from "./catalog-import.mjs";
import {
  writeOrVerifyRecordingCatalogManifest,
} from "./catalog-manifest.mjs";
import { parseNamedArguments } from "./cli.mjs";

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

const args = parseNamedArguments(process.argv.slice(2));
const runId = args.get("run-id");
if (!runId) {
  throw new Error("--run-id is required");
}
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
  throw new Error("The recording catalog source URL is not allowed");
}

const client = new ConvexHttpClient(sourceUrl);
const [rawSounders, rawTemplates] = await Promise.all([
  client.query(
    makeFunctionReference("sounders:list"),
    {},
  ),
  client.query(
    makeFunctionReference("segmentTemplates:list"),
    {},
  ),
]);
const catalogs = canonicalizeRecordingCatalogs(
  rawSounders,
  rawTemplates,
);
const payload = recordingCatalogImportPayload(
  catalogs,
  Date.now(),
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
