import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ConvexError } from "convex/values";

import {
  assertInitializedReadiness,
  readPrivateToken,
  verifyAuthenticatedStaging,
} from "./verify-authenticated-staging.mjs";

const apiVersion = "0.1.0";

function domainError(code) {
  return new ConvexError({
    code,
    message: "Synthetic domain failure.",
    retryable: false,
  });
}

test("reads only a private compact JWT file", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "bbpc-staging-token-"),
  );
  const tokenPath = path.join(directory, "token");
  const token =
    "abcdefghijkl.mnopqrstuv.wxyz0123456789";
  try {
    fs.writeFileSync(tokenPath, `${token}\n`, {
      mode: 0o600,
    });
    assert.equal(
      readPrivateToken(tokenPath, "Synthetic token"),
      token,
    );
    fs.chmodSync(tokenPath, 0o644);
    assert.throws(
      () => readPrivateToken(tokenPath, "Synthetic token"),
      /private regular token file/u,
    );
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test("requires initialized write-disabled readiness", () => {
  assert.doesNotThrow(() =>
    assertInitializedReadiness(
      {
        apiVersion,
        initialized: true,
        applicationWritesEnabled: false,
      },
      apiVersion,
    ),
  );
  assert.throws(
    () =>
      assertInitializedReadiness(
        {
          apiVersion,
          initialized: true,
          applicationWritesEnabled: true,
        },
        apiVersion,
      ),
    /initialized, write-disabled/u,
  );
});

test("verifies the complete authenticated staging matrix", async () => {
  const clients = {
    anonymous: {
      async query() {
        return {
          apiVersion,
          initialized: true,
          applicationWritesEnabled: false,
        };
      },
    },
    member: {
      async query() {
        return { id: "member-id" };
      },
      async mutation() {
        throw domainError("WRITE_DISABLED");
      },
    },
    administrator: {
      async query() {
        return { counts: {} };
      },
      async mutation() {
        throw domainError("WRITE_DISABLED");
      },
    },
    pipeline: {
      async query() {
        return { permissions: ["pipeline:publish"] };
      },
      async mutation() {
        throw domainError("WRITE_DISABLED");
      },
    },
    unlinked: {
      async query() {
        throw domainError("IDENTITY_NOT_LINKED");
      },
    },
  };

  assert.deepEqual(
    await verifyAuthenticatedStaging({
      clients,
      apiVersion,
    }),
    {
      readiness: {
        apiVersion,
        initialized: true,
        applicationWritesEnabled: false,
      },
      reads: {
        member: "pass",
        administrator: "pass",
        pipeline: "pass",
      },
      unlinkedDenial: "IDENTITY_NOT_LINKED",
      blockedWrites: {
        member: "WRITE_DISABLED",
        administrator: "WRITE_DISABLED",
        pipeline: "WRITE_DISABLED",
      },
    },
  );
});

test("rejects an overprivileged pipeline result", async () => {
  const clients = {
    anonymous: {
      async query() {
        return {
          apiVersion,
          initialized: true,
          applicationWritesEnabled: false,
        };
      },
    },
    member: {
      async query() {
        return { id: "member-id" };
      },
    },
    administrator: {
      async query() {
        return {};
      },
    },
    pipeline: {
      async query() {
        return {
          permissions: ["pipeline:publish", "admin"],
        };
      },
    },
  };
  await assert.rejects(
    () =>
      verifyAuthenticatedStaging({
        clients,
        apiVersion,
      }),
    /read probes returned invalid results/u,
  );
});
