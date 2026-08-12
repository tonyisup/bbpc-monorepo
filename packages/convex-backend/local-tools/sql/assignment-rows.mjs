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

export function transformAssignmentRow(runId, row) {
  const slug = optionalString(row.slug, "Assignment.slug");
  return stagedRecord(runId, {
    legacyId: uuid(row.id, "Assignment.id"),
    ...optionalField(slug, "slug"),
    userLegacyId: requiredString(
      row.userId,
      "Assignment.userId",
    ),
    episodeLegacyId: uuid(
      row.episodeId,
      "Assignment.episodeId",
    ),
    movieLegacyId: uuid(row.movieId, "Assignment.movieId"),
    type: requiredString(row.type, "Assignment.type"),
    playable: requiredBoolean(
      row.playable,
      "Assignment.playable",
    ),
  });
}

export function transformAssignmentAudioMessageRow(runId, row) {
  const assignmentLegacyId = optionalUuid(
    row.assignmentId,
    "AudioMessage.assignmentId",
  );
  const fileKey = optionalString(row.fileKey, "AudioMessage.fileKey");
  return stagedRecord(runId, {
    legacyId: sqlInt(row.id, "AudioMessage.id"),
    url: requiredString(row.url, "AudioMessage.url"),
    createdAt: epochMilliseconds(
      row.createdAt,
      "AudioMessage.createdAt",
    ),
    userLegacyId: requiredString(
      row.userId,
      "AudioMessage.userId",
    ),
    ...optionalField(assignmentLegacyId, "assignmentLegacyId"),
    ...optionalField(fileKey, "fileKey"),
  });
}

export function transformAssignmentPointLinkRow(runId, row) {
  return stagedRecord(runId, {
    legacyId: uuid(row.id, "AssignmentPoints.id"),
    assignmentLegacyId: uuid(
      row.assignmentId,
      "AssignmentPoints.assignmentId",
    ),
    userLegacyId: requiredString(
      row.userId,
      "AssignmentPoints.userId",
    ),
    pointLegacyId: uuid(
      row.pointsId,
      "AssignmentPoints.pointsId",
    ),
  });
}

export function transformSyllabusEntryRow(runId, row) {
  const assignmentLegacyId = optionalUuid(
    row.assignmentId,
    "Syllabus.assignmentId",
  );
  const notes = optionalString(row.notes, "Syllabus.notes");
  return stagedRecord(runId, {
    legacyId: uuid(row.id, "Syllabus.id"),
    userLegacyId: requiredString(row.userId, "Syllabus.userId"),
    movieLegacyId: uuid(row.movieId, "Syllabus.movieId"),
    order: sqlInt(row.order, "Syllabus.order"),
    createdAt: epochMilliseconds(
      row.createdAt,
      "Syllabus.createdAt",
    ),
    ...optionalField(assignmentLegacyId, "assignmentLegacyId"),
    ...optionalField(notes, "notes"),
  });
}

export function serializeJsonLines(records) {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
