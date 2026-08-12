import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { tablesForDomain } from "./manifest.mjs";
import {
  buildRehearsalPlan,
  countsFromVerifiedManifests,
  executeRehearsalPlan,
  isRehearsalStepComplete,
  REHEARSAL_DOMAINS,
  shouldStageForResume,
} from "./rehearsal-plan.mjs";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolDirectory, "../..");

function createVerifiedDomains() {
  let rowCount = 1;
  return Object.fromEntries(
    REHEARSAL_DOMAINS.map((domain) => [
      domain,
      {
        files: tablesForDomain(domain).map((table) => ({
          table,
          rowCount: rowCount++,
        })),
      },
    ]),
  );
}

test("builds the complete dependency-ordered rehearsal plan", () => {
  const counts = countsFromVerifiedManifests(
    createVerifiedDomains(),
  );
  const steps = buildRehearsalPlan(counts);
  const operationIds = steps.map((step) => step.operationId);

  assert.equal(Object.keys(counts).length, 31);
  assert.equal(steps.length, 86);
  assert.equal(new Set(operationIds).size, operationIds.length);
  for (const step of steps) {
    const [moduleName, exportName] = step.functionName.split(":");
    assert.equal(typeof moduleName, "string");
    assert.equal(typeof exportName, "string");
    const sourcePath = path.join(
      projectRoot,
      "convex",
      `${moduleName}.ts`,
    );
    const source = fs.readFileSync(sourcePath, "utf8");
    assert.match(
      source,
      new RegExp(`export const ${exportName}\\b`, "u"),
      `${step.functionName} must remain exported`,
    );
    if (step.kind === "batch") {
      assert.equal(step.expectedCount, counts[step.sourceTable]);
    }
  }

  const position = (operationId) => operationIds.indexOf(operationId);
  assert.ok(
    position("assignments.assignments") <
      position("reviews.start"),
  );
  assert.ok(
    position("reviews.reconcile.finish") < position("games.start"),
  );
  assert.ok(
    position("games.points") < position("assignments.pointLinks"),
  );
  assert.ok(
    position("assignments.reconcile.finish") <
      position("games.guesses"),
  );
  assert.ok(
    position("games.reconcile.finish") < position("rankings.start"),
  );
  assert.ok(
    position("rankings.reconcile.finish") <
      position("archive.start"),
  );

  const identityStart = steps.find(
    (step) => step.operationId === "identity.start",
  );
  assert.equal(
    identityStart.args.expectedUsers,
    counts.migrationRawUsers,
  );
  assert.equal(
    identityStart.args.expectedRoles,
    counts.migrationRawRoles,
  );
  assert.equal(
    identityStart.args.expectedUserRoles,
    counts.migrationRawUserRoles,
  );
});

test("rejects incomplete and duplicate manifest count input", () => {
  const missing = createVerifiedDomains();
  delete missing.archive;
  assert.throws(
    () => countsFromVerifiedManifests(missing),
    /Missing verified archive manifest/u,
  );

  const duplicate = createVerifiedDomains();
  duplicate.catalog.files[0] = {
    ...duplicate.catalog.files[0],
    table: duplicate.identity.files[0].table,
  };
  assert.throws(
    () => countsFromVerifiedManifests(duplicate),
    /duplicate rehearsal count/u,
  );
});

test("executes once and batch steps with bounded retries", async () => {
  const calls = [];
  const progress = [];
  const steps = [
    {
      kind: "once",
      label: "Start",
      functionName: "migration/test:start",
      operationId: "test.start",
      args: { expectedRows: 3 },
    },
    {
      kind: "batch",
      label: "Rows",
      functionName: "migration/test:rows",
      operationId: "test.rows",
      sourceTable: "migrationRawTest",
      expectedCount: 3,
    },
  ];
  let batchAttempt = 0;

  await executeRehearsalPlan({
    steps,
    runId: "synthetic-run",
    batchSize: 2,
    invoke: async (step, args) => {
      calls.push({ step, args });
      if (step.kind === "once") {
        return { status: "running" };
      }
      batchAttempt += 1;
      return {
        status: batchAttempt === 1 ? "running" : "completed",
      };
    },
    onProgress: (step, result) => {
      progress.push({ step, result });
    },
  });

  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].args, {
    cutoverRunId: "synthetic-run",
    operationId: "test.start",
    expectedRows: 3,
  });
  assert.deepEqual(calls[1].args, {
    cutoverRunId: "synthetic-run",
    operationId: "test.rows",
    batchSize: 2,
  });
  assert.equal(progress[1].result.attempts, 2);
});

test("uses persisted domain and checkpoint progress when resuming", async () => {
  const counts = countsFromVerifiedManifests(
    createVerifiedDomains(),
  );
  const steps = buildRehearsalPlan(counts);
  const progress = {
    domainStatuses: {
      identity: "reconciled",
      catalog: "transformed",
      episodes: "running",
    },
    checkpointStatuses: {
      "episodes.episodes": "completed",
    },
  };
  const step = (operationId) =>
    steps.find((candidate) => candidate.operationId === operationId);

  assert.equal(
    isRehearsalStepComplete(step("identity.start"), progress),
    true,
  );
  assert.equal(
    isRehearsalStepComplete(step("identity.users"), progress),
    false,
  );
  assert.equal(
    isRehearsalStepComplete(step("identity.finish"), progress),
    true,
  );
  assert.equal(
    isRehearsalStepComplete(
      step("identity.reconcile.finish"),
      progress,
    ),
    true,
  );
  assert.equal(
    isRehearsalStepComplete(step("catalog.finish"), progress),
    true,
  );
  assert.equal(
    isRehearsalStepComplete(step("episodes.episodes"), progress),
    true,
  );
  assert.equal(
    isRehearsalStepComplete(step("episodes.links"), progress),
    false,
  );
  assert.throws(
    () =>
      isRehearsalStepComplete(step("games.start"), {
        domainStatuses: { games: "failed" },
        checkpointStatuses: {},
      }),
    /domain is failed/u,
  );

  const invoked = [];
  await executeRehearsalPlan({
    steps: [
      step("identity.start"),
      step("catalog.start"),
    ],
    runId: "synthetic-run",
    batchSize: 2,
    isComplete: async (candidate) =>
      isRehearsalStepComplete(candidate, progress),
    invoke: async (candidate) => {
      invoked.push(candidate.operationId);
      return { status: "running" };
    },
  });
  assert.deepEqual(invoked, []);
});

test("rejects invalid checkpoints and retry exhaustion", async () => {
  const batchStep = {
    kind: "batch",
    label: "Rows",
    functionName: "migration/test:rows",
    operationId: "test.rows",
    sourceTable: "migrationRawTest",
    expectedCount: 0,
  };
  await assert.rejects(
    executeRehearsalPlan({
      steps: [batchStep],
      runId: "synthetic-run",
      batchSize: 1,
      invoke: async () => ({ status: "unexpected" }),
    }),
    /invalid checkpoint/u,
  );
  await assert.rejects(
    executeRehearsalPlan({
      steps: [batchStep],
      runId: "synthetic-run",
      batchSize: 1,
      invoke: async () => ({ status: "running" }),
    }),
    /retry budget/u,
  );
  await assert.rejects(
    executeRehearsalPlan({
      steps: [batchStep],
      runId: "../unsafe",
      batchSize: 1,
      invoke: async () => ({ status: "completed" }),
    }),
    /safe rehearsal run ID/u,
  );
  await assert.rejects(
    executeRehearsalPlan({
      steps: [batchStep],
      runId: "synthetic-run",
      batchSize: 0,
      invoke: async () => ({ status: "completed" }),
    }),
    /batch size/u,
  );
});

test("replaces staging only before migration progress exists", () => {
  assert.equal(
    shouldStageForResume({
      domainStatuses: {},
      checkpointStatuses: {},
    }),
    true,
  );
  assert.equal(
    shouldStageForResume({
      domainStatuses: { identity: "running" },
      checkpointStatuses: {},
    }),
    false,
  );
  assert.equal(
    shouldStageForResume({
      domainStatuses: {},
      checkpointStatuses: {
        "identity.users": "running",
      },
    }),
    false,
  );
  assert.throws(
    () => shouldStageForResume({}),
    /Invalid local rehearsal progress/u,
  );
});
