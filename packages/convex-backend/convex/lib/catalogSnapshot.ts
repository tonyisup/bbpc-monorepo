import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

/** Catalog and movie-reference documents contain only scalar fields. */
export function catalogSnapshotFingerprint(
  documents: ReadonlyArray<Record<string, unknown>>
): string {
  const rows = documents.map((document) => {
    const entries = Object.entries(document).filter(
      ([, value]) => value !== undefined
    );
    if (
      entries.some(([, value]) => value !== null && typeof value === "object")
    ) {
      throw new Error("Catalog snapshots require scalar document fields.");
    }
    return JSON.stringify(
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    );
  });
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify(rows.sort()))));
}
