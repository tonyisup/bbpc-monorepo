import { createHash } from "node:crypto";

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalString(value, label) {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string or null`);
  }
  return value;
}

function requiredInteger(value, label) {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer`);
  }
  return value;
}

function smallInt(value, label) {
  const integer = requiredInteger(value, label);
  if (integer < -32_768 || integer > 32_767) {
    throw new Error(`${label} must fit the SQL smallint range`);
  }
  return integer;
}

function sqlInt(value, label) {
  const integer = requiredInteger(value, label);
  if (integer < -2_147_483_648 || integer > 2_147_483_647) {
    throw new Error(`${label} must fit the SQL int range`);
  }
  return integer;
}

function optionalSqlInt(value, label) {
  if (value === null || value === undefined) {
    return undefined;
  }
  return sqlInt(value, label);
}

function epochMilliseconds(value, label) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${label} must be a valid Date`);
  }
  return value.getTime();
}

function uuid(value, label) {
  const normalized = requiredString(value, label).toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
      normalized,
    )
  ) {
    throw new Error(`${label} must be a UUID`);
  }
  return normalized;
}

function rowHash(record) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(record))
    .digest("hex")}`;
}

function stagedRecord(runId, record) {
  return {
    runId: requiredString(runId, "runId"),
    ...record,
    sourceRowHash: rowHash(record),
  };
}

export function transformMovieRow(runId, row) {
  const poster = optionalString(row.poster, "Movie.poster");
  const tmdbId = optionalSqlInt(row.tmdbId, "Movie.tmdbId");
  return stagedRecord(runId, {
    legacyId: uuid(row.id, "Movie.id"),
    title: requiredString(row.title, "Movie.title"),
    year: smallInt(row.year, "Movie.year"),
    ...(poster === undefined ? {} : { poster }),
    url: requiredString(row.url, "Movie.url"),
    ...(tmdbId === undefined ? {} : { tmdbId }),
  });
}

export function transformShowRow(runId, row) {
  const poster = optionalString(row.poster, "Show.poster");
  return stagedRecord(runId, {
    legacyId: uuid(row.id, "Show.id"),
    title: requiredString(row.title, "Show.title"),
    year: smallInt(row.year, "Show.year"),
    ...(poster === undefined ? {} : { poster }),
    url: requiredString(row.url, "Show.url"),
  });
}

export function transformTagRow(runId, row) {
  const description = optionalString(
    row.description,
    "Tag.description",
  );
  return stagedRecord(runId, {
    legacyId: uuid(row.id, "Tag.id"),
    name: requiredString(row.name, "Tag.name"),
    ...(description === undefined ? {} : { description }),
    createdAt: epochMilliseconds(row.createdAt, "Tag.createdAt"),
  });
}

export function serializeJsonLines(records) {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
