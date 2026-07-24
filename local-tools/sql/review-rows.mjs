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

function tinyInt(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 255) {
    throw new Error(`${label} must fit the SQL tinyint range`);
  }
  return value;
}

function optionalEpochMilliseconds(value, label) {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${label} must be a valid Date or null`);
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

export function transformRatingRow(runId, row) {
  const sound = optionalString(row.sound, "Rating.sound");
  const icon = optionalString(row.icon, "Rating.icon");
  const category = optionalString(row.category, "Rating.category");
  return stagedRecord(runId, {
    legacyId: uuid(row.id, "Rating.id"),
    name: requiredString(row.name, "Rating.name"),
    value: tinyInt(row.value, "Rating.value"),
    ...optionalField(sound, "sound"),
    ...optionalField(icon, "icon"),
    ...optionalField(category, "category"),
  });
}

export function transformReviewRow(runId, row) {
  const userLegacyId = optionalString(row.userId, "Review.userId");
  const movieLegacyId = optionalUuid(
    row.movieId,
    "Review.movieId",
  );
  const ratingLegacyId = optionalUuid(
    row.ratingId,
    "Review.ratingId",
  );
  const reviewdOn = optionalEpochMilliseconds(
    row.reviewdOn,
    "Review.ReviewdOn",
  );
  const showLegacyId = optionalUuid(row.showId, "Review.showId");
  const reviewedOn = optionalEpochMilliseconds(
    row.reviewedOn,
    "Review.reviewedOn",
  );
  if (
    (movieLegacyId === undefined) ===
    (showLegacyId === undefined)
  ) {
    throw new Error(
      "Review must reference exactly one movie or show",
    );
  }
  return stagedRecord(runId, {
    legacyId: uuid(row.id, "Review.id"),
    ...optionalField(userLegacyId, "userLegacyId"),
    ...optionalField(movieLegacyId, "movieLegacyId"),
    ...optionalField(ratingLegacyId, "ratingLegacyId"),
    ...optionalField(reviewdOn, "reviewdOn"),
    ...optionalField(showLegacyId, "showLegacyId"),
    ...optionalField(reviewedOn, "reviewedOn"),
  });
}

export function transformAssignmentReviewRow(runId, row) {
  return stagedRecord(runId, {
    legacyId: uuid(row.id, "AssignmentReview.id"),
    assignmentLegacyId: uuid(
      row.assignmentId,
      "AssignmentReview.assignmentId",
    ),
    reviewLegacyId: uuid(
      row.reviewId,
      "AssignmentReview.reviewId",
    ),
  });
}

export function transformExtraReviewRow(runId, row) {
  return stagedRecord(runId, {
    legacyId: uuid(row.id, "ExtraReview.id"),
    reviewLegacyId: uuid(row.reviewId, "ExtraReview.reviewId"),
    episodeLegacyId: uuid(
      row.episodeId,
      "ExtraReview.episodeId",
    ),
  });
}

export function serializeJsonLines(records) {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
