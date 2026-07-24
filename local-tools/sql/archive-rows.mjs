import { createHash } from "node:crypto";

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function stringValue(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function sqlInt(value, label) {
  if (
    !Number.isSafeInteger(value) ||
    value < -2_147_483_648 ||
    value > 2_147_483_647
  ) {
    throw new Error(`${label} must fit the SQL int range`);
  }
  return value;
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

function optionalUuid(value, label) {
  if (value === null || value === undefined) {
    return undefined;
  }
  return uuid(value, label);
}

function epochMilliseconds(value, label) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${label} must be a valid Date`);
  }
  return value.getTime();
}

function rowHash(record) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(record))
    .digest("hex")}`;
}

function optionalField(value, key) {
  return value === undefined ? {} : { [key]: value };
}

export function transformArchivePostRow(runId, row) {
  const legacyId = sqlInt(row.id, "Archive.Posts.ID");
  if (legacyId < 1) {
    throw new Error("Archive.Posts.ID must be positive");
  }
  const episodeLegacyId = optionalUuid(
    row.episodeId,
    "Archive.Posts.EpisodeID",
  );
  const record = {
    legacyId,
    postedAt: epochMilliseconds(
      row.postedOn,
      "Archive.Posts.PostedOn",
    ),
    content: stringValue(row.content, "Archive.Posts.Content"),
    title: stringValue(row.title, "Archive.Posts.Title"),
    ...optionalField(episodeLegacyId, "episodeLegacyId"),
  };
  return {
    runId: requiredString(runId, "runId"),
    ...record,
    sourceRowHash: rowHash(record),
  };
}

export function serializeJsonLines(records) {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
