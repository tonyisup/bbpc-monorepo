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

function optionalCalendarDate(value, label) {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${label} must be a valid Date or null`);
  }
  const year = String(value.getUTCFullYear()).padStart(4, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function optionalField(value, key) {
  return value === undefined ? {} : { [key]: value };
}

export function transformEpisodeRow(runId, row) {
  const recording = optionalString(
    row.recording,
    "Episode.recording",
  );
  const date = optionalCalendarDate(row.date, "Episode.date");
  const description = optionalString(
    row.description,
    "Episode.description",
  );
  const status = optionalString(row.status, "Episode.status");
  const notes = optionalString(row.notes, "Episode.notes");
  const seoDescription = optionalString(
    row.seoDescription,
    "Episode.seoDescription",
  );
  const seoKeywords = optionalString(
    row.seoKeywords,
    "Episode.seoKeywords",
  );
  const seoTitle = optionalString(row.seoTitle, "Episode.seoTitle");
  const slug = optionalString(row.slug, "Episode.slug");
  return stagedRecord(runId, {
    legacyId: uuid(row.id, "Episode.id"),
    number: smallInt(row.number, "Episode.number"),
    title: requiredString(row.title, "Episode.title"),
    ...optionalField(recording, "recording"),
    ...optionalField(date, "date"),
    ...optionalField(description, "description"),
    ...optionalField(status, "status"),
    ...optionalField(notes, "notes"),
    ...optionalField(seoDescription, "seoDescription"),
    ...optionalField(seoKeywords, "seoKeywords"),
    ...optionalField(seoTitle, "seoTitle"),
    ...optionalField(slug, "slug"),
  });
}

export function transformEpisodeLinkRow(runId, row) {
  const episodeLegacyId = optionalUuid(
    row.episodeId,
    "Link.episodeId",
  );
  return stagedRecord(runId, {
    legacyId: uuid(row.id, "Link.id"),
    url: requiredString(row.url, "Link.url"),
    text: requiredString(row.text, "Link.text"),
    ...optionalField(episodeLegacyId, "episodeLegacyId"),
  });
}

export function transformBangerRow(runId, row) {
  const episodeLegacyId = optionalUuid(
    row.episodeId,
    "Banger.episodeId",
  );
  const userLegacyId = optionalString(row.userId, "Banger.userId");
  return stagedRecord(runId, {
    legacyId: uuid(row.id, "Banger.id"),
    title: requiredString(row.title, "Banger.title"),
    artist: requiredString(row.artist, "Banger.artist"),
    url: requiredString(row.url, "Banger.url"),
    ...optionalField(episodeLegacyId, "episodeLegacyId"),
    ...optionalField(userLegacyId, "userLegacyId"),
  });
}

export function transformEpisodeAudioMessageRow(runId, row) {
  const fileKey = optionalString(
    row.fileKey,
    "AudioEpisodeMessage.fileKey",
  );
  const episodeLegacyId = optionalUuid(
    row.episodeId,
    "AudioEpisodeMessage.episodeId",
  );
  const notes = optionalString(
    row.notes,
    "AudioEpisodeMessage.notes",
  );
  return stagedRecord(runId, {
    legacyId: sqlInt(row.id, "AudioEpisodeMessage.id"),
    url: requiredString(row.url, "AudioEpisodeMessage.url"),
    createdAt: epochMilliseconds(
      row.createdAt,
      "AudioEpisodeMessage.createdAt",
    ),
    ...optionalField(fileKey, "fileKey"),
    userLegacyId: requiredString(
      row.userId,
      "AudioEpisodeMessage.userId",
    ),
    ...optionalField(episodeLegacyId, "episodeLegacyId"),
    ...optionalField(notes, "notes"),
  });
}

export function serializeJsonLines(records) {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
