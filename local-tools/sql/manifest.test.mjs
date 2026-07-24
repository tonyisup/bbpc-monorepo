import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPECTED_SOURCE_FINGERPRINT,
  tablesForDomain,
  verifyDomainManifest,
} from "./manifest.mjs";

const RUN_ID = "synthetic-manifest-run";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function withSourceHash(record) {
  return {
    runId: RUN_ID,
    ...record,
    sourceRowHash: `sha256:${sha256(JSON.stringify(record))}`,
  };
}

function createIdentityFixture() {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "bbpc-manifest-"),
  );
  fs.chmodSync(projectRoot, 0o700);
  const runDirectory = path.join(
    projectRoot,
    ".local-migration",
    RUN_ID,
  );
  const domainDirectory = path.join(runDirectory, "identity");
  fs.mkdirSync(domainDirectory, {
    recursive: true,
    mode: 0o700,
  });
  fs.chmodSync(path.join(projectRoot, ".local-migration"), 0o700);
  fs.chmodSync(runDirectory, 0o700);
  fs.chmodSync(domainDirectory, 0o700);
  const rows = {
    migrationRawUsers: [
      withSourceHash({
        legacyId: "user-1",
        email: "synthetic@example.test",
      }),
    ],
    migrationRawRoles: [
      withSourceHash({
        legacyId: 1,
        name: "Member",
        description: "Synthetic member",
        admin: false,
      }),
    ],
    migrationRawUserRoles: [
      withSourceHash({
        legacyId: "00000000-0000-0000-0000-000000000001",
        userLegacyId: "user-1",
        roleLegacyId: 1,
      }),
    ],
  };
  const files = Object.entries(rows).map(([table, records]) => {
    const contents = `${records
      .map((record) => JSON.stringify(record))
      .join("\n")}\n`;
    const fileName = `${table}.jsonl`;
    fs.writeFileSync(
      path.join(domainDirectory, fileName),
      contents,
      { mode: 0o600 },
    );
    return {
      table,
      fileName,
      rowCount: records.length,
      sha256: sha256(contents),
    };
  });
  const manifest = {
    formatVersion: 1,
    domain: "identity",
    generatedAt: "2026-07-23T00:00:00.000Z",
    runId: RUN_ID,
    sourceDatabase: "dev",
    sourceSchemaFingerprint: EXPECTED_SOURCE_FINGERPRINT,
    sourceServerFingerprint: "a".repeat(64),
    censusGeneratedAt: "2026-07-22T23:59:00.000Z",
    containsProductionDerivedRowValues: true,
    localOnly: true,
    retiredTablesExtracted: [],
    files,
  };
  fs.writeFileSync(
    path.join(domainDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 },
  );
  return {
    projectRoot,
    domainDirectory,
    manifest,
    cleanup() {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    },
  };
}

test("verifies a private immutable domain manifest", () => {
  const fixture = createIdentityFixture();
  try {
    const verified = verifyDomainManifest({
      projectRoot: fixture.projectRoot,
      runId: RUN_ID,
      domain: "identity",
    });
    assert.equal(verified.runId, RUN_ID);
    assert.deepEqual(
      verified.files.map((file) => file.table),
      tablesForDomain("identity"),
    );
    assert.equal(
      verified.files.reduce(
        (count, file) => count + file.rowCount,
        0,
      ),
      3,
    );
    assert.deepEqual(tablesForDomain("assignments"), [
      "migrationRawAssignments",
      "migrationRawAssignmentAudioMessages",
      "migrationRawAssignmentPointLinks",
      "migrationRawSyllabusEntries",
    ]);
    assert.deepEqual(tablesForDomain("reviews"), [
      "migrationRawRatings",
      "migrationRawReviews",
      "migrationRawAssignmentReviews",
      "migrationRawExtraReviews",
    ]);
    assert.deepEqual(tablesForDomain("games"), [
      "migrationRawGameTypes",
      "migrationRawGamePointTypes",
      "migrationRawSeasons",
      "migrationRawPoints",
      "migrationRawGuesses",
      "migrationRawGamblingTypes",
      "migrationRawGamblingEntries",
      "migrationRawTagVotes",
      "migrationRawQuoteSubmissions",
    ]);
    assert.deepEqual(tablesForDomain("rankings"), [
      "migrationRawRankedListTypes",
      "migrationRawRankedLists",
      "migrationRawRankedItems",
    ]);
  } finally {
    fixture.cleanup();
  }
});

test("rejects checksum and source-row-hash drift", () => {
  const checksumFixture = createIdentityFixture();
  try {
    fs.appendFileSync(
      path.join(
        checksumFixture.domainDirectory,
        "migrationRawUsers.jsonl",
      ),
      "\n",
    );
    assert.throws(
      () =>
        verifyDomainManifest({
          projectRoot: checksumFixture.projectRoot,
          runId: RUN_ID,
          domain: "identity",
        }),
      /checksum/u,
    );
  } finally {
    checksumFixture.cleanup();
  }

  const rowHashFixture = createIdentityFixture();
  try {
    const filePath = path.join(
      rowHashFixture.domainDirectory,
      "migrationRawUsers.jsonl",
    );
    const record = JSON.parse(
      fs.readFileSync(filePath, "utf8").trim(),
    );
    record.sourceRowHash = `sha256:${"0".repeat(64)}`;
    const contents = `${JSON.stringify(record)}\n`;
    fs.writeFileSync(filePath, contents, { mode: 0o600 });
    rowHashFixture.manifest.files.find(
      (file) => file.table === "migrationRawUsers",
    ).sha256 = sha256(contents);
    fs.writeFileSync(
      path.join(rowHashFixture.domainDirectory, "manifest.json"),
      `${JSON.stringify(rowHashFixture.manifest, null, 2)}\n`,
      { mode: 0o600 },
    );
    assert.throws(
      () =>
        verifyDomainManifest({
          projectRoot: rowHashFixture.projectRoot,
          runId: RUN_ID,
          domain: "identity",
        }),
      /source row hash/u,
    );
  } finally {
    rowHashFixture.cleanup();
  }
});

test("rejects forbidden fields and duplicate legacy IDs", () => {
  const forbiddenFixture = createIdentityFixture();
  try {
    const filePath = path.join(
      forbiddenFixture.domainDirectory,
      "migrationRawUsers.jsonl",
    );
    const record = JSON.parse(
      fs.readFileSync(filePath, "utf8").trim(),
    );
    record.providerToken = "must-not-stage";
    const contents = `${JSON.stringify(record)}\n`;
    fs.writeFileSync(filePath, contents, { mode: 0o600 });
    forbiddenFixture.manifest.files.find(
      (file) => file.table === "migrationRawUsers",
    ).sha256 = sha256(contents);
    fs.writeFileSync(
      path.join(forbiddenFixture.domainDirectory, "manifest.json"),
      `${JSON.stringify(forbiddenFixture.manifest, null, 2)}\n`,
      { mode: 0o600 },
    );
    assert.throws(
      () =>
        verifyDomainManifest({
          projectRoot: forbiddenFixture.projectRoot,
          runId: RUN_ID,
          domain: "identity",
        }),
      /forbidden field/u,
    );
  } finally {
    forbiddenFixture.cleanup();
  }

  const duplicateFixture = createIdentityFixture();
  try {
    const filePath = path.join(
      duplicateFixture.domainDirectory,
      "migrationRawUsers.jsonl",
    );
    const record = fs.readFileSync(filePath, "utf8").trim();
    const contents = `${record}\n${record}\n`;
    fs.writeFileSync(filePath, contents, { mode: 0o600 });
    const entry = duplicateFixture.manifest.files.find(
      (file) => file.table === "migrationRawUsers",
    );
    entry.rowCount = 2;
    entry.sha256 = sha256(contents);
    fs.writeFileSync(
      path.join(duplicateFixture.domainDirectory, "manifest.json"),
      `${JSON.stringify(duplicateFixture.manifest, null, 2)}\n`,
      { mode: 0o600 },
    );
    assert.throws(
      () =>
        verifyDomainManifest({
          projectRoot: duplicateFixture.projectRoot,
          runId: RUN_ID,
          domain: "identity",
        }),
      /duplicate legacy ID/u,
    );
  } finally {
    duplicateFixture.cleanup();
  }
});

test("rejects unsafe permissions and domain table drift", () => {
  const permissionsFixture = createIdentityFixture();
  try {
    fs.chmodSync(
      path.join(
        permissionsFixture.domainDirectory,
        "migrationRawUsers.jsonl",
      ),
      0o644,
    );
    assert.throws(
      () =>
        verifyDomainManifest({
          projectRoot: permissionsFixture.projectRoot,
          runId: RUN_ID,
          domain: "identity",
        }),
      /permissions/u,
    );
  } finally {
    permissionsFixture.cleanup();
  }

  const tablesFixture = createIdentityFixture();
  try {
    tablesFixture.manifest.files.pop();
    fs.writeFileSync(
      path.join(tablesFixture.domainDirectory, "manifest.json"),
      `${JSON.stringify(tablesFixture.manifest, null, 2)}\n`,
      { mode: 0o600 },
    );
    assert.throws(
      () =>
        verifyDomainManifest({
          projectRoot: tablesFixture.projectRoot,
          runId: RUN_ID,
          domain: "identity",
        }),
      /allowlist/u,
    );
    assert.throws(
      () => tablesForDomain("unknown"),
      /Unsupported/u,
    );
  } finally {
    tablesFixture.cleanup();
  }
});
