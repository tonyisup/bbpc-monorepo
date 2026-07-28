import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  normalizeIdentity,
  readPrivateJson,
} from "../performance/benchmark-authenticated.mjs";
import {
  serializeJsonLines,
  sha256,
  transformRoleRow,
  transformUserRoleRow,
  transformUserRow,
} from "../sql/identity-rows.mjs";

const runIdPattern = /^[A-Za-z0-9._:-]{1,100}$/u;
const verifiedAt = new Date("2024-01-01T00:00:00.000Z");
const administratorLegacyId = "staging-admin";
const memberLegacyId = "staging-member";
const administratorEmail = "staging-admin@example.invalid";
const memberEmail = "staging-member@example.invalid";
const administratorRoleId = 1;
const administratorMembershipId =
  "00000000-0000-4000-8000-000000000001";

export const syntheticFixtureFileNames = Object.freeze({
  manifest: "manifest.json",
  provisioning: "provisioning.json",
  migrationRawUsers: "migrationRawUsers.jsonl",
  migrationRawRoles: "migrationRawRoles.jsonl",
  migrationRawUserRoles: "migrationRawUserRoles.jsonl",
});

const tableNames = [
  "migrationRawUsers",
  "migrationRawRoles",
  "migrationRawUserRoles",
];

function assertRunId(runId) {
  if (typeof runId !== "string" || !runIdPattern.test(runId)) {
    throw new Error("A safe synthetic staging run ID is required.");
  }
}

function normalizeDistinctIdentities({
  adminIdentity,
  memberIdentity,
  pipelineIdentity,
}) {
  const identities = {
    admin: normalizeIdentity(
      adminIdentity,
      "Staging administrator identity",
    ),
    member: normalizeIdentity(
      memberIdentity,
      "Staging member identity",
    ),
    pipeline: normalizeIdentity(
      pipelineIdentity,
      "Staging pipeline identity",
    ),
  };
  if (
    new Set(
      Object.values(identities).map(
        (identity) => identity.tokenIdentifier,
      ),
    ).size !== 3
  ) {
    throw new Error(
      "Staging administrator, member, and pipeline identities must be distinct.",
    );
  }
  return identities;
}

export function buildSyntheticFixture({
  runId,
  adminIdentity,
  memberIdentity,
  pipelineIdentity,
}) {
  assertRunId(runId);
  const identities = normalizeDistinctIdentities({
    adminIdentity,
    memberIdentity,
    pipelineIdentity,
  });
  const tables = {
    migrationRawUsers: serializeJsonLines([
      transformUserRow(runId, {
        id: administratorLegacyId,
        name: "Synthetic Staging Administrator",
        email: administratorEmail,
        emailVerified: verifiedAt,
        image: null,
      }),
      transformUserRow(runId, {
        id: memberLegacyId,
        name: "Synthetic Staging Member",
        email: memberEmail,
        emailVerified: verifiedAt,
        image: null,
      }),
    ]),
    migrationRawRoles: serializeJsonLines([
      transformRoleRow(runId, {
        id: administratorRoleId,
        name: "Synthetic Staging Administrator",
        description: "Synthetic staging-only administrator role",
        admin: true,
      }),
    ]),
    migrationRawUserRoles: serializeJsonLines([
      transformUserRoleRow(runId, {
        id: administratorMembershipId,
        userId: administratorLegacyId,
        roleId: administratorRoleId,
      }),
    ]),
  };
  const provisioning = {
    formatVersion: 1,
    runId,
    users: {
      admin: {
        userLegacyId: administratorLegacyId,
        verifiedEmail: administratorEmail,
        ...identities.admin,
      },
      member: {
        userLegacyId: memberLegacyId,
        verifiedEmail: memberEmail,
        ...identities.member,
      },
    },
    pipeline: {
      name: "bbpc-pipeline-staging",
      permissions: ["pipeline:publish"],
      ...identities.pipeline,
    },
  };
  const manifest = {
    formatVersion: 1,
    runId,
    safety: {
      syntheticOnly: true,
      containsProductionRows: false,
      containsCredentials: false,
      containsTokens: false,
      containsIdentityClaims: true,
      cloudDestination: "staging-only",
    },
    tables: Object.fromEntries(
      tableNames.map((table) => [
        table,
        {
          fileName: syntheticFixtureFileNames[table],
          rowCount: tables[table].trimEnd().split("\n").length,
          sha256: sha256(tables[table]),
        },
      ]),
    ),
    principals: {
      humanUsers: 2,
      administrators: 1,
      ordinaryMembers: 1,
      pipelineServices: 1,
      pipelinePermissions: 1,
    },
    provisioningSha256: sha256(
      `${JSON.stringify(provisioning)}\n`,
    ),
  };
  return { manifest, provisioning, tables };
}

function assertPrivatePath(filePath, label, expectedType) {
  const stat = fs.statSync(filePath);
  if (
    (expectedType === "file" && !stat.isFile()) ||
    (expectedType === "directory" && !stat.isDirectory())
  ) {
    throw new Error(`${label} has the wrong filesystem type.`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(
      `${label} must not grant group or other permissions.`,
    );
  }
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} contains invalid JSON.`);
  }
}

export function writeSyntheticFixture({
  outputDirectory,
  ...input
}) {
  const resolvedDirectory = path.resolve(outputDirectory);
  fs.mkdirSync(resolvedDirectory, {
    recursive: true,
    mode: 0o700,
  });
  fs.chmodSync(resolvedDirectory, 0o700);
  const allowedFiles = new Set(
    Object.values(syntheticFixtureFileNames),
  );
  const unexpectedFiles = fs
    .readdirSync(resolvedDirectory)
    .filter((fileName) => !allowedFiles.has(fileName));
  if (unexpectedFiles.length > 0) {
    throw new Error(
      "Synthetic staging fixture directory contains unexpected files.",
    );
  }
  const fixture = buildSyntheticFixture(input);
  const files = {
    [syntheticFixtureFileNames.manifest]:
      `${JSON.stringify(fixture.manifest, null, 2)}\n`,
    [syntheticFixtureFileNames.provisioning]:
      `${JSON.stringify(fixture.provisioning, null, 2)}\n`,
    ...Object.fromEntries(
      tableNames.map((table) => [
        syntheticFixtureFileNames[table],
        fixture.tables[table],
      ]),
    ),
  };
  for (const [fileName, contents] of Object.entries(files)) {
    const filePath = path.join(resolvedDirectory, fileName);
    fs.writeFileSync(filePath, contents, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.chmodSync(filePath, 0o600);
  }
  return verifySyntheticFixture(resolvedDirectory);
}

export function verifySyntheticFixture(outputDirectory) {
  const resolvedDirectory = path.resolve(outputDirectory);
  assertPrivatePath(
    resolvedDirectory,
    "Synthetic staging fixture directory",
    "directory",
  );
  const expectedFiles = new Set(
    Object.values(syntheticFixtureFileNames),
  );
  const actualFiles = new Set(fs.readdirSync(resolvedDirectory));
  if (
    actualFiles.size !== expectedFiles.size ||
    ![...expectedFiles].every((fileName) =>
      actualFiles.has(fileName),
    )
  ) {
    throw new Error(
      "Synthetic staging fixture file allowlist does not match.",
    );
  }
  for (const fileName of actualFiles) {
    assertPrivatePath(
      path.join(resolvedDirectory, fileName),
      `Synthetic staging fixture ${fileName}`,
      "file",
    );
  }
  const manifest = parseJson(
    fs.readFileSync(
      path.join(
        resolvedDirectory,
        syntheticFixtureFileNames.manifest,
      ),
      "utf8",
    ),
    "Synthetic staging manifest",
  );
  const provisioning = parseJson(
    fs.readFileSync(
      path.join(
        resolvedDirectory,
        syntheticFixtureFileNames.provisioning,
      ),
      "utf8",
    ),
    "Synthetic staging provisioning plan",
  );
  const expected = buildSyntheticFixture({
    runId: manifest.runId,
    adminIdentity: {
      issuer: provisioning?.users?.admin?.issuer,
      subject: provisioning?.users?.admin?.subject,
      tokenIdentifier:
        provisioning?.users?.admin?.tokenIdentifier,
    },
    memberIdentity: {
      issuer: provisioning?.users?.member?.issuer,
      subject: provisioning?.users?.member?.subject,
      tokenIdentifier:
        provisioning?.users?.member?.tokenIdentifier,
    },
    pipelineIdentity: {
      issuer: provisioning?.pipeline?.issuer,
      subject: provisioning?.pipeline?.subject,
      tokenIdentifier:
        provisioning?.pipeline?.tokenIdentifier,
    },
  });
  if (
    JSON.stringify(manifest) !==
      JSON.stringify(expected.manifest) ||
    JSON.stringify(provisioning) !==
      JSON.stringify(expected.provisioning)
  ) {
    throw new Error(
      "Synthetic staging fixture metadata does not match its deterministic plan.",
    );
  }
  for (const table of tableNames) {
    const contents = fs.readFileSync(
      path.join(
        resolvedDirectory,
        syntheticFixtureFileNames[table],
      ),
      "utf8",
    );
    if (
      contents !== expected.tables[table] ||
      sha256(contents) !== manifest.tables[table].sha256
    ) {
      throw new Error(
        `Synthetic staging table ${table} does not match its deterministic plan.`,
      );
    }
  }
  return {
    directory: resolvedDirectory,
    manifest,
    provisioning,
    tableFiles: Object.fromEntries(
      tableNames.map((table) => [
        table,
        path.join(
          resolvedDirectory,
          syntheticFixtureFileNames[table],
        ),
      ]),
    ),
  };
}

function parseArguments(argv) {
  const options = {};
  const mappings = new Map([
    ["--run-id", "runId"],
    ["--admin-identity", "adminIdentity"],
    ["--member-identity", "memberIdentity"],
    ["--pipeline-identity", "pipelineIdentity"],
    ["--output-directory", "outputDirectory"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const key = mappings.get(name);
    const value = argv[index + 1];
    if (key === undefined || value === undefined) {
      throw new Error(`Unknown or incomplete argument: ${name}`);
    }
    options[key] = value;
    index += 1;
  }
  for (const name of [
    "runId",
    "adminIdentity",
    "memberIdentity",
    "pipelineIdentity",
    "outputDirectory",
  ]) {
    if (typeof options[name] !== "string") {
      throw new Error(`Missing required synthetic fixture ${name}.`);
    }
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const result = writeSyntheticFixture({
    runId: options.runId,
    adminIdentity: readPrivateJson(
      options.adminIdentity,
      "Staging administrator identity",
    ),
    memberIdentity: readPrivateJson(
      options.memberIdentity,
      "Staging member identity",
    ),
    pipelineIdentity: readPrivateJson(
      options.pipelineIdentity,
      "Staging pipeline identity",
    ),
    outputDirectory: options.outputDirectory,
  });
  process.stdout.write(
    [
      "Synthetic staging fixture prepared.",
      `runId=${result.manifest.runId}`,
      "tables=3",
      "rows=4",
      "humanPrincipals=2",
      "pipelinePrincipals=1",
      "containsProductionRows=false",
      "containsCredentials=false",
      "",
    ].join(" "),
  );
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  path.resolve(invokedPath) ===
    path.resolve(fileURLToPath(import.meta.url))
) {
  try {
    main();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown synthetic staging fixture error.";
    process.stderr.write(
      `Synthetic staging fixture failed: ${message}\n`,
    );
    process.exitCode = 1;
  }
}
