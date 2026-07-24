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

function requiredBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
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

export function transformUserRow(runId, row) {
  const record = {
    legacyId: requiredString(row.id, "User.id"),
    ...(() => {
      const name = optionalString(row.name, "User.name");
      return name === undefined ? {} : { name };
    })(),
    ...(() => {
      const email = optionalString(row.email, "User.email");
      return email === undefined ? {} : { email };
    })(),
    ...(() => {
      const emailVerifiedAt = optionalEpochMilliseconds(
        row.emailVerified,
        "User.emailVerified",
      );
      return emailVerifiedAt === undefined
        ? {}
        : { emailVerifiedAt };
    })(),
    ...(() => {
      const image = optionalString(row.image, "User.image");
      return image === undefined ? {} : { image };
    })(),
  };
  return stagedRecord(runId, record);
}

export function transformRoleRow(runId, row) {
  const legacyId = requiredInteger(row.id, "Role.id");
  if (legacyId < 0 || legacyId > 255) {
    throw new Error("Role.id must fit the SQL tinyint range");
  }
  return stagedRecord(runId, {
    legacyId,
    name: requiredString(row.name, "Role.name"),
    description: stringValue(
      row.description,
      "Role.description",
    ),
    admin: requiredBoolean(row.admin, "Role.admin"),
  });
}

export function transformUserRoleRow(runId, row) {
  const roleLegacyId = requiredInteger(
    row.roleId,
    "UserRole.roleId",
  );
  if (roleLegacyId < 0 || roleLegacyId > 255) {
    throw new Error("UserRole.roleId must fit the SQL tinyint range");
  }
  return stagedRecord(runId, {
    legacyId: uuid(row.id, "UserRole.id"),
    userLegacyId: requiredString(row.userId, "UserRole.userId"),
    roleLegacyId,
  });
}

export function serializeJsonLines(records) {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
