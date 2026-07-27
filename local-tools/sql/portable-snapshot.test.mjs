import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  comparePortableSnapshots,
  inspectPortableSnapshot,
} from "./portable-snapshot.mjs";

function createZip(root, name, entries) {
  for (const [relativePath, contents] of Object.entries(entries)) {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), {
      recursive: true,
      mode: 0o700,
    });
    fs.writeFileSync(filePath, contents, {
      encoding: "utf8",
      mode: 0o600,
    });
  }
  const snapshotPath = path.join(root, name);
  const result = spawnSync(
    "/usr/bin/zip",
    [
      "-q",
      "-r",
      snapshotPath,
      ...Object.keys(entries).map(
        (entry) => entry.split("/")[0],
      ),
    ],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0);
  return snapshotPath;
}

test("inspects an allowlisted snapshot without exposing rows", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "bbpc-portable-snapshot-"),
  );
  try {
    const snapshotPath = createZip(root, "portable.zip", {
      "README.md": "Convex snapshot metadata\n",
      "_tables/documents.jsonl": '{"name":"users"}\n',
      "_tables/generated_schema.jsonl": "{}\n",
      "users/documents.jsonl":
        '{"_id":"user-1","legacyId":"legacy-1"}\n',
      "users/generated_schema.jsonl": "{}\n",
      "auditEvents/documents.jsonl":
        '{"_id":"audit-1","action":"migration.portableScrub.completed"}\n',
      "auditEvents/generated_schema.jsonl": "{}\n",
      "bangers/documents.jsonl": "",
      "bangers/generated_schema.jsonl": "{}\n",
    });
    const inspected = inspectPortableSnapshot({
      snapshotPath,
      allowedTables: ["users", "auditEvents", "bangers"],
      expectedCounts: {
        users: 1,
        bangers: 0,
      },
    });
    assert.equal(inspected.totalRows, 2);
    assert.deepEqual(Object.keys(inspected.tables), [
      "auditEvents",
      "bangers",
      "users",
    ]);
    assert.match(inspected.snapshotSha256, /^[a-f0-9]{64}$/u);
    assert.deepEqual(
      comparePortableSnapshots(inspected, inspected),
      {
        matched: true,
        totalRows: 2,
        tables: 3,
      },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects unexpected tables and count drift", () => {
  const unexpectedRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "bbpc-portable-unexpected-"),
  );
  const countRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "bbpc-portable-count-"),
  );
  try {
    const unexpected = createZip(
      unexpectedRoot,
      "unexpected.zip",
      {
        "generated_schema.jsonl": "{}\n",
        "systemState/documents.jsonl":
          '{"_id":"state-1"}\n',
      },
    );
    assert.throws(
      () =>
        inspectPortableSnapshot({
          snapshotPath: unexpected,
          allowedTables: ["users"],
        }),
      /unexpected table systemState/u,
    );

    const countDrift = createZip(countRoot, "count.zip", {
      "generated_schema.jsonl": "{}\n",
      "users/documents.jsonl": '{"_id":"user-1"}\n',
    });
    assert.throws(
      () =>
        inspectPortableSnapshot({
          snapshotPath: countDrift,
          allowedTables: ["users"],
          expectedCounts: { users: 2 },
        }),
      /count mismatch for users/u,
    );
  } finally {
    fs.rmSync(unexpectedRoot, {
      recursive: true,
      force: true,
    });
    fs.rmSync(countRoot, { recursive: true, force: true });
  }
});

test("allows only the top-level Convex README metadata entry", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "bbpc-portable-readme-"),
  );
  try {
    const nestedReadme = createZip(
      root,
      "nested-readme.zip",
      {
        "generated_schema.jsonl": "{}\n",
        "metadata/README.md": "unexpected\n",
      },
    );
    assert.throws(
      () =>
        inspectPortableSnapshot({
          snapshotPath: nestedReadme,
          allowedTables: ["users"],
        }),
      /unexpected table metadata/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("allows only the exact Convex metadata table", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "bbpc-portable-metadata-"),
  );
  try {
    const unexpectedMetadata = createZip(
      root,
      "unexpected-metadata.zip",
      {
        "generated_schema.jsonl": "{}\n",
        "_storage/documents.jsonl": '{"_id":"storage-1"}\n',
      },
    );
    assert.throws(
      () =>
        inspectPortableSnapshot({
          snapshotPath: unexpectedMetadata,
          allowedTables: ["users"],
        }),
      /unexpected table _storage/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("requires per-table schemas when no legacy top-level schema exists", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "bbpc-portable-schema-"),
  );
  try {
    const missingSchema = createZip(
      root,
      "missing-schema.zip",
      {
        "users/documents.jsonl": '{"_id":"user-1"}\n',
        "auditEvents/generated_schema.jsonl": "{}\n",
      },
    );
    assert.throws(
      () =>
        inspectPortableSnapshot({
          snapshotPath: missingSchema,
          allowedTables: ["users", "auditEvents"],
        }),
      /missing generated schema for users/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("permits exact scrubbed tables only when their document files are empty", () => {
  const emptyRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "bbpc-portable-empty-"),
  );
  const nonemptyRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "bbpc-portable-nonempty-"),
  );
  const missingRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "bbpc-portable-missing-empty-"),
  );
  try {
    const empty = createZip(emptyRoot, "empty.zip", {
      "generated_schema.jsonl": "{}\n",
      "users/documents.jsonl": '{"_id":"user-1"}\n',
      "migrationRawUsers/documents.jsonl": "",
    });
    const inspected = inspectPortableSnapshot({
      snapshotPath: empty,
      allowedTables: ["users"],
      allowedEmptyTables: ["migrationRawUsers"],
      expectedCounts: { users: 1 },
    });
    assert.deepEqual(Object.keys(inspected.tables), ["users"]);
    assert.equal(inspected.totalRows, 1);

    const nonempty = createZip(
      nonemptyRoot,
      "nonempty.zip",
      {
        "generated_schema.jsonl": "{}\n",
        "migrationRawUsers/documents.jsonl":
          '{"_id":"raw-user-1"}\n',
      },
    );
    assert.throws(
      () =>
        inspectPortableSnapshot({
          snapshotPath: nonempty,
          allowedTables: ["users"],
          allowedEmptyTables: ["migrationRawUsers"],
        }),
      /required-empty table migrationRawUsers contains documents/u,
    );

    const missing = createZip(
      missingRoot,
      "missing-empty.zip",
      {
        "generated_schema.jsonl": "{}\n",
        "users/documents.jsonl": '{"_id":"user-1"}\n',
      },
    );
    assert.throws(
      () =>
        inspectPortableSnapshot({
          snapshotPath: missing,
          allowedTables: ["users"],
          allowedEmptyTables: ["migrationRawUsers"],
        }),
      /missing required-empty table migrationRawUsers/u,
    );
  } finally {
    fs.rmSync(emptyRoot, { recursive: true, force: true });
    fs.rmSync(nonemptyRoot, {
      recursive: true,
      force: true,
    });
    fs.rmSync(missingRoot, {
      recursive: true,
      force: true,
    });
  }
});

test("requires expected zero-row portable tables to be present", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "bbpc-portable-missing-expected-"),
  );
  try {
    const snapshotPath = createZip(root, "missing.zip", {
      "generated_schema.jsonl": "{}\n",
    });
    assert.throws(
      () =>
        inspectPortableSnapshot({
          snapshotPath,
          allowedTables: ["sideEffectIntents"],
          expectedCounts: { sideEffectIntents: 0 },
        }),
      /missing expected table sideEffectIntents/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
