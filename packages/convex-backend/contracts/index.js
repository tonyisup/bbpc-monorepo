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

// Recording audio is stored per take, one blob per track, named from values
// fixed for the take. The upload route writes this name and the backend
// accepts no other, so a participant can only describe its own takes.
export const RECORDING_TAKE_EXTENSIONS = ["webm", "ogg", "m4a"];

export function recordingTakeBlobName({ sessionId, clientId, startedAt, trackType, extension }) {
  const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, "-");
  const participant = clientId
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 80) || "participant";
  return `${sessionId}/${stamp}/take-${participant}-${trackType}.${extension}`;
}
