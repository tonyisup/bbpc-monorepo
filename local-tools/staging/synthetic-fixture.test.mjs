import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildSyntheticFixture,
  syntheticFixtureFileNames,
  verifySyntheticFixture,
  writeSyntheticFixture,
} from "./synthetic-fixture.mjs";

const identities = {
  adminIdentity: {
    issuer: "https://synthetic.clerk.accounts.dev",
    subject: "user_staging_admin",
    tokenIdentifier:
      "https://synthetic.clerk.accounts.dev|user_staging_admin",
  },
  memberIdentity: {
    issuer: "https://synthetic.clerk.accounts.dev",
    subject: "user_staging_member",
    tokenIdentifier:
      "https://synthetic.clerk.accounts.dev|user_staging_member",
  },
  pipelineIdentity: {
    issuer: "https://synthetic.clerk.accounts.dev",
    subject: "mch_staging_pipeline",
    tokenIdentifier:
      "https://synthetic.clerk.accounts.dev|mch_staging_pipeline",
  },
};

function createTemporaryDirectory() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "bbpc-staging-fixture-"),
  );
  fs.chmodSync(directory, 0o700);
  return directory;
}

test("builds a deterministic production-data-free fixture", () => {
  const first = buildSyntheticFixture({
    runId: "staging-acceptance-001",
    ...identities,
  });
  const second = buildSyntheticFixture({
    runId: "staging-acceptance-001",
    ...identities,
  });

  assert.deepEqual(first, second);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(first.manifest.tables).map(
        ([table, evidence]) => [table, evidence.rowCount],
      ),
    ),
    {
      migrationRawUsers: 2,
      migrationRawRoles: 1,
      migrationRawUserRoles: 1,
    },
  );
  assert.deepEqual(first.manifest.safety, {
    syntheticOnly: true,
    containsProductionRows: false,
    containsCredentials: false,
    containsTokens: false,
    containsIdentityClaims: true,
    cloudDestination: "staging-only",
  });
  assert.match(
    first.tables.migrationRawUsers,
    /staging-admin@example\.invalid/u,
  );
  assert.doesNotMatch(
    first.tables.migrationRawUsers,
    /user_staging_admin/u,
  );
});

test("requires three distinct minimal identities", () => {
  assert.throws(
    () =>
      buildSyntheticFixture({
        runId: "staging-acceptance-001",
        ...identities,
        memberIdentity: identities.adminIdentity,
      }),
    /must be distinct/u,
  );
  assert.throws(
    () =>
      buildSyntheticFixture({
        runId: "staging-acceptance-001",
        ...identities,
        adminIdentity: {
          ...identities.adminIdentity,
          secret: "forbidden",
        },
      }),
    /may contain only/u,
  );
});

test("writes and verifies an exact private fixture bundle", () => {
  const directory = createTemporaryDirectory();
  try {
    const result = writeSyntheticFixture({
      outputDirectory: directory,
      runId: "staging-acceptance-001",
      ...identities,
    });
    assert.equal(result.manifest.runId, "staging-acceptance-001");
    assert.deepEqual(
      fs.readdirSync(directory).sort(),
      Object.values(syntheticFixtureFileNames).sort(),
    );
    for (const fileName of fs.readdirSync(directory)) {
      assert.equal(
        fs.statSync(path.join(directory, fileName)).mode & 0o777,
        0o600,
      );
    }
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    assert.doesNotThrow(() => verifySyntheticFixture(directory));
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test("rejects tampering, loose permissions, and unexpected files", () => {
  const directory = createTemporaryDirectory();
  try {
    writeSyntheticFixture({
      outputDirectory: directory,
      runId: "staging-acceptance-001",
      ...identities,
    });
    const usersPath = path.join(
      directory,
      syntheticFixtureFileNames.migrationRawUsers,
    );
    fs.appendFileSync(usersPath, "{}\n");
    assert.throws(
      () => verifySyntheticFixture(directory),
      /does not match/u,
    );

    writeSyntheticFixture({
      outputDirectory: directory,
      runId: "staging-acceptance-001",
      ...identities,
    });
    fs.chmodSync(usersPath, 0o644);
    assert.throws(
      () => verifySyntheticFixture(directory),
      /must not grant/u,
    );

    fs.chmodSync(usersPath, 0o600);
    fs.writeFileSync(path.join(directory, "unexpected.txt"), "");
    assert.throws(
      () => verifySyntheticFixture(directory),
      /allowlist does not match/u,
    );
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});
