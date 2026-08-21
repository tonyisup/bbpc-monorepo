import { useEffect, useState } from "react";

export const MOVIE_YEAR_HINT_DELAY_MS = 3_000;

const MAX_TMDB_QUERY_LENGTH = 200;
const COMPLETE_YEAR_MODIFIER = /^y:(\d{4})$/iu;
const INCOMPLETE_YEAR_MODIFIER = /^y:\d{0,3}$/iu;
const YEAR_LIKE_TOKEN = /^y:/iu;
const TRAILING_RELEASE_YEAR = /(?:^|\s)(?:\((\d{4})\)|(\d{4}))$/u;

export type MovieYearQueryAnalysis = {
  normalizedQuery: string;
  syntax: "searchable" | "incomplete" | "invalid";
  hasValidModifier: boolean;
  releaseYearCandidate: number | null;
  canAppendModifier: boolean;
};

export type MovieYearHint =
  | { kind: "hidden" }
  | { kind: "immediate-add"; actionable: boolean }
  | { kind: "immediate-rewrite"; year: number }
  | { kind: "delayed-add"; delayMs: number; actionable: boolean };

export type MovieYearHintInput = {
  mediaKind: "movie" | "show";
  currentInput: string;
  requestQuery: string;
  phase: "idle" | "searching" | "settled";
  tmdbStatus: "not-run" | "fulfilled" | "rejected";
  visibleResultCount: number;
};

export type MovieYearHintAction =
  | { kind: "append" }
  | { kind: "rewrite"; year: number };

type TrailingReleaseYear = {
  title: string;
  year: number;
};

const HIDDEN_HINT: MovieYearHint = { kind: "hidden" };

function normalizeQuery(query: string): string {
  return query.trim().normalize("NFKC");
}

function findTrailingReleaseYear(
  normalizedQuery: string,
): TrailingReleaseYear | null {
  const match = TRAILING_RELEASE_YEAR.exec(normalizedQuery);
  if (!match) {
    return null;
  }

  const title = normalizedQuery.slice(0, match.index).trim();
  if (title.length === 0) {
    return null;
  }

  const year = Number(match[1] ?? match[2]);
  if (year < 1_000 || year > 9_999) {
    return null;
  }

  return { title, year };
}

export function analyzeMovieYearQuery(query: string): MovieYearQueryAnalysis {
  const normalizedQuery = normalizeQuery(query);
  const tokens = normalizedQuery.length === 0 ? [] : normalizedQuery.split(/\s+/u);
  const completeYears: number[] = [];
  let hasMalformedModifier = false;

  for (const token of tokens) {
    const completeMatch = COMPLETE_YEAR_MODIFIER.exec(token);
    if (completeMatch) {
      completeYears.push(Number(completeMatch[1]));
    } else if (YEAR_LIKE_TOKEN.test(token)) {
      hasMalformedModifier = true;
    }
  }

  const trailingToken = tokens.at(-1) ?? "";
  const hasIncompleteModifier =
    INCOMPLETE_YEAR_MODIFIER.test(trailingToken) &&
    !COMPLETE_YEAR_MODIFIER.test(trailingToken);
  const distinctYears = new Set(completeYears);
  const hasOutOfRangeYear = completeYears.some(
    (year) => year < 1_000 || year > 9_999,
  );
  const hasConflictingYears = distinctYears.size > 1;
  const validYears = completeYears.filter(
    (year) => year >= 1_000 && year <= 9_999,
  );
  const hasValidModifier =
    validYears.length > 0 && !hasOutOfRangeYear && !hasConflictingYears;

  let syntax: MovieYearQueryAnalysis["syntax"] = "searchable";
  if (hasIncompleteModifier && !hasOutOfRangeYear && !hasConflictingYears) {
    syntax = "incomplete";
  } else if (
    hasMalformedModifier ||
    hasOutOfRangeYear ||
    hasConflictingYears
  ) {
    syntax = "invalid";
  }

  const releaseYear = findTrailingReleaseYear(normalizedQuery);
  const canAppendModifier =
    normalizedQuery.length > 0 &&
    syntax === "searchable" &&
    !hasValidModifier &&
    `${normalizedQuery} y:`.length <= MAX_TMDB_QUERY_LENGTH;

  return {
    normalizedQuery,
    syntax,
    hasValidModifier,
    releaseYearCandidate: releaseYear?.year ?? null,
    canAppendModifier,
  };
}

export function deriveMovieYearHint(
  input: MovieYearHintInput,
): MovieYearHint {
  const analysis = analyzeMovieYearQuery(input.currentInput);
  if (
    input.mediaKind !== "movie" ||
    input.phase !== "settled" ||
    input.tmdbStatus !== "fulfilled" ||
    analysis.normalizedQuery.length === 0 ||
    analysis.normalizedQuery !== normalizeQuery(input.requestQuery) ||
    analysis.syntax !== "searchable" ||
    analysis.hasValidModifier
  ) {
    return HIDDEN_HINT;
  }

  if (input.visibleResultCount === 0) {
    if (analysis.releaseYearCandidate !== null) {
      return {
        kind: "immediate-rewrite",
        year: analysis.releaseYearCandidate,
      };
    }
    return {
      kind: "immediate-add",
      actionable: analysis.canAppendModifier,
    };
  }

  if (input.visibleResultCount > 0) {
    return {
      kind: "delayed-add",
      delayMs: MOVIE_YEAR_HINT_DELAY_MS,
      actionable: analysis.canAppendModifier,
    };
  }

  return HIDDEN_HINT;
}

export function useMovieYearHint(
  input: MovieYearHintInput & { requestGeneration: number },
): MovieYearHint {
  const {
    mediaKind,
    currentInput,
    requestQuery,
    phase,
    tmdbStatus,
    visibleResultCount,
    requestGeneration,
  } = input;
  const hint = deriveMovieYearHint({
    mediaKind,
    currentInput,
    requestQuery,
    phase,
    tmdbStatus,
    visibleResultCount,
  });
  const delayedKey =
    hint.kind === "delayed-add"
      ? JSON.stringify([
          requestGeneration,
          mediaKind,
          normalizeQuery(currentInput),
          normalizeQuery(requestQuery),
          phase,
          tmdbStatus,
          visibleResultCount,
          hint.actionable,
        ])
      : null;
  const delayMs = hint.kind === "delayed-add" ? hint.delayMs : 0;
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  useEffect(() => {
    if (delayedKey === null) {
      return;
    }

    const timeout = setTimeout(() => {
      setRevealedKey(delayedKey);
    }, delayMs);
    return () => {
      clearTimeout(timeout);
    };
  }, [
    currentInput,
    delayMs,
    delayedKey,
    mediaKind,
    phase,
    requestGeneration,
    requestQuery,
    tmdbStatus,
    visibleResultCount,
  ]);

  if (hint.kind !== "delayed-add") {
    return hint;
  }
  return revealedKey === delayedKey ? hint : HIDDEN_HINT;
}

export function applyMovieYearHint(
  query: string,
  action: MovieYearHintAction,
): { query: string; caret: number; rerun: boolean } | null {
  const analysis = analyzeMovieYearQuery(query);
  if (
    analysis.normalizedQuery.length === 0 ||
    analysis.syntax !== "searchable" ||
    analysis.hasValidModifier
  ) {
    return null;
  }

  if (action.kind === "append") {
    if (!analysis.canAppendModifier) {
      return null;
    }
    const transformedQuery = `${analysis.normalizedQuery} y:`;
    return {
      query: transformedQuery,
      caret: transformedQuery.length,
      rerun: false,
    };
  }

  if (
    !Number.isInteger(action.year) ||
    action.year < 1_000 ||
    action.year > 9_999
  ) {
    return null;
  }
  const trailingYear = findTrailingReleaseYear(analysis.normalizedQuery);
  if (!trailingYear || trailingYear.year !== action.year) {
    return null;
  }

  const transformedQuery = `${trailingYear.title} y:${String(action.year)}`;
  if (transformedQuery.length > MAX_TMDB_QUERY_LENGTH) {
    return null;
  }
  return {
    query: transformedQuery,
    caret: transformedQuery.length,
    rerun: true,
  };
}
