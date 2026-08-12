import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(toolDirectory, "../..");
const workspaceRoot = path.resolve(repositoryRoot, "..");

const DEFAULT_SQL_BASELINE = path.join(
  workspaceRoot,
  "bbpc-db/census/artifacts/workflow-baseline.json",
);
const DEFAULT_OUTPUT = path.join(
  repositoryRoot,
  ".local-migration/performance/convex-public-workflow-benchmark.json",
);
const DEFAULT_CONVEX_URL = "http://127.0.0.1:3210";
const WARMUP_SAMPLES = 3;
const SEQUENTIAL_SAMPLES = 25;
const CONCURRENT_ROUNDS = 8;
const CONCURRENCY_LEVELS = [1, 4];
const MAX_P95_REGRESSION_PERCENT = 20;

const workloads = [
  {
    name: "public.latestEpisodeGraph",
    functionName: "episodes/public:latestPublished",
    args: (today) => ({ onOrBefore: today }),
  },
  {
    name: "public.episodeArchivePage",
    functionName: "episodes/public:listPage",
    args: () => ({
      paginationOpts: {
        cursor: null,
        numItems: 50,
      },
    }),
  },
  {
    name: "member.currentSeasonPoints",
    functionName: "games/public:currentPerformance",
    args: (today) => ({ today }),
  },
];

export function percentile(values, percentage) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentage / 100) * sorted.length) - 1),
  );
  return Number(sorted[index].toFixed(3));
}

export function metrics(values) {
  return {
    samples: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max:
      values.length === 0
        ? null
        : Number(Math.max(...values).toFixed(3)),
  };
}

export function compareP95(sqlP95, convexP95) {
  if (
    typeof sqlP95 !== "number" ||
    typeof convexP95 !== "number" ||
    sqlP95 <= 0
  ) {
    throw new Error("Both p95 values must be positive numbers.");
  }
  const regressionPercent = Number(
    (((convexP95 - sqlP95) / sqlP95) * 100).toFixed(3),
  );
  return {
    sqlP95,
    convexP95,
    regressionPercent,
    maximumAllowedRegressionPercent: MAX_P95_REGRESSION_PERCENT,
    status:
      regressionPercent <= MAX_P95_REGRESSION_PERCENT ? "pass" : "fail",
  };
}

export function requireLocalConvexUrl(value) {
  const parsed = new URL(value);
  const allowedHost =
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "localhost" ||
    parsed.hostname === "::1";
  if (parsed.protocol !== "http:" || !allowedHost) {
    throw new Error(
      "Refusing benchmark: Convex URL must be an http localhost deployment.",
    );
  }
  return parsed.toString().replace(/\/$/u, "");
}

export function pacificToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function responseCardinality(workloadName, value) {
  if (workloadName === "public.episodeArchivePage") {
    return Array.isArray(value?.page) ? value.page.length : 0;
  }
  return value === null ? 0 : 1;
}

function parseArguments(argv) {
  const options = {
    convexUrl:
      process.env.CONVEX_URL?.trim() ||
      process.env.NEXT_PUBLIC_CONVEX_URL?.trim() ||
      DEFAULT_CONVEX_URL,
    output: DEFAULT_OUTPUT,
    sqlBaseline: DEFAULT_SQL_BASELINE,
    today: pacificToday(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (
      !["--convex-url", "--output", "--sql-baseline", "--today"].includes(
        name,
      ) ||
      value === undefined
    ) {
      throw new Error(`Unknown or incomplete argument: ${name}`);
    }
    index += 1;
    if (name === "--convex-url") {
      options.convexUrl = value;
    } else if (name === "--output") {
      options.output = path.resolve(value);
    } else if (name === "--sql-baseline") {
      options.sqlBaseline = path.resolve(value);
    } else {
      options.today = value;
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(options.today)) {
    throw new Error("--today must use YYYY-MM-DD format.");
  }
  options.convexUrl = requireLocalConvexUrl(options.convexUrl);
  return options;
}

function readSqlBaseline(baselinePath) {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  if (
    baseline?.safety?.verifiedDatabase !== "dev" ||
    baseline?.safety?.containsRowValues !== false
  ) {
    throw new Error(
      "Refusing benchmark: SQL baseline must be the aggregate-only dev artifact.",
    );
  }
  return baseline;
}

async function runSample(client, workload, today) {
  const reference = makeFunctionReference(workload.functionName);
  const startedAt = performance.now();
  const result = await client.query(reference, workload.args(today));
  return {
    durationMs: performance.now() - startedAt,
    responseCardinality: responseCardinality(workload.name, result),
    responseBytes: jsonBytes(result),
  };
}

async function measureWorkload(client, workload, today) {
  for (let index = 0; index < WARMUP_SAMPLES; index += 1) {
    await runSample(client, workload, today);
  }

  const sequentialSamples = [];
  for (let index = 0; index < SEQUENTIAL_SAMPLES; index += 1) {
    sequentialSamples.push(await runSample(client, workload, today));
  }

  const concurrency = [];
  for (const level of CONCURRENCY_LEVELS) {
    const requestSamples = [];
    const wallDurations = [];
    for (let round = 0; round < CONCURRENT_ROUNDS; round += 1) {
      const roundStartedAt = performance.now();
      const samples = await Promise.all(
        Array.from({ length: level }, () =>
          runSample(client, workload, today),
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
  const sqlBaseline = readSqlBaseline(options.sqlBaseline);
  const sqlByName = new Map(
    sqlBaseline.workloads.map((workload) => [workload.name, workload]),
  );
  const client = new ConvexHttpClient(options.convexUrl);
  const results = [];

  for (const workload of workloads) {
    const measured = await measureWorkload(client, workload, options.today);
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
      containsRowValues: false,
      containsCredentials: false,
      sourceDatabase: sqlBaseline.safety.verifiedDatabase,
      sourceFingerprint: sqlBaseline.safety.databaseSourceFingerprint,
    },
    method: {
      warmupSamplesPerWorkload: WARMUP_SAMPLES,
      sequentialSamplesPerWorkload: SEQUENTIAL_SAMPLES,
      concurrentRoundsPerLevel: CONCURRENT_ROUNDS,
      concurrencyLevels: CONCURRENCY_LEVELS,
      latencyUnit: "milliseconds",
      payloadUnit: "serialized JSON bytes",
      p95RegressionThresholdPercent: MAX_P95_REGRESSION_PERCENT,
      today: options.today,
      note:
        "Client-observed local Convex benchmark against the production-derived restore; authenticated workloads require a separately provisioned identity harness.",
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
      "Convex public workflow benchmark completed.",
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
