import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRecordingSourceArchiveManifest,
  recordingSourceArchivePaths,
  validateRecordingSourceArchiveManifest,
  validateRecordingSourceRestoreManifest,
  validateRecordingSourceTarget,
  writeOrVerifyRecordingSourceArchiveManifest,
  writeOrVerifyRecordingSourceRestoreManifest,
} from "./source-archive.mjs";

const runId = "recording-archive-test";
const source = validateRecordingSourceTarget({
  sourceUrl: "https://old-recording-123.convex.cloud",
  deployment: "dev:old-recording-123",
});
const snapshot = {
  snapshotSha256: "a".repeat(64),
  totalRows: 3,
  tables: {
    sessions: {
      rows: 1,
      sha256: "b".repeat(64),
    },
    sessionInvites: {
      rows: 1,
      sha256: "c".repeat(64),
    },
    participants: {
      rows: 1,
      sha256: "d".repeat(64),
    },
  },
};
const manifest = buildRecordingSourceArchiveManifest({
  runId,
  createdAt: "2026-07-27T00:00:00.000Z",
  sourceFingerprint: source.sourceFingerprint,
  sourceCommit: "e".repeat(40),
  snapshot,
});

test("validates an exact remote recording source without retaining its URL", () => {
  assert.equal(source.deploymentName, "old-recording-123");
  assert.match(source.sourceFingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(
    Object.hasOwn(manifest, "sourceUrl"),
    false,
  );
  assert.throws(
    () =>
      validateRecordingSourceTarget({
        sourceUrl: "http://127.0.0.1:3210",
        deployment: "dev:old-recording-123",
      }),
    /does not match its Convex cloud URL/u,
  );
  assert.throws(
    () =>
      validateRecordingSourceTarget({
        sourceUrl:
          "https://different-recording-123.convex.cloud",
        deployment: "dev:old-recording-123",
      }),
    /does not match its Convex cloud URL/u,
  );
});

test("writes immutable aggregate-only source archive evidence", () => {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "bbpc-recording-archive-"),
  );
  try {
    const paths = recordingSourceArchivePaths({
      projectRoot,
      runId,
    });
    fs.mkdirSync(paths.archiveDirectory, {
      recursive: true,
      mode: 0o700,
    });
    const first =
      writeOrVerifyRecordingSourceArchiveManifest({
        manifestPath: paths.manifestPath,
        manifest,
      });
    assert.equal(first.created, true);
    assert.equal(
      fs.statSync(paths.manifestPath).mode & 0o777,
      0o600,
    );
    assert.equal(
      writeOrVerifyRecordingSourceArchiveManifest({
        manifestPath: paths.manifestPath,
        manifest: {
          ...manifest,
          createdAt: "2026-07-28T00:00:00.000Z",
        },
      }).created,
      false,
    );
    assert.throws(
      () =>
        writeOrVerifyRecordingSourceArchiveManifest({
          manifestPath: paths.manifestPath,
          manifest: {
            ...manifest,
            snapshotSha256: "f".repeat(64),
          },
        }),
      /conflicts with the snapshot/u,
    );
  } finally {
    fs.rmSync(projectRoot, {
      recursive: true,
      force: true,
    });
  }
});

test("rejects archives without plaintext-capability warnings or exact counts", () => {
  assert.throws(
    () =>
      validateRecordingSourceArchiveManifest(
        {
          ...manifest,
          plaintextCapabilitiesPresent: false,
        },
        runId,
      ),
    /manifest is invalid/u,
  );
  assert.throws(
    () =>
      validateRecordingSourceArchiveManifest(
        {
          ...manifest,
          snapshotRows: 4,
        },
        runId,
      ),
    /manifest is inconsistent/u,
  );
});

test("validates immutable aggregate-only disposable restore evidence", () => {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "bbpc-recording-restore-"),
  );
  try {
    const paths = recordingSourceArchivePaths({
      projectRoot,
      runId,
    });
    fs.mkdirSync(paths.archiveDirectory, {
      recursive: true,
      mode: 0o700,
    });
    const restoreManifest = {
      formatVersion: 1,
      kind: "recording-source-disposable-restore",
      runId,
      validatedAt: "2026-07-27T01:00:00.000Z",
      sourceSnapshotSha256: "a".repeat(64),
      restoredSnapshotSha256: "f".repeat(64),
      tableHashesMatched: true,
      disposableRestoreDeleted: true,
      manifestContainsRowValues: false,
      totalRows: 3,
      tables: 3,
    };
    assert.deepEqual(
      validateRecordingSourceRestoreManifest(
        restoreManifest,
        runId,
      ),
      restoreManifest,
    );
    assert.equal(
      writeOrVerifyRecordingSourceRestoreManifest({
        manifestPath: paths.restoreManifestPath,
        manifest: restoreManifest,
      }).created,
      true,
    );
    assert.equal(
      writeOrVerifyRecordingSourceRestoreManifest({
        manifestPath: paths.restoreManifestPath,
        manifest: {
          ...restoreManifest,
          validatedAt: "2026-07-28T01:00:00.000Z",
        },
      }).created,
      false,
    );
    assert.throws(
      () =>
        validateRecordingSourceRestoreManifest(
          {
            ...restoreManifest,
            disposableRestoreDeleted: false,
          },
          runId,
        ),
      /restore manifest is invalid/u,
    );
  } finally {
    fs.rmSync(projectRoot, {
      recursive: true,
      force: true,
    });
  }
});
