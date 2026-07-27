import assert from "node:assert/strict";
import test from "node:test";

import {
  MIGRATION_DOMAINS,
  MIGRATION_RAW_TABLES_BY_DOMAIN,
} from "../../convex/migration/constants.ts";
import {
  executePortableScrub,
  portableCountsFromRawCounts,
} from "./portable-backup-plan.mjs";

function createRawCounts() {
  const counts = Object.fromEntries(
    Object.values(MIGRATION_RAW_TABLES_BY_DOMAIN)
      .flat()
      .map((table) => [table, 0]),
  );
  counts.migrationRawUsers = 19;
  counts.migrationRawRoles = 6;
  counts.migrationRawUserRoles = 15;
  counts.migrationRawArchivePosts = 433;
  return counts;
}

test("maps every raw count to canonical and domain totals", () => {
  const result = portableCountsFromRawCounts(createRawCounts());
  assert.equal(Object.keys(result.canonicalCounts).length, 32);
  assert.equal(result.canonicalCounts.users, 19);
  assert.equal(result.canonicalCounts.archivePosts, 433);
  assert.equal(result.canonicalCounts.sideEffectIntents, 0);
  assert.equal(result.domainRows.identity, 40);
  assert.equal(result.domainRows.archive, 433);
  assert.equal(result.totalRows, 473);
});

test("executes a bounded resumable portable scrub", async () => {
  const { domainRows } = portableCountsFromRawCounts(
    createRawCounts(),
  );
  const calls = [];
  const result = await executePortableScrub({
    runId: "portable-run",
    batchSize: 100,
    domainRows,
    invoke: async (functionName, args) => {
      calls.push({ functionName, args });
      if (functionName.endsWith(":startFinalScrub")) {
        return { status: "running" };
      }
      if (
        functionName.endsWith(
          ":scrubFinalTagAwardArchiveBatch",
        )
      ) {
        return {
          done: true,
          deletedThisBatch: 2,
          totalDeleted: 2,
        };
      }
      if (
        functionName.endsWith(
          ":scrubFinalRawDomainBatch",
        )
      ) {
        return {
          done: true,
          deletedThisBatch: domainRows[args.domain],
          totalDeleted: domainRows[args.domain],
        };
      }
      if (
        functionName.endsWith(
          ":scrubFinalMigrationMetadataBatch",
        )
      ) {
        return {
          done: true,
          deletedThisBatch: 71,
          totalDeleted: 71,
        };
      }
      if (
        functionName.endsWith(
          ":scrubFinalDeploymentControlBatch",
        )
      ) {
        return {
          done: true,
          deletedThisBatch: 0,
          totalDeleted: 0,
        };
      }
      return {
        status: "completed",
        systemStateDeleted: true,
        rawRowsDeleted: { ...domainRows },
      };
    },
  });
  assert.equal(result.systemStateDeleted, true);
  assert.equal(result.tagAwardArchiveIdsRemoved, 2);
  assert.equal(
    calls.filter((call) =>
      call.functionName.endsWith(
        ":scrubFinalRawDomainBatch",
      ),
    ).length,
    MIGRATION_DOMAINS.length,
  );
});

test("fails closed on a raw deletion count mismatch", async () => {
  const { domainRows } = portableCountsFromRawCounts(
    createRawCounts(),
  );
  await assert.rejects(
    executePortableScrub({
      runId: "portable-run",
      batchSize: 100,
      domainRows,
      invoke: async (functionName, args) => {
        if (functionName.endsWith(":startFinalScrub")) {
          return { status: "running" };
        }
        return {
          done: true,
          deletedThisBatch: 0,
          totalDeleted:
            args.domain === "identity"
              ? 0
              : domainRows[args.domain] ?? 0,
        };
      },
    }),
    /count mismatch for identity/u,
  );
});
