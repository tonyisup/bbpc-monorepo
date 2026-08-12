import assert from "node:assert/strict";
import test from "node:test";

import {
  serializeJsonLines,
  sha256,
  transformRoleRow,
  transformUserRoleRow,
  transformUserRow,
} from "./identity-rows.mjs";

const RUN_ID = "synthetic-run-001";

test("transforms identity rows without staging retired fields", () => {
  const user = transformUserRow(RUN_ID, {
    id: "legacy-user",
    name: "Synthetic User",
    email: "user@example.test",
    emailVerified: new Date("2024-01-02T03:04:05.000Z"),
    image: null,
    impersonatedUserId: "retired-user",
  });
  assert.deepEqual(user, {
    runId: RUN_ID,
    legacyId: "legacy-user",
    name: "Synthetic User",
    email: "user@example.test",
    emailVerifiedAt: 1_704_164_645_000,
    sourceRowHash:
      "sha256:817faf0a50fe4c1df6ace2162580e5391fb1d7c6bfe5afa3199c5838aa2d7ae8",
  });
  assert.equal("impersonatedUserId" in user, false);
});

test("normalizes UUIDs and preserves SQL identity types", () => {
  const role = transformRoleRow(RUN_ID, {
    id: 7,
    name: "Host",
    description: "Synthetic host",
    admin: false,
  });
  const link = transformUserRoleRow(RUN_ID, {
    id: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
    userId: "legacy-user",
    roleId: 7,
  });

  assert.equal(role.legacyId, 7);
  assert.equal(link.legacyId, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  assert.equal(link.roleLegacyId, 7);
});

test("serializes deterministic newline-delimited JSON", () => {
  const first = transformUserRow(RUN_ID, {
    id: "user-1",
    name: null,
    email: null,
    emailVerified: null,
    image: null,
  });
  const second = transformRoleRow(RUN_ID, {
    id: 1,
    name: "Member",
    description: "Synthetic member",
    admin: false,
  });
  const jsonl = serializeJsonLines([first, second]);

  assert.equal(jsonl.endsWith("\n"), true);
  assert.equal(jsonl.trimEnd().split("\n").length, 2);
  assert.equal(sha256(jsonl).length, 64);
});

test("rejects malformed source rows", () => {
  assert.throws(
    () =>
      transformUserRow(RUN_ID, {
        id: "",
        name: null,
        email: null,
        emailVerified: null,
        image: null,
      }),
    /User\.id/u,
  );
  assert.throws(
    () =>
      transformRoleRow(RUN_ID, {
        id: 256,
        name: "Invalid",
        description: "Invalid",
        admin: false,
      }),
    /tinyint/u,
  );
  assert.throws(
    () =>
      transformUserRoleRow(RUN_ID, {
        id: "not-a-uuid",
        userId: "legacy-user",
        roleId: 1,
      }),
    /UUID/u,
  );
});
