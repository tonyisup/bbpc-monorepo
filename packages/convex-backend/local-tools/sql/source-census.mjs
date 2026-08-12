import fs from "node:fs";
import path from "node:path";

export const EXPECTED_SOURCE_SCHEMA_FINGERPRINT =
  "8dd315bd8141fe7c011481c6c5d4840e10cd0e81be8dcfaf7eb325654d023d18";
export const MAX_CENSUS_AGE_MS = 15 * 60 * 1000;

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;

export function sourceFingerprintFromArguments(argv) {
  const indexes = argv.flatMap((argument, index) =>
    argument === "--source-fingerprint" ? [index] : [],
  );
  if (indexes.length !== 1) {
    throw new Error(
      "Exactly one --source-fingerprint <sha256> is required",
    );
  }
  const fingerprint = argv[indexes[0] + 1];
  if (
    typeof fingerprint !== "string" ||
    !FINGERPRINT_PATTERN.test(fingerprint)
  ) {
    throw new Error(
      "--source-fingerprint must be a lowercase SHA-256 value",
    );
  }
  return fingerprint;
}

export function validateRecentSourceCensus(
  census,
  {
    approvedSourceFingerprint,
    nowMs = Date.now(),
    maxAgeMs = MAX_CENSUS_AGE_MS,
  },
) {
  const generatedAtMs = Date.parse(census?.generatedAt);
  if (
    !Number.isFinite(generatedAtMs) ||
    generatedAtMs > nowMs ||
    nowMs - generatedAtMs > maxAgeMs
  ) {
    throw new Error(
      "The guarded database census must be regenerated within the previous 15 minutes",
    );
  }
  const safety = census?.safety;
  if (
    safety?.verifiedDatabase !== "dev" ||
    safety.readOnlyIntent !== true ||
    safety.statementsRestrictedToReadOnly !== true ||
    safety.containsRowValues !== false
  ) {
    throw new Error(
      "The guarded database census does not satisfy the local read-only source boundary",
    );
  }
  if (
    safety.schemaFingerprint !==
    EXPECTED_SOURCE_SCHEMA_FINGERPRINT
  ) {
    throw new Error(
      "The dev source schema does not match the reviewed migration schema",
    );
  }
  if (
    !FINGERPRINT_PATTERN.test(safety.sourceFingerprint ?? "") ||
    safety.sourceFingerprint !== approvedSourceFingerprint
  ) {
    throw new Error(
      "The recent census does not match the explicitly approved frozen-source fingerprint",
    );
  }
  if (
    !FINGERPRINT_PATTERN.test(safety.serverFingerprint ?? "")
  ) {
    throw new Error(
      "The guarded database census has an invalid server fingerprint",
    );
  }
  if (!Array.isArray(census?.metadata?.tableSizes)) {
    throw new Error(
      "The guarded database census has no table-size inventory",
    );
  }
  const expectedCounts = new Map();
  for (const table of census.metadata.tableSizes) {
    const tableName = `${table?.schemaName}.${table?.tableName}`;
    const rowCount = Number(table?.rowCount);
    if (
      tableName === "undefined.undefined" ||
      !Number.isSafeInteger(rowCount) ||
      rowCount < 0 ||
      expectedCounts.has(tableName)
    ) {
      throw new Error(
        "The guarded database census has an invalid table-size entry",
      );
    }
    expectedCounts.set(tableName, rowCount);
  }
  return Object.freeze({
    generatedAt: census.generatedAt,
    schemaFingerprint: safety.schemaFingerprint,
    sourceFingerprint: safety.sourceFingerprint,
    serverFingerprint: safety.serverFingerprint,
    expectedCounts,
  });
}

export function loadRecentSourceCensus({
  workspaceRoot,
  approvedSourceFingerprint,
  nowMs,
}) {
  const censusPath = path.join(
    workspaceRoot,
    "bbpc-db/census/artifacts/database-census.json",
  );
  const census = JSON.parse(fs.readFileSync(censusPath, "utf8"));
  return validateRecentSourceCensus(census, {
    approvedSourceFingerprint,
    ...(nowMs === undefined ? {} : { nowMs }),
  });
}
