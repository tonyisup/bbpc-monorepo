import assert from "node:assert/strict";
import test from "node:test";

import {
  assertFreshTarget,
  assertPipelineEvidence,
  assertResumableTarget,
  assertUserEvidence,
  buildSyntheticIdentityPlan,
} from "./initialize-synthetic-staging.mjs";

const manifest = {
  tables: {
    migrationRawUsers: { rowCount: 2 },
    migrationRawRoles: { rowCount: 1 },
    migrationRawUserRoles: { rowCount: 1 },
  },
};

test("builds the bounded identity-only staging plan", () => {
  const plan = buildSyntheticIdentityPlan(manifest);
  assert.equal(plan.length, 9);
  assert.deepEqual(
    plan.map((step) => step.operationId),
    [
      "identity.start",
      "identity.roles",
      "identity.users",
      "identity.userRoles",
      "identity.finish",
      "identity.reconcile.users",
      "identity.reconcile.roles",
      "identity.reconcile.userRoles",
      "identity.reconcile.finish",
    ],
  );
  assert.throws(
    () =>
      buildSyntheticIdentityPlan({
        tables: {
          ...manifest.tables,
          migrationRawUsers: { rowCount: 3 },
        },
      }),
    /exactly 2\/1\/1/u,
  );
});

test("fresh initialization accepts only a completely empty target", () => {
  assert.doesNotThrow(() =>
    assertFreshTarget({
      fresh: true,
      nonemptyTables: [],
    }),
  );
  assert.throws(
    () =>
      assertFreshTarget({
        fresh: false,
        nonemptyTables: ["users"],
      }),
    /completely empty/u,
  );
});

test("resume is scoped to the exact write-disabled staging run", () => {
  const progress = {
    initialized: true,
    matchesRun: true,
    cutoverStage: "S1",
    apiVersion: "0.1.0",
    domainStatuses: { identity: "running" },
    checkpointStatuses: {},
  };
  assert.doesNotThrow(() => assertResumableTarget(progress));
  for (const invalid of [
    { ...progress, matchesRun: false },
    { ...progress, cutoverStage: "S3" },
    { ...progress, apiVersion: "0.0.0" },
  ]) {
    assert.throws(
      () => assertResumableTarget(invalid),
      /not resumable/u,
    );
  }
});

test("requires exact aggregate principal evidence", () => {
  const userEvidence = {
    runMatches: true,
    cutoverStageS1: true,
    cutoverStageS2: false,
    applicationWritesDisabled: true,
    firstApplicationWriteAbsent: true,
    linkedIdentityCount: 2,
    linkedUserCount: 2,
    linkedActiveUserCount: 2,
    linkedAdminUserCount: 1,
    preprovisionAuditCount: 2,
    ordinaryLinkAuditCount: 0,
  };
  const pipelineEvidence = {
    runMatches: true,
    cutoverStageS1: true,
    cutoverStageS2: false,
    applicationWritesDisabled: true,
    firstApplicationWriteAbsent: true,
    principalFound: true,
    principalRunMatches: true,
    principalActive: true,
    permissionCount: 1,
    publishOnly: true,
    preprovisionAuditCount: 1,
    statusChangeAuditCount: 2,
    statusChangeTransitionsValid: true,
  };
  assert.doesNotThrow(() => assertUserEvidence(userEvidence));
  assert.doesNotThrow(() =>
    assertPipelineEvidence(pipelineEvidence),
  );
  assert.doesNotThrow(() =>
    assertUserEvidence(
      {
        ...userEvidence,
        cutoverStageS1: false,
        cutoverStageS2: true,
      },
      "S2",
    ),
  );
  assert.doesNotThrow(() =>
    assertPipelineEvidence(
      {
        ...pipelineEvidence,
        cutoverStageS1: false,
        cutoverStageS2: true,
      },
      "S2",
    ),
  );
  assert.throws(
    () =>
      assertUserEvidence({
        ...userEvidence,
        ordinaryLinkAuditCount: 1,
      }),
    /evidence is incomplete/u,
  );
  assert.throws(
    () =>
      assertPipelineEvidence({
        ...pipelineEvidence,
        permissionCount: 2,
      }),
    /evidence is incomplete/u,
  );
});
