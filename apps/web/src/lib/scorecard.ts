export const SCORECARD_CRITERIA = [
  {
    key: "story",
    label: "Story",
    hint: "Plot, structure and payoff: does it hold together?",
  },
  {
    key: "performance",
    label: "Performance",
    hint: "Acting: do you believe these people?",
  },
  {
    key: "emotion",
    label: "Emotion",
    hint: "Did it make you feel something, and did it earn it?",
  },
  {
    key: "visual",
    label: "Visual",
    hint: "Cinematography, effects, production design.",
  },
  {
    key: "audio",
    label: "Audio",
    hint: "Score, soundtrack, sound design, mix.",
  },
  {
    key: "importance",
    label: "Importance",
    hint: "Does it matter beyond entertainment: culture, craft, message?",
  },
  {
    key: "engagement",
    label: "Engagement",
    hint: "Were you locked in, or checking your phone?",
  },
  { key: "fun", label: "Fun", hint: "How good a time was it?" },
  { key: "replay", label: "Replay", hint: "Would you happily watch it again?" },
] as const;

export type ScorecardCriterion = (typeof SCORECARD_CRITERIA)[number]["key"];
export type ScorecardScores = Partial<Record<ScorecardCriterion, number>>;

export const SCORECARD_TOP_COUNT = 10;
export const SCORECARD_MIN_SCORE = 1;
export const SCORECARD_MAX_SCORE = 10;

/** January through March still belongs to last year's top 10. */
export function getDefaultScorecardYear(pacificPlainDate: string): number {
  const year = Number.parseInt(pacificPlainDate.slice(0, 4), 10);
  const month = Number.parseInt(pacificPlainDate.slice(5, 7), 10);
  return month <= 3 ? year - 1 : year;
}

export function parseScorecardYear(
  value: string | null,
  fallback: number
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1900 && parsed <= 2200
    ? parsed
    : fallback;
}

export function countScored(scores: ScorecardScores): number {
  return SCORECARD_CRITERIA.filter((c) => scores[c.key] !== undefined).length;
}

/** Snap a pointer position on a track to a whole score from 1 to 10. */
export function scoreFromTrackPosition(offset: number, width: number): number {
  if (width <= 0) return SCORECARD_MIN_SCORE;
  const ratio = Math.min(1, Math.max(0, offset / width));
  return (
    SCORECARD_MIN_SCORE +
    Math.round(ratio * (SCORECARD_MAX_SCORE - SCORECARD_MIN_SCORE))
  );
}

export interface ScorecardMovieLike {
  id: string;
  title: string;
  year: number;
}

export interface ScorecardEntryLike<M extends ScorecardMovieLike> {
  movie: M;
  scores: ScorecardScores;
  unseen: boolean;
  complete: boolean;
  average: number | null;
  position: number | null;
  createdAt: number;
}

export interface YearMovieLike<M extends ScorecardMovieLike> {
  movie: M;
  firstReviewedAt: number;
}

export interface ScoreQueueItem<
  M extends ScorecardMovieLike,
  E extends ScorecardEntryLike<M>
> {
  movie: M;
  entry: E | null;
  fromYear: boolean;
}

/**
 * Every movie on the scorecard for a year: the /year movies (by earliest BBPC
 * review), then movies the user added (by when they were added).
 */
export function buildScorecardMovies<
  M extends ScorecardMovieLike,
  E extends ScorecardEntryLike<M>
>(
  yearMovies: ReadonlyArray<YearMovieLike<M>>,
  entries: readonly E[]
): Array<ScoreQueueItem<M, E>> {
  const entryByMovie = new Map(entries.map((entry) => [entry.movie.id, entry]));
  const yearIds = new Set(yearMovies.map((item) => item.movie.id));
  const fromYear = [...yearMovies]
    .sort((left, right) => left.firstReviewedAt - right.firstReviewedAt)
    .map((item) => ({
      movie: item.movie,
      entry: entryByMovie.get(item.movie.id) ?? null,
      fromYear: true,
    }));
  const added = entries
    .filter((entry) => !yearIds.has(entry.movie.id))
    .sort((left, right) => left.createdAt - right.createdAt)
    .map((entry) => ({ movie: entry.movie, entry, fromYear: false }));
  return [...fromYear, ...added];
}

/** Movies still to score: neither complete nor marked unseen. */
export function isQueued(item: {
  entry: { complete: boolean; unseen: boolean } | null;
}): boolean {
  return item.entry === null || (!item.entry.complete && !item.entry.unseen);
}

type CsvStatus = "ranked" | "incomplete" | "unseen";

function csvField(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * One row per movie that has an entry: ranked rows by position, then
 * incomplete rows in queue order, then unseen rows by title.
 */
export function buildScorecardCsv<
  M extends ScorecardMovieLike,
  E extends ScorecardEntryLike<M>
>(items: ReadonlyArray<ScoreQueueItem<M, E>>): string {
  const withEntries = items.flatMap((item) =>
    item.entry === null ? [] : [item.entry]
  );
  const status = (entry: E): CsvStatus =>
    entry.unseen ? "unseen" : entry.position !== null ? "ranked" : "incomplete";
  const ranked = withEntries
    .filter((entry) => status(entry) === "ranked")
    .sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
  const incomplete = withEntries.filter(
    (entry) => status(entry) === "incomplete"
  );
  const unseen = withEntries
    .filter((entry) => status(entry) === "unseen")
    .sort((left, right) =>
      left.movie.title.localeCompare(right.movie.title, "en")
    );
  const header = [
    "Position",
    "Title",
    "Year",
    ...SCORECARD_CRITERIA.map((criterion) => criterion.label),
    "Score",
    "Status",
  ].join(",");
  const lines = [...ranked, ...incomplete, ...unseen].map((entry) =>
    [
      entry.position === null ? "" : String(entry.position),
      csvField(entry.movie.title),
      String(entry.movie.year),
      ...SCORECARD_CRITERIA.map((criterion) => {
        const value = entry.scores[criterion.key];
        return value === undefined ? "" : String(value);
      }),
      entry.average === null ? "" : entry.average.toFixed(2),
      status(entry),
    ].join(",")
  );
  return [header, ...lines].join("\r\n") + "\r\n";
}
