import assert from "node:assert/strict";
import test from "node:test";

import { SOURCE_SCHEMA_FINGERPRINT } from "../../convex/migration/constants.ts";
import {
  EXPECTED_SOURCE_SCHEMA_FINGERPRINT,
  sourceFingerprintFromArguments,
  validateRecentSourceCensus,
} from "./source-census.mjs";

const SOURCE_FINGERPRINT = "a".repeat(64);
const SERVER_FINGERPRINT = "b".repeat(64);
const NOW = Date.parse("2026-08-02T16:00:00.000Z");

function census(overrides = {}) {
  return {
    generatedAt: "2026-08-02T15:59:00.000Z",
    safety: {
      verifiedDatabase: "dev",
      readOnlyIntent: true,
      statementsRestrictedToReadOnly: true,
      containsRowValues: false,
      schemaFingerprint: EXPECTED_SOURCE_SCHEMA_FINGERPRINT,
      sourceFingerprint: SOURCE_FINGERPRINT,
      serverFingerprint: SERVER_FINGERPRINT,
      ...overrides.safety,
    },
    metadata: {
      tableSizes: [
        {
          schemaName: "dbo",
          tableName: "User",
          rowCount: "19",
        },
      ],
      ...overrides.metadata,
    },
    ...Object.fromEntries(
      Object.entries(overrides).filter(
        ([key]) => !["safety", "metadata"].includes(key),
      ),
    ),
  };
}

test("requires one explicit lowercase snapshot fingerprint", () => {
  assert.equal(
    EXPECTED_SOURCE_SCHEMA_FINGERPRINT,
    SOURCE_SCHEMA_FINGERPRINT,
  );
  assert.equal(
    sourceFingerprintFromArguments([
      "--source-fingerprint",
      SOURCE_FINGERPRINT,
    ]),
    SOURCE_FINGERPRINT,
  );
  assert.throws(
    () => sourceFingerprintFromArguments([]),
    /Exactly one/u,
  );
  assert.throws(
    () =>
      sourceFingerprintFromArguments([
        "--source-fingerprint",
        SOURCE_FINGERPRINT.toUpperCase(),
      ]),
    /lowercase SHA-256/u,
  );
});

test("accepts a recent approved snapshot on the reviewed schema", () => {
  const result = validateRecentSourceCensus(census(), {
    approvedSourceFingerprint: SOURCE_FINGERPRINT,
    nowMs: NOW,
  });
  assert.equal(
    result.schemaFingerprint,
    EXPECTED_SOURCE_SCHEMA_FINGERPRINT,
  );
  assert.equal(result.sourceFingerprint, SOURCE_FINGERPRINT);
  assert.equal(result.expectedCounts.get("dbo.User"), 19);
});

test("rejects stale, unapproved, or structurally drifted censuses", () => {
  assert.throws(
    () =>
      validateRecentSourceCensus(
        census({ generatedAt: "2026-08-02T15:40:00.000Z" }),
        {
          approvedSourceFingerprint: SOURCE_FINGERPRINT,
          nowMs: NOW,
        },
      ),
    /previous 15 minutes/u,
  );
  assert.throws(
    () =>
      validateRecentSourceCensus(census(), {
        approvedSourceFingerprint: "c".repeat(64),
        nowMs: NOW,
      }),
    /explicitly approved/u,
  );
  assert.throws(
    () =>
      validateRecentSourceCensus(
        census({
          safety: { schemaFingerprint: "d".repeat(64) },
        }),
        {
          approvedSourceFingerprint: SOURCE_FINGERPRINT,
          nowMs: NOW,
        },
      ),
    /reviewed migration schema/u,
  );
});
