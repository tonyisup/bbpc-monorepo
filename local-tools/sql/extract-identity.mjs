import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  serializeJsonLines,
  sha256,
  transformRoleRow,
  transformUserRoleRow,
  transformUserRow,
} from "./identity-rows.mjs";
import {
  EXPECTED_SOURCE_SCHEMA_FINGERPRINT,
  loadRecentSourceCensus,
  sourceFingerprintFromArguments,
} from "./source-census.mjs";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolDirectory, "../..");
const workspaceRoot = path.resolve(projectRoot, "..");
const requireFromAdmin = createRequire(
  path.join(workspaceRoot, "bbpc-admin/package.json"),
);
const sql = requireFromAdmin("mssql");
const { config: loadEnv } = requireFromAdmin("dotenv");

const EXPECTED_DATABASE = "dev";
const REQUIRED_ACKNOWLEDGEMENT =
  "--ack-production-derived-local-only";

function usage() {
  return [
    "Usage:",
    "  npm run migration:extract:identity -- --run-id <id> " +
      "--source-fingerprint <sha256> " +
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
  return {
    runId,
    sourceFingerprint: sourceFingerprintFromArguments(argv),
  };
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
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

const { runId, sourceFingerprint } = parseArguments(
  process.argv.slice(2),
);
const census = loadRecentSourceCensus({
  workspaceRoot,
  approvedSourceFingerprint: sourceFingerprint,
});

loadEnv({
  path: path.join(workspaceRoot, "bbpc-pipeline/.env"),
  override: false,
});
const database = requiredEnvironment("SQL_DATABASE");
if (database.toLowerCase() !== EXPECTED_DATABASE) {
  throw new Error(
    `Refusing identity extraction: SQL_DATABASE must be exactly ${EXPECTED_DATABASE}`,
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
    appName: "bbpc-convex-local-identity-extractor",
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
let userRows;
let roleRows;
let userRoleRows;
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
      `Refusing identity extraction: connected database must be exactly ${EXPECTED_DATABASE}`,
    );
  }
  userRows = (
    await transaction.request().query(`
      SELECT id, name, email, emailVerified, image
      FROM dbo.[User]
      ORDER BY id;
    `)
  ).recordset;
  roleRows = (
    await transaction.request().query(`
      SELECT id, name, description, admin
      FROM dbo.Role
      ORDER BY id;
    `)
  ).recordset;
  userRoleRows = (
    await transaction.request().query(`
      SELECT id, userId, roleId
      FROM dbo.UserRole
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
  userRows.length,
  census.expectedCounts,
  "dbo.User",
);
assertExpectedCount(
  roleRows.length,
  census.expectedCounts,
  "dbo.Role",
);
assertExpectedCount(
  userRoleRows.length,
  census.expectedCounts,
  "dbo.UserRole",
);

const outputs = [
  {
    table: "migrationRawUsers",
    fileName: "migrationRawUsers.jsonl",
    records: userRows.map((row) => transformUserRow(runId, row)),
  },
  {
    table: "migrationRawRoles",
    fileName: "migrationRawRoles.jsonl",
    records: roleRows.map((row) => transformRoleRow(runId, row)),
  },
  {
    table: "migrationRawUserRoles",
    fileName: "migrationRawUserRoles.jsonl",
    records: userRoleRows.map((row) =>
      transformUserRoleRow(runId, row),
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
const finalDirectory = path.join(runDirectory, "identity");
if (fs.existsSync(finalDirectory)) {
  throw new Error(
    "Refusing to overwrite an existing immutable identity extract",
  );
}
fs.mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
fs.chmodSync(outputRoot, 0o700);
fs.chmodSync(runDirectory, 0o700);
const temporaryDirectory = fs.mkdtempSync(
  path.join(runDirectory, ".identity-"),
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
    domain: "identity",
    generatedAt: new Date().toISOString(),
    runId,
    sourceDatabase: EXPECTED_DATABASE,
    sourceSchemaFingerprint: EXPECTED_SOURCE_SCHEMA_FINGERPRINT,
    sourceSnapshotFingerprint: census.sourceFingerprint,
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
    "Identity extraction complete.",
    `runId=${runId}`,
    ...outputs.map(
      (output) =>
        `${output.table}.rows=${output.records.length} sha256=${output.checksum}`,
    ),
    "The output contains production-derived row values and must remain local.",
    "",
  ].join("\n"),
);
