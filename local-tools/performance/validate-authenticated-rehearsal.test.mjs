import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveHumanProfiles,
  normalizePipelineProbe,
} from "./validate-authenticated-rehearsal.mjs";

const issuer = "https://issuer.example.test";

test("derives one administrator and one ordinary member", () => {
  const profiles = deriveHumanProfiles({
    authIdentities: [
      {
        userId: "user-admin",
        issuer,
        subject: "admin",
        tokenIdentifier: `${issuer}|admin`,
        verifiedEmail: "admin@example.test",
      },
      {
        userId: "user-member",
        issuer,
        subject: "member",
        tokenIdentifier: `${issuer}|member`,
        verifiedEmail: "member@example.test",
      },
    ],
    users: [
      {
        _id: "user-admin",
        legacyId: "legacy-admin",
        status: "active",
      },
      {
        _id: "user-member",
        legacyId: "legacy-member",
        status: "active",
      },
    ],
    roles: [{ _id: "role-admin", admin: true }],
    userRoles: [
      {
        userId: "user-admin",
        roleId: "role-admin",
      },
    ],
  });
  assert.equal(profiles.admin.userLegacyId, "legacy-admin");
  assert.equal(profiles.member.userLegacyId, "legacy-member");
  assert.equal(profiles.admin.isAdmin, true);
  assert.equal(profiles.member.isAdmin, false);
});

test("rejects an ambiguous human smoke-identity matrix", () => {
  assert.throws(
    () =>
      deriveHumanProfiles({
        authIdentities: [
          {
            userId: "user-admin",
            issuer,
            subject: "admin",
            tokenIdentifier: `${issuer}|admin`,
            verifiedEmail: "admin@example.test",
          },
        ],
        users: [
          {
            _id: "user-admin",
            legacyId: "legacy-admin",
            status: "active",
          },
        ],
        roles: [{ _id: "role-admin", admin: true }],
        userRoles: [
          {
            userId: "user-admin",
            roleId: "role-admin",
          },
        ],
      }),
    /exactly one administrator and one ordinary member/u,
  );
});

test("normalizes only a token-safe pipeline claims probe", () => {
  assert.deepEqual(
    normalizePipelineProbe({
      identity: {
        issuer,
        subject: "pipeline",
        token_identifier: `${issuer}|pipeline`,
        expires_at: 1_900_000_000,
      },
      token_exposed: false,
    }),
    {
      issuer,
      subject: "pipeline",
      tokenIdentifier: `${issuer}|pipeline`,
    },
  );
  assert.throws(
    () =>
      normalizePipelineProbe({
        identity: {
          issuer,
          subject: "pipeline",
          token_identifier: `${issuer}|pipeline`,
        },
        token_exposed: true,
      }),
    /unsafe result/u,
  );
});
