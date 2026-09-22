export const BBPC_API_VERSION = "0.1.0";

// HTML fields and validated JSON DTOs carry IDs as strings. Restore the table
// brand at that boundary; Convex still validates table membership on the server.
export function documentId(table, value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid ${table} identifier.`);
  }
  return value;
}

// Recording session, client, event and RTC signal identifiers. Browser-generated
// IDs must satisfy this before they reach the recording backend.
export const RECORDING_PORTABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

export function isRecordingPortableId(value) {
  return typeof value === "string" && RECORDING_PORTABLE_ID_PATTERN.test(value);
}
