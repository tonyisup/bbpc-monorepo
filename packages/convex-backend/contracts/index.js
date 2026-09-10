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
