import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  serializeJsonLines,
  sha256,
  transformGamePointTypeRow,
  transformGameTypeRow,
  transformGamblingEntryRow,
  transformGamblingTypeRow,
  transformGuessRow,
  transformPointRow,
  transformQuoteSubmissionRow,
  transformSeasonRow,
  transformTagVoteRow,
} from "./game-rows.mjs";

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
    "  npm run migration:extract:games -- --run-id <id> " +
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
    `Refusing game extraction: SQL_DATABASE must be exactly ${EXPECTED_DATABASE}`,
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
    appName: "bbpc-convex-local-game-extractor",
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
let gameTypeRows;
let gamePointTypeRows;
let seasonRows;
let pointRows;
let guessRows;
let gamblingTypeRows;
let gamblingEntryRows;
let tagVoteRows;
let quoteSubmissionRows;
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
      `Refusing game extraction: connected database must be exactly ${EXPECTED_DATABASE}`,
    );
  }
  gameTypeRows = (
    await transaction.request().query(`
      SELECT id, title, description, lookupID
      FROM dbo.GameType
      ORDER BY id;
    `)
  ).recordset;
  gamePointTypeRows = (
    await transaction.request().query(`
      SELECT
        id,
        lookupID,
        title,
        description,
        points,
        gameTypeId
      FROM dbo.GamePointType
      ORDER BY id;
    `)
  ).recordset;
  seasonRows = (
    await transaction.request().query(`
      SELECT
        id,
        title,
        description,
        gameTypeId,
        endedOn,
        startedOn
      FROM dbo.Season
      ORDER BY id;
    `)
  ).recordset;
  pointRows = (
    await transaction.request().query(`
      SELECT
        id,
        userId,
        seasonId,
        reason,
        earnedOn,
        adjustment,
        gamePointTypeId
      FROM dbo.Point
      ORDER BY id;
    `)
  ).recordset;
  guessRows = (
    await transaction.request().query(`
      SELECT
        id,
        ratingId,
        created,
        userId,
        assignmntReviewId,
        seasonId,
        pointsId
      FROM dbo.Guess
      ORDER BY id;
    `)
  ).recordset;
  gamblingTypeRows = (
    await transaction.request().query(`
      SELECT
        id,
        lookupId,
        title,
        description,
        multiplier,
        isActive,
        createdAt
      FROM dbo.GamblingType
      ORDER BY id;
    `)
  ).recordset;
  gamblingEntryRows = (
    await transaction.request().query(`
      SELECT
        id,
        userId,
        assignmentId,
        points,
        createdAt,
        pointsId,
        seasonId,
        notes,
        gamblingTypeId,
        targetUserId,
        status
      FROM dbo.GamblingPoints
      ORDER BY id;
    `)
  ).recordset;
  tagVoteRows = (
    await transaction.request().query(`
      SELECT
        id,
        tag,
        tmdbId,
        isTag,
        createdAt,
        sessionId,
        userId,
        pointId
      FROM dbo.TagVote
      ORDER BY id;
    `)
  ).recordset;
  quoteSubmissionRows = (
    await transaction.request().query(`
      SELECT
        id,
        userId,
        episodeId,
        seasonId,
        quoteText,
        sourceTitle,
        sourceType,
        clipUrl,
        clipStartSeconds,
        listenerNotes,
        status,
        bracketOrder,
        placement,
        adminNotes,
        pointId,
        createdAt,
        updatedAt
      FROM dbo.QuoteSubmission
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

for (const [table, rows] of [
  ["dbo.GameType", gameTypeRows],
  ["dbo.GamePointType", gamePointTypeRows],
  ["dbo.Season", seasonRows],
  ["dbo.Point", pointRows],
  ["dbo.Guess", guessRows],
  ["dbo.GamblingType", gamblingTypeRows],
  ["dbo.GamblingPoints", gamblingEntryRows],
  ["dbo.TagVote", tagVoteRows],
  ["dbo.QuoteSubmission", quoteSubmissionRows],
]) {
  assertExpectedCount(rows.length, census.expectedCounts, table);
}

const outputs = [
  {
    table: "migrationRawGameTypes",
    records: gameTypeRows.map((row) =>
      transformGameTypeRow(runId, row),
    ),
  },
  {
    table: "migrationRawGamePointTypes",
    records: gamePointTypeRows.map((row) =>
      transformGamePointTypeRow(runId, row),
    ),
  },
  {
    table: "migrationRawSeasons",
    records: seasonRows.map((row) =>
      transformSeasonRow(runId, row),
    ),
  },
  {
    table: "migrationRawPoints",
    records: pointRows.map((row) =>
      transformPointRow(runId, row),
    ),
  },
  {
    table: "migrationRawGuesses",
    records: guessRows.map((row) =>
      transformGuessRow(runId, row),
    ),
  },
  {
    table: "migrationRawGamblingTypes",
    records: gamblingTypeRows.map((row) =>
      transformGamblingTypeRow(runId, row),
    ),
  },
  {
    table: "migrationRawGamblingEntries",
    records: gamblingEntryRows.map((row) =>
      transformGamblingEntryRow(runId, row),
    ),
  },
  {
    table: "migrationRawTagVotes",
    records: tagVoteRows.map((row) =>
      transformTagVoteRow(runId, row),
    ),
  },
  {
    table: "migrationRawQuoteSubmissions",
    records: quoteSubmissionRows.map((row) =>
      transformQuoteSubmissionRow(runId, row),
    ),
  },
].map((output) => {
  const fileName = `${output.table}.jsonl`;
  const contents = serializeJsonLines(output.records);
  return {
    ...output,
    fileName,
    contents,
    checksum: sha256(contents),
  };
});

const outputRoot = path.join(projectRoot, ".local-migration");
const runDirectory = path.join(outputRoot, runId);
const finalDirectory = path.join(runDirectory, "games");
if (fs.existsSync(finalDirectory)) {
  throw new Error(
    "Refusing to overwrite an existing immutable game extract",
  );
}
fs.mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
fs.chmodSync(outputRoot, 0o700);
fs.chmodSync(runDirectory, 0o700);
const temporaryDirectory = fs.mkdtempSync(
  path.join(runDirectory, ".games-"),
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
    domain: "games",
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
    "Game extraction complete.",
    `runId=${runId}`,
    ...outputs.map(
      (output) =>
        `${output.table}.rows=${output.records.length} sha256=${output.checksum}`,
    ),
    "The output contains production-derived row values and must remain local.",
    "",
  ].join("\n"),
);
