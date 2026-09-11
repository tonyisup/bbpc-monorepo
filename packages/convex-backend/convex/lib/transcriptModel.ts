// Shared by the Convex boundary and the Node 22 importer (no runtime imports).
export const TRANSCRIPT_VERSION = "passages-v1";
export const MAX_TRANSCRIPT_PASSAGES = 400;
export const MAX_TRANSCRIPT_BYTES = 512 * 1024;
export const MAX_PASSAGE_BYTES = 2000;
export interface TranscriptPassage {
  start: number;
  end: number;
  text: string;
}

const encoder = new TextEncoder();
/** Measure text using the UTF-8 byte limits enforced by Convex. */
const bytes = (text: string) => encoder.encode(text).length;

/** Parse and validate one raw transcript segment. */
function segment(value: unknown, index: number): TranscriptPassage {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Segment ${String(index)}: expected an object.`);
  }
  const item = value as Record<string, unknown>;
  if (
    typeof item.text !== "string" ||
    typeof item.start !== "number" ||
    typeof item.end !== "number" ||
    !Number.isFinite(item.start) ||
    !Number.isFinite(item.end) ||
    item.start < 0 ||
    item.end < item.start ||
    /\p{Surrogate}/u.test(item.text)
  ) {
    throw new Error(`Segment ${String(index)}: invalid text or timestamps.`);
  }
  return { start: item.start, end: item.end, text: item.text };
}

/** Validate bounded, ordered passages accepted by the transcript API. */
export function validatePassages(value: unknown): TranscriptPassage[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_TRANSCRIPT_PASSAGES
  ) {
    throw new Error(
      `Transcript must contain 1–${String(MAX_TRANSCRIPT_PASSAGES)} passages.`
    );
  }
  let total = 0;
  let previousStart = -1;
  return value.map((item, index) => {
    const passage = segment(item, index);
    const size = bytes(passage.text);
    total += size;
    if (
      !passage.text.trim() ||
      size > MAX_PASSAGE_BYTES ||
      total > MAX_TRANSCRIPT_BYTES ||
      passage.start < previousStart
    ) {
      throw new Error(
        `Segment ${String(index)}: empty, oversized, or out of order.`
      );
    }
    previousStart = passage.start;
    return passage;
  });
}

/** Convert raw transcript segments into bounded, searchable passages. */
export function buildPassages(value: unknown): {
  segmentCount: number;
  passages: TranscriptPassage[];
} {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50_000) {
    throw new Error("Expected an array of 1–50000 transcript segments.");
  }
  let previousStart = -1;
  let total = 0;
  const pieces: TranscriptPassage[] = [];
  value.forEach((item, index) => {
    const parsed = segment(item, index);
    if (parsed.start < previousStart)
      throw new Error(`Segment ${String(index)}: timestamps are out of order.`);
    previousStart = parsed.start;
    total += bytes(parsed.text);
    if (total > MAX_TRANSCRIPT_BYTES)
      throw new Error(`Segment ${String(index)}: transcript exceeds 512 KiB.`);
    if (!parsed.text.trim()) return;
    // Split at whitespace where possible, falling back to whole Unicode code points.
    let text = "";
    for (const token of parsed.text.match(/\s+|\S+/gu) ?? []) {
      if (bytes(text + token) > MAX_PASSAGE_BYTES && text) {
        pieces.push({ ...parsed, text });
        text = "";
      }
      for (const point of token) {
        if (bytes(text + point) > MAX_PASSAGE_BYTES) {
          if (text.trim()) pieces.push({ ...parsed, text });
          text = "";
        }
        text += point;
      }
    }
    if (text.trim()) pieces.push({ ...parsed, text });
  });
  const passages: TranscriptPassage[] = [];
  let group: TranscriptPassage[] = [];
  const joined = (items: TranscriptPassage[]) =>
    items.map((p) => p.text).join(" ");
  const flush = () => {
    const first = group.at(0);
    if (!first) return;
    // The source byte ceiling alone cannot bound grouping with overlap. Reject
    // at capacity before constructing another passage or calling validatePassages.
    if (passages.length === MAX_TRANSCRIPT_PASSAGES) {
      throw new Error(
        `Transcript exceeds the ${String(MAX_TRANSCRIPT_PASSAGES)}-passage capacity after grouping and overlap, even if source text is within 512 KiB.`
      );
    }
    passages.push({
      start: first.start,
      end: Math.max(...group.map((p) => p.end)),
      text: joined(group),
    });
  };
  for (const piece of pieces) {
    if (
      group.length &&
      (bytes(joined(group)) >= 800 ||
        bytes(joined([...group, piece])) > MAX_PASSAGE_BYTES)
    ) {
      flush();
      const overlap = group.length > 1 ? group.at(-1) : null;
      group =
        overlap && bytes(joined([overlap, piece])) <= MAX_PASSAGE_BYTES
          ? [overlap]
          : [];
    }
    group.push(piece);
  }
  flush();
  return { segmentCount: value.length, passages: validatePassages(passages) };
}

/** Serialize a transcript into the canonical input used for content hashing. */
export function transcriptFingerprintInput(
  passages: TranscriptPassage[]
): string {
  return JSON.stringify({ version: TRANSCRIPT_VERSION, passages });
}

/** Extract normalized Unicode letter and number terms from a search query. */
export function transcriptTerms(query: string): string[] {
  return query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Normalize a search query and enforce its public resource limits. */
export function validateTranscriptQuery(query: string): string {
  const normalized = query.trim();
  if (
    normalized.length > 256 ||
    transcriptTerms(normalized).length > 16 ||
    transcriptTerms(normalized).some((word) => word.length > 32)
  ) {
    throw new Error(
      "Use up to 16 words, 32 characters per word, and 256 characters total."
    );
  }
  return normalized;
}
