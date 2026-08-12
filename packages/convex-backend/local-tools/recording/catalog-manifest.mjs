import fs from "node:fs";
import path from "node:path";

const SAFE_RUN_ID = /^[A-Za-z0-9._:-]{1,100}$/u;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;

function requireCatalogCount(value, label, maximum) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  ) {
    throw new Error(`${label} is outside its safety bound`);
  }
  return value;
}

export function validateRecordingCatalogManifest(
  manifest,
  expectedRunId,
) {
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    manifest.formatVersion !== 1 ||
    manifest.kind !== "recording-catalog-reconciliation" ||
    typeof manifest.runId !== "string" ||
    !SAFE_RUN_ID.test(manifest.runId) ||
    manifest.runId !== expectedRunId ||
    !Number.isSafeInteger(manifest.sourceObservedAt) ||
    manifest.sourceObservedAt < 0 ||
    typeof manifest.digest !== "string" ||
    !SHA256_DIGEST.test(manifest.digest) ||
    manifest.manifestContainsRowValues !== false
  ) {
    throw new Error(
      "Recording catalog reconciliation manifest is invalid",
    );
  }
  return {
    formatVersion: 1,
    kind: "recording-catalog-reconciliation",
    runId: manifest.runId,
    sourceObservedAt: manifest.sourceObservedAt,
    digest: manifest.digest,
    sounders: requireCatalogCount(
      manifest.sounders,
      "Recording sounder count",
      1_000,
    ),
    templates: requireCatalogCount(
      manifest.templates,
      "Recording template count",
      100,
    ),
    manifestContainsRowValues: false,
  };
}

export function recordingCatalogManifestPath({
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
      "A project root and safe recording catalog run ID are required",
    );
  }
  return path.join(
    projectRoot,
    ".local-migration",
    runId,
    "recording-catalog",
    "manifest.json",
  );
}

export function readRecordingCatalogManifest({
  projectRoot,
  runId,
}) {
  const manifestPath = recordingCatalogManifestPath({
    projectRoot,
    runId,
  });
  const manifest = validateRecordingCatalogManifest(
    JSON.parse(fs.readFileSync(manifestPath, "utf8")),
    runId,
  );
  return { manifestPath, manifest };
}

export function writeOrVerifyRecordingCatalogManifest({
  projectRoot,
  manifest,
}) {
  const validated = validateRecordingCatalogManifest(
    manifest,
    manifest?.runId,
  );
  const manifestPath = recordingCatalogManifestPath({
    projectRoot,
    runId: validated.runId,
  });
  const directory = path.dirname(manifestPath);
  fs.mkdirSync(directory, {
    recursive: true,
    mode: 0o700,
  });
  fs.chmodSync(directory, 0o700);

  if (fs.existsSync(manifestPath)) {
    const existing = validateRecordingCatalogManifest(
      JSON.parse(fs.readFileSync(manifestPath, "utf8")),
      validated.runId,
    );
    if (
      existing.digest !== validated.digest ||
      existing.sounders !== validated.sounders ||
      existing.templates !== validated.templates
    ) {
      throw new Error(
        "Existing recording catalog manifest conflicts with the reconciled source",
      );
    }
    fs.chmodSync(manifestPath, 0o600);
    return { manifestPath, manifest: existing, created: false };
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
  return { manifestPath, manifest: validated, created: true };
}
