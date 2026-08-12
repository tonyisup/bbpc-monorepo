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

function requiredBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function optionalBoolean(value, label) {
  if (value === null || value === undefined) {
    return undefined;
  }
  return requiredBoolean(value, label);
}

function tinyInt(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 255) {
    throw new Error(`${label} must fit the SQL tinyint range`);
  }
  return value;
}

function optionalTinyInt(value, label) {
  if (value === null || value === undefined) {
    return undefined;
  }
  return tinyInt(value, label);
}

function smallInt(value, label) {
  if (
    !Number.isSafeInteger(value) ||
    value < -32_768 ||
    value > 32_767
  ) {
    throw new Error(`${label} must fit the SQL smallint range`);
  }
  return value;
}

function optionalSmallInt(value, label) {
  if (value === null || value === undefined) {
    return undefined;
  }
  return smallInt(value, label);
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

function optionalSqlInt(value, label) {
  if (value === null || value === undefined) {
    return undefined;
  }
  return sqlInt(value, label);
}

function finiteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
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

export function transformGameTypeRow(runId, row) {
  const description = optionalString(
    row.description,
    "GameType.description",
  );
  return stagedRecord(runId, {
    legacyId: tinyInt(row.id, "GameType.id"),
    title: requiredString(row.title, "GameType.title"),
    ...optionalField(description, "description"),
    lookupId: requiredString(row.lookupID, "GameType.lookupID"),
  });
}

export function transformGamePointTypeRow(runId, row) {
  const description = optionalString(
    row.description,
    "GamePointType.description",
  );
  return stagedRecord(runId, {
    legacyId: tinyInt(row.id, "GamePointType.id"),
    lookupId: requiredString(
      row.lookupID,
      "GamePointType.lookupID",
    ),
    title: requiredString(row.title, "GamePointType.title"),
    ...optionalField(description, "description"),
    points: smallInt(row.points, "GamePointType.points"),
    gameTypeLegacyId: tinyInt(
      row.gameTypeId,
      "GamePointType.gameTypeId",
    ),
  });
}

export function transformSeasonRow(runId, row) {
  const description = optionalString(
    row.description,
    "Season.description",
  );
  const endedOn = optionalCalendarDate(row.endedOn, "Season.endedOn");
  const startedOn = optionalCalendarDate(
    row.startedOn,
    "Season.startedOn",
  );
  return stagedRecord(runId, {
    legacyId: uuid(row.id, "Season.id"),
    title: requiredString(row.title, "Season.title"),
    ...optionalField(description, "description"),
    gameTypeLegacyId: tinyInt(
      row.gameTypeId,
      "Season.gameTypeId",
    ),
    ...optionalField(endedOn, "endedOn"),
    ...optionalField(startedOn, "startedOn"),
  });
}

export function transformPointRow(runId, row) {
  const reason = optionalString(row.reason, "Point.reason");
  const gamePointTypeLegacyId = optionalTinyInt(
    row.gamePointTypeId,
    "Point.gamePointTypeId",
  );
  const adjustment =
    row.adjustment === null || row.adjustment === undefined
      ? null
      : sqlInt(row.adjustment, "Point.adjustment");
  return stagedRecord(runId, {
    legacyId: uuid(row.id, "Point.id"),
    userLegacyId: requiredString(row.userId, "Point.userId"),
    seasonLegacyId: uuid(row.seasonId, "Point.seasonId"),
    ...optionalField(reason, "reason"),
    earnedAt: epochMilliseconds(row.earnedOn, "Point.earnedOn"),
    adjustment,
    ...optionalField(
      gamePointTypeLegacyId,
      "gamePointTypeLegacyId",
    ),
  });
}

export function transformGuessRow(runId, row) {
  const pointLegacyId = optionalUuid(
    row.pointsId,
    "Guess.pointsId",
  );
  return stagedRecord(runId, {
    legacyId: uuid(row.id, "Guess.id"),
    ratingLegacyId: uuid(row.ratingId, "Guess.ratingId"),
    createdAt: epochMilliseconds(row.created, "Guess.created"),
    userLegacyId: requiredString(row.userId, "Guess.userId"),
    assignmentReviewLegacyId: uuid(
      row.assignmntReviewId,
      "Guess.assignmntReviewId",
    ),
    seasonLegacyId: uuid(row.seasonId, "Guess.seasonId"),
    ...optionalField(pointLegacyId, "pointLegacyId"),
  });
}

export function transformGamblingTypeRow(runId, row) {
  const description = optionalString(
    row.description,
    "GamblingType.description",
  );
  return stagedRecord(runId, {
    legacyId: uuid(row.id, "GamblingType.id"),
    lookupId: requiredString(
      row.lookupId,
      "GamblingType.lookupId",
    ),
    title: requiredString(row.title, "GamblingType.title"),
    ...optionalField(description, "description"),
    multiplier: finiteNumber(
      row.multiplier,
      "GamblingType.multiplier",
    ),
    isActive: requiredBoolean(
      row.isActive,
      "GamblingType.isActive",
    ),
    createdAt: epochMilliseconds(
      row.createdAt,
      "GamblingType.createdAt",
    ),
  });
}

export function transformGamblingEntryRow(runId, row) {
  const assignmentLegacyId = optionalUuid(
    row.assignmentId,
    "GamblingPoints.assignmentId",
  );
  const pointLegacyId = optionalUuid(
    row.pointsId,
    "GamblingPoints.pointsId",
  );
  const seasonLegacyId = optionalUuid(
    row.seasonId,
    "GamblingPoints.seasonId",
  );
  const notes = optionalString(row.notes, "GamblingPoints.notes");
  const targetUserLegacyId = optionalString(
    row.targetUserId,
    "GamblingPoints.targetUserId",
  );
  return stagedRecord(runId, {
    legacyId: uuid(row.id, "GamblingPoints.id"),
    userLegacyId: requiredString(
      row.userId,
      "GamblingPoints.userId",
    ),
    ...optionalField(assignmentLegacyId, "assignmentLegacyId"),
    points: sqlInt(row.points, "GamblingPoints.points"),
    createdAt: epochMilliseconds(
      row.createdAt,
      "GamblingPoints.createdAt",
    ),
    ...optionalField(pointLegacyId, "pointLegacyId"),
    ...optionalField(seasonLegacyId, "seasonLegacyId"),
    ...optionalField(notes, "notes"),
    gamblingTypeLegacyId: uuid(
      row.gamblingTypeId,
      "GamblingPoints.gamblingTypeId",
    ),
    ...optionalField(targetUserLegacyId, "targetUserLegacyId"),
    status: requiredString(row.status, "GamblingPoints.status"),
  });
}

export function transformTagVoteRow(runId, row) {
  const isTag = optionalBoolean(row.isTag, "TagVote.isTag");
  const sessionId = optionalString(row.sessionId, "TagVote.sessionId");
  const userLegacyId = optionalString(row.userId, "TagVote.userId");
  const pointLegacyId = optionalUuid(row.pointId, "TagVote.pointId");
  return stagedRecord(runId, {
    legacyId: uuid(row.id, "TagVote.id"),
    tag: requiredString(row.tag, "TagVote.tag"),
    tmdbId: sqlInt(row.tmdbId, "TagVote.tmdbId"),
    ...optionalField(isTag, "isTag"),
    createdAt: epochMilliseconds(row.createdAt, "TagVote.createdAt"),
    ...optionalField(sessionId, "sessionId"),
    ...optionalField(userLegacyId, "userLegacyId"),
    ...optionalField(pointLegacyId, "pointLegacyId"),
  });
}

export function transformQuoteSubmissionRow(runId, row) {
  const sourceType = requiredString(
    row.sourceType,
    "QuoteSubmission.sourceType",
  );
  if (!["MOVIE", "TV", "OTHER"].includes(sourceType)) {
    throw new Error("QuoteSubmission.sourceType violates its SQL check");
  }
  const status = requiredString(row.status, "QuoteSubmission.status");
  if (!["SUBMITTED", "INCLUDED", "REJECTED"].includes(status)) {
    throw new Error("QuoteSubmission.status violates its SQL check");
  }
  const clipUrl = optionalString(
    row.clipUrl,
    "QuoteSubmission.clipUrl",
  );
  const clipStartSeconds = optionalSqlInt(
    row.clipStartSeconds,
    "QuoteSubmission.clipStartSeconds",
  );
  if (clipStartSeconds !== undefined && clipStartSeconds < 0) {
    throw new Error(
      "QuoteSubmission.clipStartSeconds violates its SQL check",
    );
  }
  const listenerNotes = optionalString(
    row.listenerNotes,
    "QuoteSubmission.listenerNotes",
  );
  const bracketOrder = optionalSmallInt(
    row.bracketOrder,
    "QuoteSubmission.bracketOrder",
  );
  const placement = optionalTinyInt(
    row.placement,
    "QuoteSubmission.placement",
  );
  if (
    placement !== undefined &&
    (placement < 1 || placement > 3)
  ) {
    throw new Error("QuoteSubmission.placement violates its SQL check");
  }
  const adminNotes = optionalString(
    row.adminNotes,
    "QuoteSubmission.adminNotes",
  );
  const pointLegacyId = optionalUuid(
    row.pointId,
    "QuoteSubmission.pointId",
  );
  return stagedRecord(runId, {
    legacyId: uuid(row.id, "QuoteSubmission.id"),
    userLegacyId: requiredString(
      row.userId,
      "QuoteSubmission.userId",
    ),
    episodeLegacyId: uuid(
      row.episodeId,
      "QuoteSubmission.episodeId",
    ),
    seasonLegacyId: uuid(
      row.seasonId,
      "QuoteSubmission.seasonId",
    ),
    quoteText: requiredString(
      row.quoteText,
      "QuoteSubmission.quoteText",
    ),
    sourceTitle: requiredString(
      row.sourceTitle,
      "QuoteSubmission.sourceTitle",
    ),
    sourceType,
    ...optionalField(clipUrl, "clipUrl"),
    ...optionalField(clipStartSeconds, "clipStartSeconds"),
    ...optionalField(listenerNotes, "listenerNotes"),
    status,
    ...optionalField(bracketOrder, "bracketOrder"),
    ...optionalField(placement, "placement"),
    ...optionalField(adminNotes, "adminNotes"),
    ...optionalField(pointLegacyId, "pointLegacyId"),
    createdAt: epochMilliseconds(
      row.createdAt,
      "QuoteSubmission.createdAt",
    ),
    updatedAt: epochMilliseconds(
      row.updatedAt,
      "QuoteSubmission.updatedAt",
    ),
  });
}

export function serializeJsonLines(records) {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
