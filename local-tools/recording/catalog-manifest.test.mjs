import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import {
  readRecordingCatalogManifest,
  validateRecordingCatalogManifest,
  writeOrVerifyRecordingCatalogManifest,
} from "./catalog-manifest.mjs";

const runId = "recording-catalog-test";
const manifest = {
  formatVersion: 1,
  kind: "recording-catalog-reconciliation",
  runId,
  sourceObservedAt: 1_000,
  digest: `sha256:${"a".repeat(64)}`,
  sounders: 825,
  templates: 3,
  manifestContainsRowValues: false,
};

test("writes and idempotently verifies value-free catalog evidence", () => {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "bbpc-recording-catalog-"),
  );
  try {
    const first = writeOrVerifyRecordingCatalogManifest({
      projectRoot,
      manifest,
    });
    assert.equal(first.created, true);
    assert.equal(
      fs.statSync(first.manifestPath).mode & 0o777,
      0o600,
    );
    assert.deepEqual(
      readRecordingCatalogManifest({
        projectRoot,
        runId,
      }).manifest,
      manifest,
    );
    assert.equal(
      writeOrVerifyRecordingCatalogManifest({
        projectRoot,
        manifest: {
          ...manifest,
          sourceObservedAt: 2_000,
        },
      }).created,
      false,
    );
  } finally {
    fs.rmSync(projectRoot, {
      recursive: true,
      force: true,
    });
  }
});

test("rejects value-bearing, malformed, and conflicting evidence", () => {
  assert.throws(
    () =>
      validateRecordingCatalogManifest(
        {
          ...manifest,
          manifestContainsRowValues: true,
        },
        runId,
      ),
    /manifest is invalid/u,
  );
  assert.throws(
    () =>
      validateRecordingCatalogManifest(
        {
          ...manifest,
          sounders: 1_001,
        },
        runId,
      ),
    /outside its safety bound/u,
  );

  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "bbpc-recording-catalog-"),
  );
  try {
    writeOrVerifyRecordingCatalogManifest({
      projectRoot,
      manifest,
    });
    assert.throws(
      () =>
        writeOrVerifyRecordingCatalogManifest({
          projectRoot,
          manifest: {
            ...manifest,
            digest: `sha256:${"b".repeat(64)}`,
          },
        }),
      /conflicts with the reconciled source/u,
    );
  } finally {
    fs.rmSync(projectRoot, {
      recursive: true,
      force: true,
    });
  }
});
