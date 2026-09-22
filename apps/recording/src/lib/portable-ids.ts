/**
 * Browser-generated identifiers sent to the recording backend (event IDs, RTC
 * signal and disconnect IDs, per-tab event sources). They must satisfy the
 * shared RECORDING_PORTABLE_ID_PATTERN: letters, digits, `_` and `-` only.
 */
export function createPortableId(...parts: string[]): string {
  const randomPart = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return [...parts, Date.now().toString(36), randomPart]
    .map(part => part.replace(/[^A-Za-z0-9_-]+/g, '-'))
    .join('-');
}
