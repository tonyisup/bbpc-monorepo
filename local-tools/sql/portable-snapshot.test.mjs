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
      "generated_schema.jsonl": "{}\n",
      "users/documents.jsonl":
        '{"_id":"user-1","legacyId":"legacy-1"}\n',
      "auditEvents/documents.jsonl":
        '{"_id":"audit-1","action":"migration.portableScrub.completed"}\n',
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
      "users",
    ]);
    assert.match(inspected.snapshotSha256, /^[a-f0-9]{64}$/u);
    assert.deepEqual(
      comparePortableSnapshots(inspected, inspected),
      {
        matched: true,
        totalRows: 2,
        tables: 2,
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
