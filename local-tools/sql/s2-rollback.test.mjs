import assert from "node:assert/strict";
import test from "node:test";

import {
  assertS2RollbackEvidence,
  S2_ROLLBACK_ACTOR,
} from "./s2-rollback.mjs";

test("accepts exact aggregate S2-to-S0 rollback evidence", () => {
  assert.equal(
    S2_ROLLBACK_ACTOR,
    "portable-restore-s2-rollback",
  );
  assert.deepEqual(
    assertS2RollbackEvidence({
      runMatches: true,
      cutoverStageS0: true,
      applicationWritesDisabled: true,
      firstApplicationWriteAbsent: true,
      initializationAuditCount: 1,
      transitionAuditCount: 3,
      transitionSequenceValid: true,
    }),
    {
      validated: true,
      fromStage: "S2",
      toStage: "S0",
      applicationWritesDisabled: true,
      firstApplicationWriteAbsent: true,
      initializationAuditCount: 1,
      transitionAuditCount: 3,
      transitionSequenceValid: true,
    },
  );
});

test("rejects incomplete or unsafe S2 rollback evidence", () => {
  const valid = {
    runMatches: true,
    cutoverStageS0: true,
    applicationWritesDisabled: true,
    firstApplicationWriteAbsent: true,
    initializationAuditCount: 1,
    transitionAuditCount: 3,
    transitionSequenceValid: true,
  };
  for (const [key, value] of [
    ["runMatches", false],
    ["cutoverStageS0", false],
    ["applicationWritesDisabled", false],
    ["firstApplicationWriteAbsent", false],
    ["initializationAuditCount", 0],
    ["transitionAuditCount", 2],
    ["transitionSequenceValid", false],
  ]) {
    assert.throws(
      () =>
        assertS2RollbackEvidence({
          ...valid,
          [key]: value,
        }),
      /rollback evidence is incomplete/u,
    );
  }
});
