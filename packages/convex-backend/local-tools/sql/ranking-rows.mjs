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

export function transformRankedListTypeRow(runId, row) {
  const description = optionalString(
    row.description,
    "RankedListType.description",
  );
  const maxItems = sqlInt(
    row.maxItems,
    "RankedListType.maxItems",
  );
  if (maxItems < 1 || maxItems > 100) {
    throw new Error(
      "RankedListType.maxItems must be from 1 through 100",
    );
  }
  const targetType = requiredString(
    row.targetType,
    "RankedListType.targetType",
  );
  if (!["MOVIE", "SHOW", "EPISODE"].includes(targetType)) {
    throw new Error("RankedListType.targetType is not supported");
  }
  return stagedRecord(runId, {
    legacyId: uuid(row.id, "RankedListType.id"),
    name: requiredString(row.name, "RankedListType.name"),
    ...optionalField(description, "description"),
    maxItems,
    targetType,
    createdAt: epochMilliseconds(
      row.createdAt,
      "RankedListType.createdAt",
    ),
    updatedAt: epochMilliseconds(
      row.updatedAt,
      "RankedListType.updatedAt",
    ),
  });
}

export function transformRankedListRow(runId, row) {
  const status = requiredString(row.status, "RankedList.status");
  if (!["DRAFT", "PUBLISHED"].includes(status)) {
    throw new Error("RankedList.status is not supported");
  }
  const title = optionalString(row.title, "RankedList.title");
  return stagedRecord(runId, {
    legacyId: uuid(row.id, "RankedList.id"),
    userLegacyId: requiredString(row.userId, "RankedList.userId"),
    rankedListTypeLegacyId: uuid(
      row.rankedListTypeId,
      "RankedList.rankedListTypeId",
    ),
    status,
    ...optionalField(title, "title"),
    createdAt: epochMilliseconds(
      row.createdAt,
      "RankedList.createdAt",
    ),
    updatedAt: epochMilliseconds(
      row.updatedAt,
      "RankedList.updatedAt",
    ),
  });
}

export function transformRankedItemRow(runId, row) {
  const movieLegacyId = optionalUuid(
    row.movieId,
    "RankedItem.movieId",
  );
  const showLegacyId = optionalUuid(
    row.showId,
    "RankedItem.showId",
  );
  const episodeLegacyId = optionalUuid(
    row.episodeId,
    "RankedItem.episodeId",
  );
  const targetCount =
    (movieLegacyId === undefined ? 0 : 1) +
    (showLegacyId === undefined ? 0 : 1) +
    (episodeLegacyId === undefined ? 0 : 1);
  if (targetCount !== 1) {
    throw new Error(
      "RankedItem must reference exactly one movie, show, or episode",
    );
  }
  const rank = sqlInt(row.rank, "RankedItem.rank");
  if (rank < 1) {
    throw new Error("RankedItem.rank must be positive");
  }
  const comment = optionalString(row.comment, "RankedItem.comment");
  return stagedRecord(runId, {
    legacyId: uuid(row.id, "RankedItem.id"),
    rankedListLegacyId: uuid(
      row.rankedListId,
      "RankedItem.rankedListId",
    ),
    ...optionalField(movieLegacyId, "movieLegacyId"),
    ...optionalField(showLegacyId, "showLegacyId"),
    ...optionalField(episodeLegacyId, "episodeLegacyId"),
    rank,
    ...optionalField(comment, "comment"),
    createdAt: epochMilliseconds(
      row.createdAt,
      "RankedItem.createdAt",
    ),
    updatedAt: epochMilliseconds(
      row.updatedAt,
      "RankedItem.updatedAt",
    ),
  });
}

export function serializeJsonLines(records) {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
