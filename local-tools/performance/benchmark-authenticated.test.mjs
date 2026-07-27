import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  normalizeIdentity,
  readLocalConfig,
  readPrivateJson,
} from "./benchmark-authenticated.mjs";

function privateJson(directory, name, value, mode = 0o600) {
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`, { mode });
  fs.chmodSync(filePath, mode);
  return filePath;
}

test("reads only private JSON files", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "bbpc-performance-private-"),
  );
  try {
    const privatePath = privateJson(directory, "private.json", {
      safe: true,
    });
    assert.deepEqual(readPrivateJson(privatePath, "Fixture"), {
      safe: true,
    });
    const publicPath = privateJson(
      directory,
      "public.json",
      { safe: false },
      0o644,
    );
    assert.throws(
      () => readPrivateJson(publicPath, "Fixture"),
      /group or other permissions/u,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("normalizes the minimal Convex fake identity contract", () => {
  assert.deepEqual(
    normalizeIdentity(
      {
        issuer: "https://issuer.example.test",
        subject: "member",
        tokenIdentifier: "https://issuer.example.test|member",
      },
      "Fixture",
    ),
    {
      issuer: "https://issuer.example.test",
      subject: "member",
      tokenIdentifier: "https://issuer.example.test|member",
    },
  );
  assert.throws(
    () =>
      normalizeIdentity(
        {
          issuer: "https://issuer.example.test",
          subject: "member",
          tokenIdentifier: "different",
        },
        "Fixture",
      ),
    /issuer\|subject/u,
  );
  assert.throws(
    () =>
      normalizeIdentity(
        {
          issuer: "https://issuer.example.test",
          subject: "member",
          tokenIdentifier: "https://issuer.example.test|member",
          token: "must-not-be-accepted",
        },
        "Fixture",
      ),
    /may contain only/u,
  );
});

test("reads the local port and admin key without returning other config", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "bbpc-performance-config-"),
  );
  try {
    const configPath = privateJson(directory, "config.json", {
      adminKey: "local-admin-key",
      instanceSecret: "must-not-be-returned",
      ports: { cloud: 3210, site: 3211 },
    });
    assert.deepEqual(readLocalConfig(configPath), {
      adminKey: "local-admin-key",
      cloudPort: 3210,
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
