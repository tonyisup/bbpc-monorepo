import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const EXPECTED_SOURCE_FINGERPRINT =
  "5b15b1933b626c3f084dcb0c795033032cf8a9a1f228933a7e74ddd5a9080a2a";

const DOMAIN_TABLES = {
  identity: [
    "migrationRawUsers",
    "migrationRawRoles",
    "migrationRawUserRoles",
  ],
  catalog: [
    "migrationRawMovies",
    "migrationRawShows",
    "migrationRawTags",
  ],
  episodes: [
    "migrationRawEpisodes",
    "migrationRawEpisodeLinks",
    "migrationRawBangers",
    "migrationRawEpisodeAudioMessages",
  ],
  assignments: [
    "migrationRawAssignments",
    "migrationRawAssignmentAudioMessages",
    "migrationRawAssignmentPointLinks",
    "migrationRawSyllabusEntries",
  ],
};

const TABLE_FIELDS = {
  migrationRawUsers: {
    required: ["runId", "legacyId", "sourceRowHash"],
    optional: ["name", "email", "emailVerifiedAt", "image"],
  },
  migrationRawRoles: {
    required: [
      "runId",
      "legacyId",
      "name",
      "description",
      "admin",
      "sourceRowHash",
    ],
    optional: [],
  },
  migrationRawUserRoles: {
    required: [
      "runId",
      "legacyId",
      "userLegacyId",
      "roleLegacyId",
      "sourceRowHash",
    ],
    optional: [],
  },
  migrationRawMovies: {
    required: [
      "runId",
      "legacyId",
      "title",
      "year",
      "url",
      "sourceRowHash",
    ],
    optional: ["poster", "tmdbId"],
  },
  migrationRawShows: {
    required: [
      "runId",
      "legacyId",
      "title",
      "year",
      "url",
      "sourceRowHash",
    ],
    optional: ["poster"],
  },
  migrationRawTags: {
    required: [
      "runId",
      "legacyId",
      "name",
      "createdAt",
      "sourceRowHash",
    ],
    optional: ["description"],
  },
  migrationRawEpisodes: {
    required: [
      "runId",
      "legacyId",
      "number",
      "title",
      "sourceRowHash",
    ],
    optional: [
      "recording",
      "date",
      "description",
      "status",
      "notes",
      "seoDescription",
      "seoKeywords",
      "seoTitle",
      "slug",
    ],
  },
  migrationRawEpisodeLinks: {
    required: [
      "runId",
      "legacyId",
      "url",
      "text",
      "sourceRowHash",
    ],
    optional: ["episodeLegacyId"],
  },
  migrationRawBangers: {
    required: [
      "runId",
      "legacyId",
      "title",
      "artist",
      "url",
      "sourceRowHash",
    ],
    optional: ["episodeLegacyId", "userLegacyId"],
  },
  migrationRawEpisodeAudioMessages: {
    required: [
      "runId",
      "legacyId",
      "url",
      "createdAt",
      "userLegacyId",
      "sourceRowHash",
    ],
    optional: ["fileKey", "episodeLegacyId", "notes"],
  },
  migrationRawAssignments: {
    required: [
      "runId",
      "legacyId",
      "userLegacyId",
      "episodeLegacyId",
      "movieLegacyId",
      "type",
      "playable",
      "sourceRowHash",
    ],
    optional: ["slug"],
  },
  migrationRawAssignmentAudioMessages: {
    required: [
      "runId",
      "legacyId",
      "url",
      "createdAt",
      "userLegacyId",
      "sourceRowHash",
    ],
    optional: ["assignmentLegacyId", "fileKey"],
  },
  migrationRawAssignmentPointLinks: {
    required: [
      "runId",
      "legacyId",
      "assignmentLegacyId",
      "userLegacyId",
      "pointLegacyId",
      "sourceRowHash",
    ],
    optional: [],
  },
  migrationRawSyllabusEntries: {
    required: [
      "runId",
      "legacyId",
      "userLegacyId",
      "movieLegacyId",
      "order",
      "createdAt",
      "sourceRowHash",
    ],
    optional: ["assignmentLegacyId", "notes"],
  },
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertObject(value, label) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function assertSafeRunId(runId) {
  if (
    typeof runId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,100}$/u.test(runId)
  ) {
    throw new Error("A safe migration run ID is required");
  }
}

function assertPrivatePath(filePath, kind) {
  const stat = fs.lstatSync(filePath);
  if (
    (kind === "file" && !stat.isFile()) ||
    (kind === "directory" && !stat.isDirectory())
  ) {
    throw new Error(`Migration ${kind} has the wrong filesystem type`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(
      `Migration ${kind} must not grant group or world permissions`,
    );
  }
}

function parseJsonLines(contents, table) {
  if (!contents.endsWith("\n")) {
    throw new Error(`${table} JSONL must end with one newline`);
  }
  const body = contents.slice(0, -1);
  if (body.length === 0) {
    return [];
  }
  const lines = body.split("\n");
  if (lines.some((line) => line.length === 0)) {
    throw new Error(`${table} JSONL contains a blank record`);
  }
  return lines.map((line) => {
    try {
      return assertObject(JSON.parse(line), `${table} record`);
    } catch {
      throw new Error(`${table} JSONL contains invalid JSON`);
    }
  });
}

function verifyRecord(record, table, runId, legacyIds) {
  const fields = TABLE_FIELDS[table];
  const allowed = new Set([...fields.required, ...fields.optional]);
  const actualKeys = Object.keys(record);
  for (const required of fields.required) {
    if (!Object.hasOwn(record, required)) {
      throw new Error(`${table} record is missing ${required}`);
    }
  }
  for (const key of actualKeys) {
    if (!allowed.has(key)) {
      throw new Error(`${table} record contains forbidden field ${key}`);
    }
  }
  if (record.runId !== runId) {
    throw new Error(`${table} record belongs to a different run`);
  }
  if (
    typeof record.sourceRowHash !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(record.sourceRowHash)
  ) {
    throw new Error(`${table} record has an invalid source row hash`);
  }
  const {
    runId: ignoredRunId,
    sourceRowHash,
    ...sourceRecord
  } = record;
  void ignoredRunId;
  const expectedRowHash = `sha256:${sha256(
    JSON.stringify(sourceRecord),
  )}`;
  if (sourceRowHash !== expectedRowHash) {
    throw new Error(`${table} record source row hash changed`);
  }
  const legacyKey = `${typeof record.legacyId}:${String(
    record.legacyId,
  )}`;
  if (legacyIds.has(legacyKey)) {
    throw new Error(`${table} contains a duplicate legacy ID`);
  }
  legacyIds.add(legacyKey);
}

export function tablesForDomain(domain) {
  if (!Object.hasOwn(DOMAIN_TABLES, domain)) {
    throw new Error(`Unsupported migration domain ${String(domain)}`);
  }
  return [...DOMAIN_TABLES[domain]];
}

export function verifyDomainManifest({
  projectRoot,
  runId,
  domain,
}) {
  assertSafeRunId(runId);
  const expectedTables = tablesForDomain(domain);
  const runDirectory = path.join(
    projectRoot,
    ".local-migration",
    runId,
  );
  const domainDirectory = path.join(runDirectory, domain);
  assertPrivatePath(runDirectory, "directory");
  assertPrivatePath(domainDirectory, "directory");
  const manifestPath = path.join(domainDirectory, "manifest.json");
  assertPrivatePath(manifestPath, "file");
  const manifest = assertObject(
    JSON.parse(fs.readFileSync(manifestPath, "utf8")),
    "Migration manifest",
  );
  if (
    manifest.formatVersion !== 1 ||
    manifest.domain !== domain ||
    manifest.runId !== runId ||
    manifest.sourceDatabase !== "dev" ||
    manifest.sourceSchemaFingerprint !==
      EXPECTED_SOURCE_FINGERPRINT ||
    manifest.containsProductionDerivedRowValues !== true ||
    manifest.localOnly !== true
  ) {
    throw new Error(
      "Migration manifest does not match the guarded local source",
    );
  }
  if (
    !Array.isArray(manifest.retiredTablesExtracted) ||
    manifest.retiredTablesExtracted.length !== 0
  ) {
    throw new Error(
      "Migration manifest must not contain retired table extracts",
    );
  }
  if (
    typeof manifest.sourceServerFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(manifest.sourceServerFingerprint)
  ) {
    throw new Error(
      "Migration manifest has an invalid server fingerprint",
    );
  }
  if (
    !Number.isFinite(Date.parse(manifest.generatedAt)) ||
    !Number.isFinite(Date.parse(manifest.censusGeneratedAt))
  ) {
    throw new Error("Migration manifest timestamps are invalid");
  }
  if (!Array.isArray(manifest.files)) {
    throw new Error("Migration manifest files must be an array");
  }
  const manifestTables = manifest.files.map((file) => file.table);
  if (
    manifestTables.length !== expectedTables.length ||
    new Set(manifestTables).size !== manifestTables.length ||
    !expectedTables.every((table) => manifestTables.includes(table))
  ) {
    throw new Error(
      "Migration manifest table allowlist does not match the domain",
    );
  }

  const files = manifest.files.map((fileValue) => {
    const file = assertObject(fileValue, "Migration file entry");
    const expectedFileName = `${file.table}.jsonl`;
    if (
      !expectedTables.includes(file.table) ||
      file.fileName !== expectedFileName ||
      !Number.isSafeInteger(file.rowCount) ||
      file.rowCount < 0 ||
      typeof file.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(file.sha256)
    ) {
      throw new Error("Migration file manifest entry is invalid");
    }
    const filePath = path.join(domainDirectory, file.fileName);
    assertPrivatePath(filePath, "file");
    const contents = fs.readFileSync(filePath, "utf8");
    if (sha256(contents) !== file.sha256) {
      throw new Error(`${file.table} checksum changed`);
    }
    const records = parseJsonLines(contents, file.table);
    if (records.length !== file.rowCount) {
      throw new Error(`${file.table} row count changed`);
    }
    const legacyIds = new Set();
    for (const record of records) {
      verifyRecord(record, file.table, runId, legacyIds);
    }
    return Object.freeze({
      table: file.table,
      fileName: file.fileName,
      filePath,
      rowCount: file.rowCount,
      sha256: file.sha256,
    });
  });

  return Object.freeze({
    formatVersion: 1,
    domain,
    runId,
    sourceSchemaFingerprint: EXPECTED_SOURCE_FINGERPRINT,
    files: Object.freeze(files),
  });
}
