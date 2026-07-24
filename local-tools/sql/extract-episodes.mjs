import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  serializeJsonLines,
  sha256,
  transformBangerRow,
  transformEpisodeAudioMessageRow,
  transformEpisodeLinkRow,
  transformEpisodeRow,
} from "./episode-rows.mjs";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolDirectory, "../..");
const workspaceRoot = path.resolve(projectRoot, "..");
const requireFromAdmin = createRequire(
  path.join(workspaceRoot, "bbpc-admin/package.json"),
);
const sql = requireFromAdmin("mssql");
const { config: loadEnv } = requireFromAdmin("dotenv");

const EXPECTED_DATABASE = "dev";
const EXPECTED_SOURCE_FINGERPRINT =
  "5b15b1933b626c3f084dcb0c795033032cf8a9a1f228933a7e74ddd5a9080a2a";
const MAX_CENSUS_AGE_MS = 15 * 60 * 1000;
const REQUIRED_ACKNOWLEDGEMENT =
  "--ack-production-derived-local-only";

function usage() {
  return [
    "Usage:",
    "  npm run migration:extract:episodes -- --run-id <id> " +
      REQUIRED_ACKNOWLEDGEMENT,
    "",
    "Requires a database census generated within the previous 15 minutes.",
  ].join("\n");
}

function parseArguments(argv) {
  if (argv.includes("--help")) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  const runIdIndex = argv.indexOf("--run-id");
  const runId = runIdIndex < 0 ? undefined : argv[runIdIndex + 1];
  if (
    typeof runId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,100}$/u.test(runId)
  ) {
    throw new Error("A safe --run-id is required");
  }
  if (!argv.includes(REQUIRED_ACKNOWLEDGEMENT)) {
    throw new Error(
      `Explicit ${REQUIRED_ACKNOWLEDGEMENT} acknowledgement is required`,
    );
  }
  return { runId };
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function loadRecentCensus() {
  const censusPath = path.join(
    workspaceRoot,
    "bbpc-db/census/artifacts/database-census.json",
  );
  const census = JSON.parse(fs.readFileSync(censusPath, "utf8"));
  const generatedAt = Date.parse(census.generatedAt);
  if (
    !Number.isFinite(generatedAt) ||
    Date.now() - generatedAt > MAX_CENSUS_AGE_MS
  ) {
    throw new Error(
      "The guarded database census must be regenerated within the previous 15 minutes",
    );
  }
  if (
    census.safety?.verifiedDatabase !== EXPECTED_DATABASE ||
    census.safety?.containsRowValues !== false ||
    census.safety?.sourceFingerprint !== EXPECTED_SOURCE_FINGERPRINT
  ) {
    throw new Error(
      "The recent census does not match the approved dev source fingerprint",
    );
  }
  const expectedCounts = new Map(
    census.metadata.tableSizes.map((table) => [
      `${table.schemaName}.${table.tableName}`,
      Number(table.rowCount),
    ]),
  );
  return {
    generatedAt: census.generatedAt,
    serverFingerprint: census.safety.serverFingerprint,
    expectedCounts,
  };
}

function assertExpectedCount(actual, expectedCounts, table) {
  const expected = expectedCounts.get(table);
  if (!Number.isSafeInteger(expected) || actual !== expected) {
    throw new Error(
      `Extraction count for ${table} changed since the guarded census`,
    );
  }
}

function writePrivateFile(filePath, contents) {
  fs.writeFileSync(filePath, contents, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
}

const { runId } = parseArguments(process.argv.slice(2));
const census = loadRecentCensus();

loadEnv({
  path: path.join(workspaceRoot, "bbpc-pipeline/.env"),
  override: false,
});
const database = requiredEnvironment("SQL_DATABASE");
if (database.toLowerCase() !== EXPECTED_DATABASE) {
  throw new Error(
    `Refusing episode extraction: SQL_DATABASE must be exactly ${EXPECTED_DATABASE}`,
  );
}

const connectionConfig = {
  server: requiredEnvironment("SQL_SERVER"),
  database,
  user: requiredEnvironment("SQL_USER"),
  password: requiredEnvironment("SQL_PASSWORD"),
  connectionTimeout: 30_000,
  requestTimeout: 120_000,
  pool: {
    min: 0,
    max: 1,
    idleTimeoutMillis: 30_000,
  },
  options: {
    appName: "bbpc-convex-local-episode-extractor",
    encrypt: true,
    readOnlyIntent: true,
    trustServerCertificate: false,
    useUTC: true,
  },
};
if (sha256(connectionConfig.server) !== census.serverFingerprint) {
  throw new Error(
    "The SQL server does not match the server verified by the recent census",
  );
}

let pool;
try {
  pool = await sql.connect(connectionConfig);
} catch {
  throw new Error(
    "Unable to connect to the guarded dev database; connection details suppressed",
  );
}

const transaction = new sql.Transaction(pool);
let episodeRows;
let linkRows;
let bangerRows;
let audioRows;
try {
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  const identity = await transaction
    .request()
    .query("SELECT DB_NAME() AS databaseName;");
  if (
    identity.recordset[0]?.databaseName?.toLowerCase() !==
    EXPECTED_DATABASE
  ) {
    throw new Error(
      `Refusing episode extraction: connected database must be exactly ${EXPECTED_DATABASE}`,
    );
  }
  episodeRows = (
    await transaction.request().query(`
      SELECT
        id,
        number,
        title,
        recording,
        date,
        description,
        status,
        notes,
        seoDescription,
        seoKeywords,
        seoTitle,
        slug
      FROM dbo.Episode
      ORDER BY id;
    `)
  ).recordset;
  linkRows = (
    await transaction.request().query(`
      SELECT id, url, text, episodeId
      FROM dbo.Link
      ORDER BY id;
    `)
  ).recordset;
  bangerRows = (
    await transaction.request().query(`
      SELECT id, title, artist, url, episodeId, userId
      FROM dbo.Banger
      ORDER BY id;
    `)
  ).recordset;
  audioRows = (
    await transaction.request().query(`
      SELECT id, url, createdAt, fileKey, userId, episodeId, notes
      FROM dbo.AudioEpisodeMessage
      ORDER BY id;
    `)
  ).recordset;
  await transaction.commit();
} catch (error) {
  try {
    await transaction.rollback();
  } catch {
    // The transaction may already be rolled back by the driver.
  }
  throw error;
} finally {
  await pool.close();
}

assertExpectedCount(
  episodeRows.length,
  census.expectedCounts,
  "dbo.Episode",
);
assertExpectedCount(
  linkRows.length,
  census.expectedCounts,
  "dbo.Link",
);
assertExpectedCount(
  bangerRows.length,
  census.expectedCounts,
  "dbo.Banger",
);
assertExpectedCount(
  audioRows.length,
  census.expectedCounts,
  "dbo.AudioEpisodeMessage",
);

const outputs = [
  {
    table: "migrationRawEpisodes",
    fileName: "migrationRawEpisodes.jsonl",
    records: episodeRows.map((row) =>
      transformEpisodeRow(runId, row),
    ),
  },
  {
    table: "migrationRawEpisodeLinks",
    fileName: "migrationRawEpisodeLinks.jsonl",
    records: linkRows.map((row) =>
      transformEpisodeLinkRow(runId, row),
    ),
  },
  {
    table: "migrationRawBangers",
    fileName: "migrationRawBangers.jsonl",
    records: bangerRows.map((row) =>
      transformBangerRow(runId, row),
    ),
  },
  {
    table: "migrationRawEpisodeAudioMessages",
    fileName: "migrationRawEpisodeAudioMessages.jsonl",
    records: audioRows.map((row) =>
      transformEpisodeAudioMessageRow(runId, row),
    ),
  },
].map((output) => {
  const contents = serializeJsonLines(output.records);
  return {
    ...output,
    contents,
    checksum: sha256(contents),
  };
});

const outputRoot = path.join(projectRoot, ".local-migration");
const runDirectory = path.join(outputRoot, runId);
const finalDirectory = path.join(runDirectory, "episodes");
if (fs.existsSync(finalDirectory)) {
  throw new Error(
    "Refusing to overwrite an existing immutable episode extract",
  );
}
fs.mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
fs.chmodSync(outputRoot, 0o700);
fs.chmodSync(runDirectory, 0o700);
const temporaryDirectory = fs.mkdtempSync(
  path.join(runDirectory, ".episodes-"),
);
try {
  fs.chmodSync(temporaryDirectory, 0o700);
  for (const output of outputs) {
    writePrivateFile(
      path.join(temporaryDirectory, output.fileName),
      output.contents,
    );
  }
  const manifest = {
    formatVersion: 1,
    domain: "episodes",
    generatedAt: new Date().toISOString(),
    runId,
    sourceDatabase: EXPECTED_DATABASE,
    sourceSchemaFingerprint: EXPECTED_SOURCE_FINGERPRINT,
    sourceServerFingerprint: census.serverFingerprint,
    censusGeneratedAt: census.generatedAt,
    containsProductionDerivedRowValues: true,
    localOnly: true,
    retiredTablesExtracted: [],
    files: outputs.map((output) => ({
      table: output.table,
      fileName: output.fileName,
      rowCount: output.records.length,
      sha256: output.checksum,
    })),
  };
  writePrivateFile(
    path.join(temporaryDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  fs.renameSync(temporaryDirectory, finalDirectory);
} catch (error) {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  throw error;
}

process.stdout.write(
  [
    "Episode extraction complete.",
    `runId=${runId}`,
    ...outputs.map(
      (output) =>
        `${output.table}.rows=${output.records.length} sha256=${output.checksum}`,
    ),
    "The output contains production-derived row values and must remain local.",
    "",
  ].join("\n"),
);
