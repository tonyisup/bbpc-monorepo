const MIN_QUOTE_SIMILARITY_LENGTH = 8;
const MAX_QUOTE_SEARCH_ANCHORS = 3;

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

function ngramDice(left: string, right: string, size: number): number {
  if (left.length < size || right.length < size) {
    return left === right ? 1 : 0;
  }
  const leftCounts = new Map<string, number>();
  for (let index = 0; index <= left.length - size; index += 1) {
    const gram = left.slice(index, index + size);
    leftCounts.set(gram, (leftCounts.get(gram) ?? 0) + 1);
  }
  let shared = 0;
  for (let index = 0; index <= right.length - size; index += 1) {
    const gram = right.slice(index, index + size);
    const count = leftCounts.get(gram) ?? 0;
    if (count > 0) {
      shared += 1;
      leftCounts.set(gram, count - 1);
    }
  }
  return (
    (2 * shared) /
    (left.length - size + 1 + (right.length - size + 1))
  );
}

function lengthRatio(left: string, right: string): number {
  return (
    Math.min(left.length, right.length) /
    Math.max(left.length, right.length)
  );
}

function sourceTitlesPossiblyMatch(left: string, right: string): boolean {
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
  const tokens = [...new Set(similarityTokens(normalized))];
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

export function quotesPossiblyMatch(
  left: { quoteText: string; sourceTitle: string },
  right: { quoteText: string; sourceTitle: string },
): boolean {
  if (
    left.sourceTitle.trim().length > 0 &&
    !sourceTitlesPossiblyMatch(left.sourceTitle, right.sourceTitle)
  ) {
    return false;
  }
  const normalizedLeft = normalizeSimilarityText(left.quoteText);
  const normalizedRight = normalizeSimilarityText(right.quoteText);
  if (
    normalizedLeft.length < MIN_QUOTE_SIMILARITY_LENGTH ||
    normalizedRight.length < MIN_QUOTE_SIMILARITY_LENGTH
  ) {
    return false;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  const ratio = lengthRatio(normalizedLeft, normalizedRight);
  if (ratio < 0.55) {
    return false;
  }
  const shorter =
    normalizedLeft.length <= normalizedRight.length
      ? normalizedLeft
      : normalizedRight;
  const longer = shorter === normalizedLeft ? normalizedRight : normalizedLeft;
  if (ratio >= 0.65 && ` ${longer} `.includes(` ${shorter} `)) {
    return true;
  }
  const tokenScore = tokenDice(normalizedLeft, normalizedRight);
  const ngramScore = ngramDice(normalizedLeft, normalizedRight, 3);
  return (
    ngramScore >= 0.68 ||
    (tokenScore >= 0.68 && ngramScore >= 0.52)
  );
}
