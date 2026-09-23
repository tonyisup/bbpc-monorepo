import { transcriptTerms } from "../lib/transcriptModel.js";
import type { QuoteStatus } from "./quoteWriteModel.js";

const MIN_QUOTE_SIMILARITY_LENGTH = 8;
const MAX_QUOTE_SEARCH_ANCHORS = 3;
const MAX_TRANSCRIPT_SEARCH_TERMS = 16;
// Convex full-text search accepts terms of up to 32 characters.
const MAX_SEARCH_TERM_LENGTH = 32;
// Long entries are usually scene descriptions; their opening words are enough to
// find a reading on air, and matching more would only cost query time.
const MAX_TRANSCRIPT_QUOTE_TOKENS = 60;
const TRANSCRIPT_WINDOW_SLACK = 2;
const TRANSCRIPT_WINDOWS_TO_REFINE = 3;
const TRANSCRIPT_EXCERPT_CONTEXT_WORDS = 8;
const SHORT_TRANSCRIPT_QUOTE_TOKENS = 4;

export const QUOTE_MATCH_THRESHOLD = 0.68;
export const TRANSCRIPT_MATCH_THRESHOLD = 0.72;
export const SHORT_TRANSCRIPT_MATCH_THRESHOLD = 0.9;
export const REUSE_EVIDENCE_FLOOR = 0.6;

// How much one piece of matching evidence suggests the quote was used on air.
const PLAYED_SUBMISSION_WEIGHT = 0.95;
const PENDING_SUBMISSION_WEIGHT = 0.6;
const REJECTED_SUBMISSION_WEIGHT = 0.35;
const SOURCE_TITLE_MISMATCH_WEIGHT = 0.5;
const SUBMISSION_STATUS_WEIGHTS: Record<QuoteStatus, number> = {
  INCLUDED: PLAYED_SUBMISSION_WEIGHT,
  SUBMITTED: PENDING_SUBMISSION_WEIGHT,
  REJECTED: REJECTED_SUBMISSION_WEIGHT,
};
const TRANSCRIPT_WEIGHT = 0.9;
const SHORT_TRANSCRIPT_WEIGHT = 0.45;

const SEARCH_STOP_WORDS = new Set([
  "and",
  "are",
  "but",
  "for",
  "from",
  "have",
  "not",
  "that",
  "the",
  "this",
  "was",
  "what",
  "when",
  "where",
  "with",
  "you",
  "your",
]);

function normalizeSimilarityText(value: string): string {
  return value
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019'`\u00b4]/gu, "")
    .replace(/&/gu, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function normalizeSourceTitle(value: string): string {
  const normalized = normalizeSimilarityText(value);
  return normalized.replace(/^(?:a|an|the)\s+/u, "");
}

function similarityTokens(value: string): string[] {
  return value.length === 0 ? [] : value.split(" ");
}

function tokenDice(left: string, right: string): number {
  const leftTokens = new Set(similarityTokens(left));
  const rightTokens = new Set(similarityTokens(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      shared += 1;
    }
  }
  return (2 * shared) / (leftTokens.size + rightTokens.size);
}

function ngramCounts(value: string, size: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (let index = 0; index <= value.length - size; index += 1) {
    const gram = value.slice(index, index + size);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

// Takes the left side's n-gram counts so a caller comparing one quote with many
// windows builds them once.
function ngramDiceWithCounts(
  left: string,
  leftCounts: ReadonlyMap<string, number>,
  right: string,
  size: number,
): number {
  if (left.length < size || right.length < size) {
    return left === right ? 1 : 0;
  }
  const used = new Map<string, number>();
  let shared = 0;
  for (let index = 0; index <= right.length - size; index += 1) {
    const gram = right.slice(index, index + size);
    const usedCount = used.get(gram) ?? 0;
    if (usedCount < (leftCounts.get(gram) ?? 0)) {
      shared += 1;
      used.set(gram, usedCount + 1);
    }
  }
  return (
    (2 * shared) /
    (left.length - size + 1 + (right.length - size + 1))
  );
}

function ngramDice(left: string, right: string, size: number): number {
  return ngramDiceWithCounts(left, ngramCounts(left, size), right, size);
}

function lengthRatio(left: string, right: string): number {
  return (
    Math.min(left.length, right.length) /
    Math.max(left.length, right.length)
  );
}

export function sourceTitlesPossiblyMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizeSourceTitle(left);
  const normalizedRight = normalizeSourceTitle(right);
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  const shorter =
    normalizedLeft.length <= normalizedRight.length
      ? normalizedLeft
      : normalizedRight;
  const longer = shorter === normalizedLeft ? normalizedRight : normalizedLeft;
  if (
    shorter.length >= 4 &&
    ` ${longer} `.includes(` ${shorter} `)
  ) {
    return true;
  }
  return (
    tokenDice(normalizedLeft, normalizedRight) >= 0.75 ||
    ngramDice(normalizedLeft, normalizedRight, 3) >= 0.72
  );
}

export function quoteSearchAnchors(value: string): string[] {
  const normalized = normalizeSimilarityText(value);
  if (normalized.length < MIN_QUOTE_SIMILARITY_LENGTH) {
    return [];
  }
  const tokens = [...new Set(similarityTokens(normalized))].filter(
    (token) => token.length <= MAX_SEARCH_TERM_LENGTH,
  );
  const meaningful: string[] = [];
  for (const token of tokens) {
    if (token.length >= 3 && !SEARCH_STOP_WORDS.has(token)) {
      meaningful.push(token);
    }
  }
  const candidates = meaningful.length > 0 ? meaningful : tokens;
  return [...candidates]
    .sort(
      (left, right) =>
        right.length - left.length || left.localeCompare(right),
    )
    .slice(0, MAX_QUOTE_SEARCH_ANCHORS);
}

/** Score two quotes from 0 (unrelated) to 1 (the same normalized words). */
export function quoteTextSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeSimilarityText(left);
  const normalizedRight = normalizeSimilarityText(right);
  if (
    normalizedLeft.length < MIN_QUOTE_SIMILARITY_LENGTH ||
    normalizedRight.length < MIN_QUOTE_SIMILARITY_LENGTH
  ) {
    return 0;
  }
  if (normalizedLeft === normalizedRight) {
    return 1;
  }
  const ngramScore = ngramDice(normalizedLeft, normalizedRight, 3);
  const ratio = lengthRatio(normalizedLeft, normalizedRight);
  if (ratio < 0.55) {
    return Math.min(ngramScore, 0.5);
  }
  const shorter =
    normalizedLeft.length <= normalizedRight.length
      ? normalizedLeft
      : normalizedRight;
  const longer = shorter === normalizedLeft ? normalizedRight : normalizedLeft;
  if (ratio >= 0.65 && ` ${longer} `.includes(` ${shorter} `)) {
    return Math.max(ngramScore, 0.9);
  }
  // Shared words with moderately shared spelling still reach the match threshold.
  if (
    tokenDice(normalizedLeft, normalizedRight) >= QUOTE_MATCH_THRESHOLD &&
    ngramScore >= 0.52
  ) {
    return Math.max(ngramScore, QUOTE_MATCH_THRESHOLD);
  }
  return ngramScore;
}

// Only a nonblank submitted title gates matching against the stored candidate.
export function quotesPossiblyMatch(
  submitted: { quoteText: string; sourceTitle: string },
  candidate: { quoteText: string; sourceTitle: string },
): boolean {
  if (
    submitted.sourceTitle.trim().length > 0 &&
    !sourceTitlesPossiblyMatch(
      submitted.sourceTitle,
      candidate.sourceTitle,
    )
  ) {
    return false;
  }
  return (
    quoteTextSimilarity(submitted.quoteText, candidate.quoteText) >=
    QUOTE_MATCH_THRESHOLD
  );
}

/** Build a full-text query that ranks passages sharing the most quote words. */
export function transcriptSearchQuery(quoteText: string): string | null {
  if (normalizeSimilarityText(quoteText).length < MIN_QUOTE_SIMILARITY_LENGTH) {
    return null;
  }
  const terms = [...new Set(transcriptTerms(quoteText))].filter(
    (term) => term.length <= MAX_SEARCH_TERM_LENGTH,
  );
  if (terms.length === 0) {
    return null;
  }
  // Longer words are usually rarer, so they carry the ranking when a quote is long.
  const selected =
    terms.length <= MAX_TRANSCRIPT_SEARCH_TERMS
      ? terms
      : [...terms]
          .sort(
            (left, right) =>
              right.length - left.length || left.localeCompare(right),
          )
          .slice(0, MAX_TRANSCRIPT_SEARCH_TERMS);
  return selected.join(" ");
}

// Short quotes are often everyday phrases a host may say without quoting anything.
function isShortTranscriptQuote(quoteText: string): boolean {
  return (
    similarityTokens(normalizeSimilarityText(quoteText)).length <
    SHORT_TRANSCRIPT_QUOTE_TOKENS
  );
}

/** The similarity a transcript passage needs before it counts as the quote. */
export function transcriptMatchThreshold(quoteText: string): number {
  return isShortTranscriptQuote(quoteText)
    ? SHORT_TRANSCRIPT_MATCH_THRESHOLD
    : TRANSCRIPT_MATCH_THRESHOLD;
}

/**
 * Find the run of transcript words that best matches a quote. Passages are longer
 * than quotes, so each candidate window is about as long as the quote itself.
 */
export function transcriptQuoteMatch(
  quoteText: string,
  passageText: string,
): { similarity: number; excerpt: string } | null {
  const normalizedQuote = normalizeSimilarityText(quoteText);
  if (normalizedQuote.length < MIN_QUOTE_SIMILARITY_LENGTH) {
    return null;
  }
  const quoteTokens = similarityTokens(normalizedQuote).slice(
    0,
    MAX_TRANSCRIPT_QUOTE_TOKENS,
  );
  const quote = quoteTokens.join(" ");
  const words = passageText.split(/\s+/u).filter((word) => word.length > 0);
  // Map each normalized token to its source word so the excerpt keeps the transcript text.
  const tokens: string[] = [];
  const wordIndexes: number[] = [];
  words.forEach((word, index) => {
    for (const token of similarityTokens(normalizeSimilarityText(word))) {
      tokens.push(token);
      wordIndexes.push(index);
    }
  });
  if (tokens.length === 0) {
    return null;
  }

  // Slide a quote-sized window and count shared words to find where to look closely.
  const width = Math.min(quoteTokens.length, tokens.length);
  const wanted = new Map<string, number>();
  for (const token of quoteTokens) {
    wanted.set(token, (wanted.get(token) ?? 0) + 1);
  }
  const held = new Map<string, number>();
  let overlap = 0;
  const windows: Array<{ start: number; overlap: number }> = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const added = tokens[index] ?? "";
    const addedCount = held.get(added) ?? 0;
    if (addedCount < (wanted.get(added) ?? 0)) {
      overlap += 1;
    }
    held.set(added, addedCount + 1);
    if (index >= width) {
      const removed = tokens[index - width] ?? "";
      const removedCount = (held.get(removed) ?? 0) - 1;
      held.set(removed, removedCount);
      if (removedCount < (wanted.get(removed) ?? 0)) {
        overlap -= 1;
      }
    }
    if (index >= width - 1) {
      windows.push({ start: index - width + 1, overlap });
    }
  }
  windows.sort(
    (left, right) => right.overlap - left.overlap || left.start - right.start,
  );

  // Refine the best windows by nudging their edges to absorb transcription drift.
  const quoteTrigrams = ngramCounts(quote, 3);
  let best = { similarity: 0, start: 0, end: 0 };
  for (const window of windows.slice(0, TRANSCRIPT_WINDOWS_TO_REFINE)) {
    if (window.overlap === 0) {
      break;
    }
    for (
      let shift = -TRANSCRIPT_WINDOW_SLACK;
      shift <= TRANSCRIPT_WINDOW_SLACK;
      shift += 1
    ) {
      for (
        let size = width - TRANSCRIPT_WINDOW_SLACK;
        size <= width + TRANSCRIPT_WINDOW_SLACK;
        size += 1
      ) {
        const start = window.start + shift;
        const end = start + size;
        if (start < 0 || size < 1 || end > tokens.length) {
          continue;
        }
        // Windows were picked for shared words, so score spelling alone here.
        const similarity = ngramDiceWithCounts(
          quote,
          quoteTrigrams,
          tokens.slice(start, end).join(" "),
          3,
        );
        if (similarity > best.similarity) {
          best = { similarity, start, end };
        }
      }
    }
  }
  if (best.similarity === 0) {
    return null;
  }
  const firstWord = wordIndexes[best.start] ?? 0;
  const lastWord = wordIndexes[best.end - 1] ?? words.length - 1;
  const excerptStart = Math.max(0, firstWord - TRANSCRIPT_EXCERPT_CONTEXT_WORDS);
  const excerptEnd = Math.min(
    words.length,
    lastWord + 1 + TRANSCRIPT_EXCERPT_CONTEXT_WORDS,
  );
  const excerpt = [
    excerptStart > 0 ? "…" : "",
    words.slice(excerptStart, excerptEnd).join(" "),
    excerptEnd < words.length ? "…" : "",
  ].join("");
  return { similarity: best.similarity, excerpt };
}

/**
 * Map a similarity to how strongly it suggests reuse: nothing at the evidence floor,
 * one half at the point where a listener would be warned, and certain when identical.
 */
function evidenceStrength(similarity: number, threshold: number): number {
  if (similarity <= REUSE_EVIDENCE_FLOOR) {
    return 0;
  }
  if (similarity >= 1) {
    return 1;
  }
  if (similarity < threshold) {
    return (
      (0.5 * (similarity - REUSE_EVIDENCE_FLOOR)) /
      (threshold - REUSE_EVIDENCE_FLOOR)
    );
  }
  return 0.5 + (0.5 * (similarity - threshold)) / (1 - threshold);
}

/** Likelihood that a similar earlier submission means the quote was already used. */
export function submissionReuseLikelihood(input: {
  similarity: number;
  status: QuoteStatus;
  placed: boolean;
  sourceTitleMatches: boolean;
}): number {
  // An included or placed entry was played on the show. A pending one may have
  // been, and a rejected one was explicitly left out.
  const statusWeight = input.placed
    ? PLAYED_SUBMISSION_WEIGHT
    : SUBMISSION_STATUS_WEIGHTS[input.status];
  const sourceWeight = input.sourceTitleMatches
    ? 1
    : SOURCE_TITLE_MISMATCH_WEIGHT;
  return (
    evidenceStrength(input.similarity, QUOTE_MATCH_THRESHOLD) *
    statusWeight *
    sourceWeight
  );
}

/** Likelihood that a matching transcript passage means the quote was already used. */
export function transcriptReuseLikelihood(
  quoteText: string,
  similarity: number,
): number {
  return (
    evidenceStrength(similarity, transcriptMatchThreshold(quoteText)) *
    (isShortTranscriptQuote(quoteText)
      ? SHORT_TRANSCRIPT_WEIGHT
      : TRANSCRIPT_WEIGHT)
  );
}

/** Whether a submission match is clear enough to count as its own use of the quote. */
export function submissionEvidenceIsDistinct(similarity: number): boolean {
  return similarity >= QUOTE_MATCH_THRESHOLD;
}

/** Whether a transcript match is clear and specific enough to count as its own use. */
export function transcriptEvidenceIsDistinct(
  quoteText: string,
  similarity: number,
): boolean {
  return (
    !isShortTranscriptQuote(quoteText) &&
    similarity >= transcriptMatchThreshold(quoteText)
  );
}

/**
 * Combine per-episode likelihoods into one. Distinct evidence in several episodes
 * compounds as independent chances. Near-misses and everyday phrases count only
 * once, through the strongest of them, so many weak hits cannot add up to a
 * confident result.
 */
export function combineReuseLikelihoods(
  episodes: Array<{ distinct: number; other: number }>,
): number {
  let unused = 1;
  let strongestOther = 0;
  for (const episode of episodes) {
    const distinct = clampLikelihood(episode.distinct);
    unused *= 1 - distinct;
    if (episode.other > distinct) {
      strongestOther = Math.max(strongestOther, clampLikelihood(episode.other));
    }
  }
  return 1 - unused * (1 - strongestOther);
}

function clampLikelihood(likelihood: number): number {
  return Math.min(Math.max(likelihood, 0), 1);
}
