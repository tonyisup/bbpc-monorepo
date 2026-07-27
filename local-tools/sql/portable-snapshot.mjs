import fs from "node:fs";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const UNZIP = "/usr/bin/unzip";
const MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024;
const CONVEX_METADATA_TABLES = new Set(["_tables"]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function runUnzip(args, label) {
  const result = spawnSync(UNZIP, args, {
    encoding: args[0] === "-p" ? null : "utf8",
    maxBuffer: MAX_SNAPSHOT_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed`);
  }
  return result.stdout;
}

function assertSafeEntry(entry) {
  if (
    entry.length === 0 ||
    entry.startsWith("/") ||
    entry.includes("\\") ||
    entry.split("/").some((part) => part === "..")
  ) {
    throw new Error("Portable snapshot contains an unsafe path");
  }
}

export function inspectPortableSnapshot({
  snapshotPath,
  allowedTables,
  allowedEmptyTables = [],
  expectedCounts = {},
}) {
  if (
    typeof snapshotPath !== "string" ||
    !snapshotPath.endsWith(".zip") ||
    !fs.statSync(snapshotPath).isFile()
  ) {
    throw new Error("A portable snapshot ZIP is required");
  }
  if (
    !Array.isArray(allowedTables) ||
    allowedTables.length === 0 ||
    new Set(allowedTables).size !== allowedTables.length ||
    !Array.isArray(allowedEmptyTables) ||
    new Set(allowedEmptyTables).size !==
      allowedEmptyTables.length
  ) {
    throw new Error(
      "Unique portable and required-empty table allowlists are required",
    );
  }
  const allowed = new Set(allowedTables);
  const requiredEmpty = new Set(allowedEmptyTables);
  if (
    allowedTables.some((table) =>
      requiredEmpty.has(table),
    )
  ) {
    throw new Error(
      "Portable and required-empty table allowlists must not overlap",
    );
  }
  const listing = String(
    runUnzip(["-Z1", snapshotPath], "Snapshot listing"),
  )
    .split(/\r?\n/u)
    .filter((entry) => entry.length > 0);
  const tableEntries = new Map();
  const requiredEmptyEntries = new Map();
  const metadataEntries = new Set();
  const tableSchemaEntries = new Set();
  let generatedSchemaFound = false;
  let readmeFound = false;
  for (const entry of listing) {
    assertSafeEntry(entry);
    if (entry === "README.md") {
      if (readmeFound) {
        throw new Error(
          "Portable snapshot contains duplicate README",
        );
      }
      readmeFound = true;
      continue;
    }
    if (entry === "generated_schema.jsonl") {
      if (generatedSchemaFound) {
        throw new Error(
          "Portable snapshot contains duplicate generated schema",
        );
      }
      generatedSchemaFound = true;
      continue;
    }
    if (entry.endsWith("/")) {
      const table = entry.slice(0, -1);
      if (CONVEX_METADATA_TABLES.has(table)) {
        continue;
      }
      if (
        !allowed.has(table) &&
        !requiredEmpty.has(table)
      ) {
        throw new Error(
          `Portable snapshot contains unexpected table ${table}`,
        );
      }
      continue;
    }
    const match =
      /^([^/]+)\/(documents|generated_schema)\.jsonl$/u.exec(
        entry,
      );
    if (!match) {
      throw new Error(
        `Portable snapshot contains unexpected entry ${entry}`,
      );
    }
    const table = match[1];
    const entryKind = match[2];
    if (CONVEX_METADATA_TABLES.has(table)) {
      const metadataKey = `${table}/${entryKind}`;
      if (metadataEntries.has(metadataKey)) {
        throw new Error(
          `Portable snapshot contains duplicate metadata entry ${metadataKey}`,
        );
      }
      metadataEntries.add(metadataKey);
      continue;
    }
    if (
      !allowed.has(table) &&
      !requiredEmpty.has(table)
    ) {
      throw new Error(
        `Portable snapshot contains unexpected table ${table}`,
      );
    }
    if (entryKind === "generated_schema") {
      if (tableSchemaEntries.has(table)) {
        throw new Error(
          `Portable snapshot contains duplicate table schema ${table}`,
        );
      }
      tableSchemaEntries.add(table);
      continue;
    }
    if (requiredEmpty.has(table)) {
      if (requiredEmptyEntries.has(table)) {
        throw new Error(
          `Portable snapshot contains duplicate required-empty table ${table}`,
        );
      }
      requiredEmptyEntries.set(table, entry);
      continue;
    }
    if (tableEntries.has(table)) {
      throw new Error(
        `Portable snapshot contains duplicate table ${table}`,
      );
    }
    tableEntries.set(table, entry);
  }
  if (
    !generatedSchemaFound &&
    tableSchemaEntries.size === 0
  ) {
    throw new Error(
      "Portable snapshot is missing generated schema metadata",
    );
  }
  if (!generatedSchemaFound) {
    for (const table of [
      ...tableEntries.keys(),
      ...requiredEmptyEntries.keys(),
    ]) {
      if (!tableSchemaEntries.has(table)) {
        throw new Error(
          `Portable snapshot is missing generated schema for ${table}`,
        );
      }
    }
  }
  for (const table of requiredEmpty) {
    if (!requiredEmptyEntries.has(table)) {
      throw new Error(
        `Portable snapshot is missing required-empty table ${table}`,
      );
    }
  }

  function readTableDocuments(table, entry) {
    const bytes = runUnzip(
      ["-p", snapshotPath, entry],
      `Snapshot read for ${table}`,
    );
    const text = bytes.toString("utf8");
    const lines = text.split(/\r?\n/u);
    if (lines.at(-1) === "") {
      lines.pop();
    }
    if (lines.length === 1 && lines[0] === "") {
      lines.pop();
    }
    if (lines.some((line) => line.length === 0)) {
      throw new Error(
        `Portable snapshot table ${table} contains a blank JSON line`,
      );
    }
    const canonicalDocuments = [];
    for (const [index, line] of lines.entries()) {
      try {
        canonicalDocuments.push(
          JSON.stringify(canonicalize(JSON.parse(line))),
        );
      } catch {
        throw new Error(
          `Portable snapshot table ${table} has invalid JSON at line ${String(index + 1)}`,
        );
      }
    }
    canonicalDocuments.sort();
    return {
      rows: lines.length,
      sha256: sha256(
        `${canonicalDocuments.join("\n")}${canonicalDocuments.length === 0 ? "" : "\n"}`,
      ),
    };
  }

  const tables = {};
  let totalRows = 0;
  for (const [table, entry] of [...tableEntries.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    tables[table] = readTableDocuments(table, entry);
    totalRows += tables[table].rows;
  }
  for (const [table, entry] of requiredEmptyEntries) {
    if (readTableDocuments(table, entry).rows !== 0) {
      throw new Error(
        `Portable snapshot required-empty table ${table} contains documents`,
      );
    }
  }

  for (const [table, expectedCount] of Object.entries(
    expectedCounts,
  )) {
    if (
      !allowed.has(table) ||
      !Number.isSafeInteger(expectedCount) ||
      expectedCount < 0
    ) {
      throw new Error(
        `Invalid portable snapshot expectation for ${table}`,
      );
    }
    if (!tableEntries.has(table)) {
      throw new Error(
        `Portable snapshot is missing expected table ${table}`,
      );
    }
    const actualCount = tables[table].rows;
    if (actualCount !== expectedCount) {
      throw new Error(
        `Portable snapshot count mismatch for ${table}: expected ${String(expectedCount)}, received ${String(actualCount)}`,
      );
    }
  }

  return {
    snapshotSha256: sha256(fs.readFileSync(snapshotPath)),
    totalRows,
    tables,
  };
}

export function comparePortableSnapshots(expected, actual) {
  if (
    typeof expected !== "object" ||
    expected === null ||
    typeof actual !== "object" ||
    actual === null ||
    JSON.stringify(expected.tables) !==
      JSON.stringify(actual.tables)
  ) {
    throw new Error(
      "Restored portable snapshot table counts or hashes differ",
    );
  }
  return {
    matched: true,
    totalRows: actual.totalRows,
    tables: Object.keys(actual.tables).length,
  };
}
