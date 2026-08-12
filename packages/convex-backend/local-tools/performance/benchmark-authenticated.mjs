import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

import {
  compareP95,
  metrics,
  requireLocalConvexUrl,
} from "./benchmark-public.mjs";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(toolDirectory, "../..");
const workspaceRoot = path.resolve(repositoryRoot, "..");
const DEFAULT_SQL_BASELINE = path.join(
  workspaceRoot,
  "bbpc-db/census/artifacts/workflow-baseline.json",
);
const DEFAULT_OUTPUT = path.join(
  repositoryRoot,
  ".local-migration/performance/convex-authenticated-workflow-benchmark.json",
);
const WARMUP_SAMPLES = 3;
const SEQUENTIAL_SAMPLES = 25;
const CONCURRENT_ROUNDS = 8;
const CONCURRENCY_LEVELS = [1, 4];
const MAX_PIPELINE_DATE_PAGES = 20;

const workloadDefinitions = [
  {
    name: "admin.dashboard",
    functionName: "admin/dashboard:overview",
    actor: "admin",
    args: () => ({}),
    cardinality: (value) => (value === null ? 0 : 1),
  },
  {
    name: "member.rankedLists",
    functionName: "rankings/lists:listMine",
    actor: "member",
    args: () => ({}),
    cardinality: (value) => (Array.isArray(value) ? value.length : 0),
  },
  {
    name: "pipeline.episodeBundle",
    functionName: "pipeline/content:getEpisodeContextByDate",
    actor: "pipeline",
    args: (context) => ({ date: context.pipelineEpisodeDate }),
    cardinality: (value) => (value === null ? 0 : 1),
  },
];

function assertPrivateRegularFile(filePath, label) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`${label} must be a regular file.`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(`${label} must not grant group or other permissions.`);
  }
}

export function readPrivateJson(filePath, label) {
  const resolved = path.resolve(filePath);
  assertPrivateRegularFile(resolved, label);
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch {
    throw new Error(`${label} must contain valid JSON.`);
  }
}

export function normalizeIdentity(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object.`);
  }
  const allowedKeys = new Set(["issuer", "subject", "tokenIdentifier"]);
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(
      `${label} may contain only issuer, subject, and tokenIdentifier.`,
    );
  }
  const identity = {
    issuer:
      typeof value.issuer === "string" ? value.issuer.trim() : "",
    subject:
      typeof value.subject === "string" ? value.subject.trim() : "",
    tokenIdentifier:
      typeof value.tokenIdentifier === "string"
        ? value.tokenIdentifier.trim()
        : "",
  };
  if (
    identity.issuer.length === 0 ||
    identity.subject.length === 0 ||
    identity.tokenIdentifier.length === 0
  ) {
    throw new Error(`${label} has a missing identity field.`);
  }
  if (
    identity.tokenIdentifier !==
    `${identity.issuer}|${identity.subject}`
  ) {
    throw new Error(
      `${label} tokenIdentifier must exactly match issuer|subject.`,
    );
  }
  return identity;
}

export function readLocalConfig(filePath) {
  const config = readPrivateJson(filePath, "Local Convex config");
  const adminKey =
    typeof config.adminKey === "string" ? config.adminKey.trim() : "";
  const cloudPort = config.ports?.cloud;
  if (
    adminKey.length === 0 ||
    !Number.isSafeInteger(cloudPort) ||
    cloudPort < 1 ||
    cloudPort > 65_535
  ) {
    throw new Error(
      "Local Convex config is missing a safe admin key or cloud port.",
    );
  }
  return { adminKey, cloudPort };
}

function parseArguments(argv) {
  const options = {
    convexUrl: null,
    localConfig: null,
    adminIdentity: null,
    memberIdentity: null,
    pipelineIdentity: null,
    output: DEFAULT_OUTPUT,
    sqlBaseline: DEFAULT_SQL_BASELINE,
  };
  const supported = new Set([
    "--convex-url",
    "--local-config",
    "--admin-identity",
    "--member-identity",
    "--pipeline-identity",
    "--output",
    "--sql-baseline",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!supported.has(name) || value === undefined) {
      throw new Error(`Unknown or incomplete argument: ${name}`);
    }
    index += 1;
    if (name === "--convex-url") {
      options.convexUrl = value;
    } else if (name === "--local-config") {
      options.localConfig = path.resolve(value);
    } else if (name === "--admin-identity") {
      options.adminIdentity = path.resolve(value);
    } else if (name === "--member-identity") {
      options.memberIdentity = path.resolve(value);
    } else if (name === "--pipeline-identity") {
      options.pipelineIdentity = path.resolve(value);
    } else if (name === "--output") {
      options.output = path.resolve(value);
    } else {
      options.sqlBaseline = path.resolve(value);
    }
  }
  for (const [name, value] of [
    ["--local-config", options.localConfig],
    ["--admin-identity", options.adminIdentity],
    ["--member-identity", options.memberIdentity],
    ["--pipeline-identity", options.pipelineIdentity],
  ]) {
    if (value === null) {
      throw new Error(`Missing required argument ${name}.`);
    }
  }
  return options;
}

function loadInputs(options) {
  const localConfig = readLocalConfig(options.localConfig);
  const convexUrl = requireLocalConvexUrl(
    options.convexUrl ?? `http://127.0.0.1:${String(localConfig.cloudPort)}`,
  );
  const parsedUrl = new URL(convexUrl);
  if (Number(parsedUrl.port) !== localConfig.cloudPort) {
    throw new Error(
      "Local Convex URL port does not match the private local config.",
    );
  }
  const identities = {
    admin: normalizeIdentity(
      readPrivateJson(options.adminIdentity, "Administrator identity file"),
      "Administrator identity file",
    ),
    member: normalizeIdentity(
      readPrivateJson(options.memberIdentity, "Member identity file"),
      "Member identity file",
    ),
    pipeline: normalizeIdentity(
      readPrivateJson(options.pipelineIdentity, "Pipeline identity file"),
      "Pipeline identity file",
    ),
  };
  if (new Set(Object.values(identities).map((identity) =>
    identity.tokenIdentifier
  )).size !== 3) {
    throw new Error("Benchmark identities must be three distinct principals.");
  }
  const sqlBaseline = JSON.parse(
    fs.readFileSync(options.sqlBaseline, "utf8"),
  );
  if (
    sqlBaseline?.safety?.verifiedDatabase !== "dev" ||
    sqlBaseline?.safety?.containsRowValues !== false
  ) {
    throw new Error(
      "Refusing benchmark: SQL baseline must be the aggregate-only dev artifact.",
    );
  }
  return {
    convexUrl,
    adminKey: localConfig.adminKey,
    identities,
    sqlBaseline,
  };
}

function createActorClient(convexUrl, adminKey, identity) {
  const client = new ConvexHttpClient(convexUrl, { logger: false });
  client.setAdminAuth(adminKey, identity);
  client.setDebug(false);
  return client;
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

async function findPipelineEpisodeDate(client) {
  const reference = makeFunctionReference(
    "pipeline/content:listEpisodeDatesPage",
  );
  let cursor = null;
  let latestDate = null;
  for (let pageIndex = 0; pageIndex < MAX_PIPELINE_DATE_PAGES; pageIndex += 1) {
    const result = await client.query(reference, {
      paginationOpts: {
        cursor,
        numItems: 100,
      },
    });
    if (!Array.isArray(result?.page)) {
      throw new Error("Pipeline date preflight returned an invalid page.");
    }
    for (const entry of result.page) {
      if (typeof entry?.date !== "string") {
        throw new Error("Pipeline date preflight returned an invalid date.");
      }
      if (latestDate === null || entry.date > latestDate) {
        latestDate = entry.date;
      }
    }
    if (result.isDone === true) {
      if (latestDate === null) {
        throw new Error(
          "Pipeline date preflight found no dated episode.",
        );
      }
      return latestDate;
    }
    if (
      typeof result.continueCursor !== "string" ||
      result.continueCursor.length === 0 ||
      result.continueCursor === cursor
    ) {
      throw new Error("Pipeline date preflight cursor did not advance.");
    }
    cursor = result.continueCursor;
  }
  throw new Error("Pipeline date preflight exceeded its page bound.");
}

async function runSample(client, workload, context) {
  const reference = makeFunctionReference(workload.functionName);
  const startedAt = performance.now();
  const result = await client.query(reference, workload.args(context));
  return {
    durationMs: performance.now() - startedAt,
    responseCardinality: workload.cardinality(result),
    responseBytes: jsonBytes(result),
  };
}

async function measureWorkload(client, workload, context) {
  for (let index = 0; index < WARMUP_SAMPLES; index += 1) {
    await runSample(client, workload, context);
  }
  const sequentialSamples = [];
  for (let index = 0; index < SEQUENTIAL_SAMPLES; index += 1) {
    sequentialSamples.push(await runSample(client, workload, context));
  }
  const concurrency = [];
  for (const level of CONCURRENCY_LEVELS) {
    const requestSamples = [];
    const wallDurations = [];
    for (let round = 0; round < CONCURRENT_ROUNDS; round += 1) {
      const roundStartedAt = performance.now();
      const samples = await Promise.all(
        Array.from({ length: level }, () =>
          runSample(client, workload, context),
        ),
      );
      wallDurations.push(performance.now() - roundStartedAt);
      requestSamples.push(...samples);
    }
    concurrency.push({
      level,
      rounds: CONCURRENT_ROUNDS,
      requests: requestSamples.length,
      wallDurationMs: metrics(wallDurations),
      requestDurationMs: metrics(
        requestSamples.map((sample) => sample.durationMs),
      ),
    });
  }
  return {
    name: workload.name,
    convexFunction: workload.functionName,
    actorClass: workload.actor,
    errorRate: 0,
    sequential: {
      durationMs: metrics(
        sequentialSamples.map((sample) => sample.durationMs),
      ),
      responseCardinality: metrics(
        sequentialSamples.map((sample) => sample.responseCardinality),
      ),
      responseBytes: metrics(
        sequentialSamples.map((sample) => sample.responseBytes),
      ),
    },
    concurrency,
  };
}

export async function runBenchmark(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const input = loadInputs(options);
  const clients = Object.fromEntries(
    Object.entries(input.identities).map(([actor, identity]) => [
      actor,
      createActorClient(input.convexUrl, input.adminKey, identity),
    ]),
  );
  const pipelineEpisodeDate = await findPipelineEpisodeDate(
    clients.pipeline,
  );
  const context = { pipelineEpisodeDate };
  const sqlByName = new Map(
    input.sqlBaseline.workloads.map((workload) => [
      workload.name,
      workload,
    ]),
  );
  const results = [];
  for (const workload of workloadDefinitions) {
    const measured = await measureWorkload(
      clients[workload.actor],
      workload,
      context,
    );
    const sqlWorkload = sqlByName.get(workload.name);
    if (sqlWorkload === undefined) {
      throw new Error(`SQL baseline is missing workload ${workload.name}.`);
    }
    results.push({
      ...measured,
      sqlComparison: compareP95(
        sqlWorkload.sequential.durationMs.p95,
        measured.sequential.durationMs.p95,
      ),
    });
  }

  const report = {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    safety: {
      localhostOnly: true,
      privateConfigRequired: true,
      privateIdentityFilesRequired: true,
      containsRowValues: false,
      containsIdentityClaims: false,
      containsCredentials: false,
      sourceDatabase: input.sqlBaseline.safety.verifiedDatabase,
      sourceFingerprint:
        input.sqlBaseline.safety.databaseSourceFingerprint,
    },
    method: {
      warmupSamplesPerWorkload: WARMUP_SAMPLES,
      sequentialSamplesPerWorkload: SEQUENTIAL_SAMPLES,
      concurrentRoundsPerLevel: CONCURRENT_ROUNDS,
      concurrencyLevels: CONCURRENCY_LEVELS,
      latencyUnit: "milliseconds",
      payloadUnit: "serialized JSON bytes",
      p95RegressionThresholdPercent: 20,
      note:
        "Local admin-auth impersonation verifies pre-provisioned administrator, member, and pipeline principals without storing their claims or the local admin key in output.",
    },
    preflight: {
      distinctActorClasses: 3,
      administratorResolved: true,
      memberResolved: true,
      pipelineResolved: true,
      datedPipelineEpisodeFound: true,
    },
    summary: {
      measuredWorkloads: results.length,
      passedWorkloads: results.filter(
        (result) => result.sqlComparison.status === "pass",
      ).length,
      failedWorkloads: results.filter(
        (result) => result.sqlComparison.status === "fail",
      ).length,
    },
    workloads: results,
  };

  fs.mkdirSync(path.dirname(options.output), {
    recursive: true,
    mode: 0o700,
  });
  fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.chmodSync(options.output, 0o600);
  process.stdout.write(
    [
      "Convex authenticated workflow benchmark completed.",
      `workloads=${report.summary.measuredWorkloads}`,
      `passed=${report.summary.passedWorkloads}`,
      `failed=${report.summary.failedWorkloads}`,
      `artifact=${path.relative(repositoryRoot, options.output)}`,
    ].join(" ") + "\n",
  );
  if (report.summary.failedWorkloads > 0) {
    process.exitCode = 1;
  }
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runBenchmark();
}
