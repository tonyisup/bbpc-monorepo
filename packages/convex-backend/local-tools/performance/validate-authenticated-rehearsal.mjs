import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

import {
  normalizeIdentity,
  readLocalConfig,
} from "./benchmark-authenticated.mjs";

const API_VERSION = "0.1.0";
const RUN_ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/u;

function assertPrivateRegularFile(filePath, label) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`${label} must be a regular file.`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(`${label} must not grant group or other permissions.`);
  }
}

function parseJsonLines(value, label) {
  try {
    return value
      .split(/\r?\n/u)
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
  } catch {
    throw new Error(`${label} contains invalid JSON Lines.`);
  }
}

function readZipTable(snapshotPath, tableName) {
  const result = spawnSync(
    "unzip",
    [
      "-p",
      snapshotPath,
      `${tableName}/documents.jsonl`,
    ],
    {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `Unable to read ${tableName} from the private portable snapshot.`,
    );
  }
  return parseJsonLines(result.stdout, tableName);
}

export function deriveHumanProfiles({
  authIdentities,
  users,
  roles,
  userRoles,
}) {
  const usersById = new Map(users.map((user) => [user._id, user]));
  const adminRoleIds = new Set(
    roles
      .filter((role) => role.admin === true)
      .map((role) => role._id),
  );
  const adminUserIds = new Set(
    userRoles
      .filter((membership) =>
        adminRoleIds.has(membership.roleId),
      )
      .map((membership) => membership.userId),
  );
  const profiles = authIdentities.map((identity) => {
    const user = usersById.get(identity.userId);
    if (
      user === undefined ||
      typeof user.legacyId !== "string" ||
      typeof identity.verifiedEmail !== "string" ||
      user.status !== "active"
    ) {
      throw new Error(
        "A private smoke identity does not resolve to an active migrated user.",
      );
    }
    const minimalIdentity = normalizeIdentity(
      {
        issuer: identity.issuer,
        subject: identity.subject,
        tokenIdentifier: identity.tokenIdentifier,
      },
      "Private smoke identity",
    );
    return {
      identity: minimalIdentity,
      userLegacyId: user.legacyId,
      verifiedEmail: identity.verifiedEmail,
      isAdmin: adminUserIds.has(user._id),
    };
  });
  const administrators = profiles.filter(
    (profile) => profile.isAdmin,
  );
  const members = profiles.filter(
    (profile) => !profile.isAdmin,
  );
  if (administrators.length !== 1 || members.length !== 1) {
    throw new Error(
      "The private snapshot must contain exactly one administrator and one ordinary member smoke identity.",
    );
  }
  return {
    admin: administrators[0],
    member: members[0],
  };
}

export function normalizePipelineProbe(value) {
  const identity = value?.identity;
  if (
    value?.token_exposed !== false ||
    identity === null ||
    typeof identity !== "object" ||
    Array.isArray(identity)
  ) {
    throw new Error(
      "The pipeline claims probe returned an unsafe result.",
    );
  }
  return normalizeIdentity(
    {
      issuer: identity.issuer,
      subject: identity.subject,
      tokenIdentifier: identity.token_identifier,
    },
    "Pipeline identity",
  );
}

function mintPipelineIdentity(pipelineRoot) {
  const pythonCandidates = [
    path.join(pipelineRoot, "venv/bin/python"),
    path.join(pipelineRoot, "bin/python"),
  ];
  const python = pythonCandidates.find((candidate) =>
    fs.existsSync(candidate),
  );
  if (python === undefined) {
    throw new Error(
      "The private pipeline Python environment is unavailable.",
    );
  }
  const script = path.join(
    pipelineRoot,
    "scripts/convex_m2m_probe.py",
  );
  assertPrivateRegularFile(
    path.join(pipelineRoot, ".env"),
    "Pipeline environment",
  );
  const result = spawnSync(
    python,
    [script, "--claims-only"],
    {
      cwd: pipelineRoot,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      "Unable to mint and decode the private pipeline identity.",
    );
  }
  try {
    return normalizePipelineProbe(JSON.parse(result.stdout));
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("The pipeline claims probe returned invalid JSON.");
  }
}

function parseArguments(argv) {
  const options = {
    runId: null,
    sourceBackup: null,
    localConfig: null,
    pipelineRoot: null,
    outputDirectory: null,
  };
  const mappings = new Map([
    ["--run-id", "runId"],
    ["--source-backup", "sourceBackup"],
    ["--local-config", "localConfig"],
    ["--pipeline-root", "pipelineRoot"],
    ["--output-directory", "outputDirectory"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const key = mappings.get(name);
    const value = argv[index + 1];
    if (key === undefined || value === undefined) {
      throw new Error(`Unknown or incomplete argument: ${name}`);
    }
    options[key] =
      key === "runId" ? value : path.resolve(value);
    index += 1;
  }
  if (
    typeof options.runId !== "string" ||
    !RUN_ID_PATTERN.test(options.runId)
  ) {
    throw new Error("A safe --run-id is required.");
  }
  for (const [name, value] of [
    ["--source-backup", options.sourceBackup],
    ["--local-config", options.localConfig],
    ["--pipeline-root", options.pipelineRoot],
    ["--output-directory", options.outputDirectory],
  ]) {
    if (value === null) {
      throw new Error(`Missing required argument ${name}.`);
    }
  }
  return options;
}

function createClient(convexUrl, adminKey, identity) {
  const client = new ConvexHttpClient(convexUrl, {
    logger: false,
  });
  client.setAdminAuth(adminKey, identity);
  client.setDebug(false);
  return client;
}

function requireDomainCode(error, expectedCode, label) {
  const code =
    error !== null &&
    typeof error === "object" &&
    error.data !== null &&
    typeof error.data === "object" &&
    typeof error.data.code === "string"
      ? error.data.code
      : null;
  if (code !== expectedCode) {
    throw new Error(
      `${label} did not fail with ${expectedCode}.`,
    );
  }
  return code;
}

async function expectDomainFailure(
  operation,
  expectedCode,
  label,
) {
  try {
    await operation();
  } catch (error) {
    return requireDomainCode(error, expectedCode, label);
  }
  throw new Error(`${label} unexpectedly succeeded.`);
}

function writePrivateJson(filePath, value) {
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(value, null, 2)}\n`,
    { mode: 0o600 },
  );
  fs.chmodSync(filePath, 0o600);
}

function assertUserEvidence(evidence) {
  if (
    evidence?.runMatches !== true ||
    evidence.cutoverStageS1 !== true ||
    evidence.applicationWritesDisabled !== true ||
    evidence.firstApplicationWriteAbsent !== true ||
    evidence.linkedIdentityCount !== 2 ||
    evidence.linkedUserCount !== 2 ||
    evidence.linkedActiveUserCount !== 2 ||
    evidence.linkedAdminUserCount !== 1 ||
    evidence.preprovisionAuditCount !== 2 ||
    evidence.ordinaryLinkAuditCount !== 0
  ) {
    throw new Error(
      "Administrator/member pre-provisioning evidence is incomplete.",
    );
  }
}

function assertPipelineEvidence(evidence) {
  if (
    evidence?.runMatches !== true ||
    evidence.cutoverStageS1 !== true ||
    evidence.applicationWritesDisabled !== true ||
    evidence.firstApplicationWriteAbsent !== true ||
    evidence.principalFound !== true ||
    evidence.principalRunMatches !== true ||
    evidence.principalActive !== true ||
    evidence.permissionCount !== 1 ||
    evidence.publishOnly !== true ||
    evidence.preprovisionAuditCount !== 1 ||
    evidence.statusChangeAuditCount !== 2 ||
    evidence.statusChangeTransitionsValid !== true
  ) {
    throw new Error(
      "Pipeline pre-provisioning evidence is incomplete.",
    );
  }
}

export async function validateAuthenticatedRehearsal(
  argv = process.argv.slice(2),
) {
  const options = parseArguments(argv);
  assertPrivateRegularFile(
    options.sourceBackup,
    "Source portable backup",
  );
  const humanProfiles = deriveHumanProfiles({
    authIdentities: readZipTable(
      options.sourceBackup,
      "authIdentities",
    ),
    users: readZipTable(options.sourceBackup, "users"),
    roles: readZipTable(options.sourceBackup, "roles"),
    userRoles: readZipTable(
      options.sourceBackup,
      "userRoles",
    ),
  });
  const pipelineIdentity = mintPipelineIdentity(
    options.pipelineRoot,
  );
  const identities = {
    admin: humanProfiles.admin.identity,
    member: humanProfiles.member.identity,
    pipeline: pipelineIdentity,
  };
  if (
    new Set(
      Object.values(identities).map(
        (identity) => identity.tokenIdentifier,
      ),
    ).size !== 3
  ) {
    throw new Error(
      "Administrator, member, and pipeline identities must be distinct.",
    );
  }

  const localConfig = readLocalConfig(options.localConfig);
  const convexUrl =
    `http://127.0.0.1:${String(localConfig.cloudPort)}`;
  const internalClient = createClient(
    convexUrl,
    localConfig.adminKey,
  );
  const call = {
    preprovisionUser: makeFunctionReference(
      "identity/provisioning:preprovisionSmokeUser",
    ),
    preprovisionPipeline: makeFunctionReference(
      "identity/provisioning:preprovisionPipelineService",
    ),
    setPipelineStatus: makeFunctionReference(
      "identity/provisioning:setPipelineServiceStatus",
    ),
    inspectUsers: makeFunctionReference(
      "migration/rehearsal:inspectUserIdentityEvidence",
    ),
    inspectPipeline: makeFunctionReference(
      "migration/rehearsal:inspectPipelineIdentityEvidence",
    ),
  };

  for (const actor of ["admin", "member"]) {
    const profile = humanProfiles[actor];
    await internalClient.mutation(call.preprovisionUser, {
      cutoverRunId: options.runId,
      operationId: `identity.preprovision.${actor}`,
      userLegacyId: profile.userLegacyId,
      verifiedEmail: profile.verifiedEmail,
      ...profile.identity,
    });
  }
  const provisionedPipeline = await internalClient.mutation(
    call.preprovisionPipeline,
    {
      cutoverRunId: options.runId,
      operationId: "identity.preprovision.pipeline",
      ...pipelineIdentity,
      name: "bbpc-pipeline",
      permissions: ["pipeline:publish"],
    },
  );
  const servicePrincipalId =
    provisionedPipeline?.servicePrincipalId;
  if (typeof servicePrincipalId !== "string") {
    throw new Error(
      "Pipeline provisioning returned an invalid principal ID.",
    );
  }

  const clients = Object.fromEntries(
    Object.entries(identities).map(([actor, identity]) => [
      actor,
      createClient(
        convexUrl,
        localConfig.adminKey,
        identity,
      ),
    ]),
  );
  const adminDashboard = await clients.admin.query(
    makeFunctionReference("admin/dashboard:overview"),
    {},
  );
  const memberLists = await clients.member.query(
    makeFunctionReference("rankings/lists:listMine"),
    {},
  );
  const rankingTypes = await clients.member.query(
    makeFunctionReference("rankings/types:list"),
    {},
  );
  const pipelineCapabilities = await clients.pipeline.query(
    makeFunctionReference("pipeline/status:capabilities"),
    {},
  );
  if (
    adminDashboard === null ||
    !Array.isArray(memberLists) ||
    !Array.isArray(rankingTypes) ||
    typeof rankingTypes[0]?.id !== "string" ||
    !Array.isArray(pipelineCapabilities?.permissions) ||
    pipelineCapabilities.permissions.length !== 1 ||
    pipelineCapabilities.permissions[0] !== "pipeline:publish"
  ) {
    throw new Error(
      "One or more authenticated read probes returned an invalid result.",
    );
  }

  const blockedWrites = {
    administrator: await expectDomainFailure(
      () =>
        clients.admin.mutation(
          makeFunctionReference("rankings/types:create"),
          {
            clientApiVersion: API_VERSION,
            name: "Blocked rehearsal probe",
            maxItems: 1,
            targetType: "MOVIE",
          },
        ),
      "WRITE_DISABLED",
      "Administrator write probe",
    ),
    member: await expectDomainFailure(
      () =>
        clients.member.mutation(
          makeFunctionReference(
            "rankings/lists:createMine",
          ),
          {
            clientApiVersion: API_VERSION,
            rankedListTypeId: rankingTypes[0].id,
            title: null,
            status: "DRAFT",
          },
        ),
      "WRITE_DISABLED",
      "Member write probe",
    ),
    pipeline: await expectDomainFailure(
      () =>
        clients.pipeline.mutation(
          makeFunctionReference("pipeline/status:heartbeat"),
          {
            clientApiVersion: API_VERSION,
            requiredPermission: "pipeline:publish",
          },
        ),
      "WRITE_DISABLED",
      "Pipeline write probe",
    ),
  };

  const unlinkedIdentity = {
    issuer: identities.member.issuer,
    subject: `local-unlinked-${options.runId}`,
    tokenIdentifier:
      `${identities.member.issuer}|local-unlinked-${options.runId}`,
  };
  const unlinkedDenial = await expectDomainFailure(
    () =>
      createClient(
        convexUrl,
        localConfig.adminKey,
        unlinkedIdentity,
      ).query(
        makeFunctionReference("rankings/lists:listMine"),
        {},
      ),
    "IDENTITY_NOT_LINKED",
    "Unlinked identity read probe",
  );

  await internalClient.mutation(call.setPipelineStatus, {
    cutoverRunId: options.runId,
    operationId: "identity.pipeline.disable",
    servicePrincipalId,
    expectedStatus: "active",
    status: "disabled",
  });
  const disabledPipelineDenial = await expectDomainFailure(
    () =>
      clients.pipeline.query(
        makeFunctionReference("pipeline/status:capabilities"),
        {},
      ),
    "FORBIDDEN",
    "Disabled pipeline read probe",
  );
  await internalClient.mutation(call.setPipelineStatus, {
    cutoverRunId: options.runId,
    operationId: "identity.pipeline.reenable",
    servicePrincipalId,
    expectedStatus: "disabled",
    status: "active",
  });
  await clients.pipeline.query(
    makeFunctionReference("pipeline/status:capabilities"),
    {},
  );

  const userEvidence = await internalClient.query(
    call.inspectUsers,
    { runId: options.runId },
  );
  const pipelineEvidence = await internalClient.query(
    call.inspectPipeline,
    {
      runId: options.runId,
      servicePrincipalId,
    },
  );
  assertUserEvidence(userEvidence);
  assertPipelineEvidence(pipelineEvidence);

  fs.mkdirSync(options.outputDirectory, {
    recursive: true,
    mode: 0o700,
  });
  fs.chmodSync(options.outputDirectory, 0o700);
  for (const [actor, identity] of Object.entries(identities)) {
    writePrivateJson(
      path.join(
        options.outputDirectory,
        `${actor}-identity.json`,
      ),
      identity,
    );
  }
  const report = {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    runId: options.runId,
    safety: {
      localhostOnly: true,
      containsRowValues: false,
      containsIdentityClaims: false,
      containsCredentials: false,
      sourceBackupReadOnly: true,
      applicationWritesDisabled: true,
      firstApplicationWriteAbsent: true,
    },
    principals: {
      linkedIdentities: userEvidence.linkedIdentityCount,
      linkedUsers: userEvidence.linkedUserCount,
      linkedAdministrators:
        userEvidence.linkedAdminUserCount,
      linkedOrdinaryMembers:
        userEvidence.linkedUserCount -
        userEvidence.linkedAdminUserCount,
      pipelinePrincipals: 1,
      pipelinePermissionCount:
        pipelineEvidence.permissionCount,
    },
    reads: {
      administrator: "pass",
      member: "pass",
      pipeline: "pass",
      memberResultCount: memberLists.length,
    },
    denials: {
      unlinkedIdentity: unlinkedDenial,
      disabledPipeline: disabledPipelineDenial,
    },
    blockedWrites,
    pipelineStatusCycle: {
      transitions: 2,
      valid:
        pipelineEvidence.statusChangeTransitionsValid,
      finalStatus: "active",
    },
  };
  writePrivateJson(
    path.join(
      options.outputDirectory,
      "identity-acceptance.json",
    ),
    report,
  );
  process.stdout.write(
    [
      "Authenticated rehearsal identity gate passed.",
      `runId=${options.runId}`,
      "principals=administrator,member,pipeline",
      "authenticatedReads=3",
      "blockedWrites=3",
      "unlinkedDenials=1",
      "pipelineStatusCycle=active-disabled-active",
      "",
    ].join("\n"),
  );
  return report;
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (invokedAsScript) {
  await validateAuthenticatedRehearsal();
}
