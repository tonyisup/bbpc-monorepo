"use client";

import { useConvex } from "convex/react";
import { ChevronDown, Download, ListOrdered, Plus, Search } from "lucide-react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { getConvexDomainErrorCode } from "@/convex/identity";
import {
  addConvexScorecardMovie,
  clearConvexScorecardMovie,
  type ConvexScorecardEntry,
  listConvexScorecard,
  orderConvexScorecardTie,
  setConvexScorecardScore,
  setConvexScorecardUnseen,
} from "@/convex/scorecard";
import {
  type ConvexCatalogMovie,
  type ConvexTmdbMovie,
  searchConvexCatalogMovies,
  searchConvexTmdbMovies,
  upsertConvexTmdbMovie,
} from "@/convex/syllabus";
import { type ConvexYearReview, listConvexYearReviews } from "@/convex/year";
import { track } from "@/lib/analytics";
import { getPacificTodayPlainDate, getPlainDateYear } from "@/lib/dates";
import {
  buildScorecardCsv,
  buildScorecardMovies,
  countScored,
  getDefaultScorecardYear,
  isQueued,
  parseScorecardYear,
  SCORECARD_CRITERIA,
  type ScorecardCriterion,
  type ScorecardScores,
} from "@/lib/scorecard";

import { ApplyTopTenDialog } from "./ApplyTopTenDialog";
import { IllustratedScoreCard } from "./IllustratedScoreCard";
import { type SaveState, ScoreCard, type ScoreCardProps } from "./ScoreCard";
import { ScorecardLeaderboard } from "./ScorecardLeaderboard";

type Tab = "score" | "leaderboard";
type EntryMode = "list" | "illustrated";
const ENTRY_MODE_STORAGE_KEY = "bbpc:scorecard-entry-mode";

function readEntryMode(): EntryMode {
  try {
    return window.localStorage.getItem(ENTRY_MODE_STORAGE_KEY) === "illustrated"
      ? "illustrated"
      : "list";
  } catch {
    return "list";
  }
}
type MovieInfo = ConvexScorecardEntry["movie"];
type YearMovie = {
  movie: MovieInfo;
  firstReviewedAt: number;
  episode: { slug: string; number: number } | null;
  myRatingName: string | null;
};
type SearchResult =
  | { kind: "catalog"; movie: ConvexCatalogMovie }
  | { kind: "tmdb"; movie: ConvexTmdbMovie; year: number };

function operationError(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "WRITE_DISABLED":
      return "Changes are paused while this environment is read-only.";
    case "STALE_CLIENT":
      return "This page is out of date. Refresh it before trying again.";
    case "CONFLICT":
      return "That change conflicts with your latest scorecard. It has been reloaded.";
    case "VALIDATION_FAILED":
      return "That change is not valid for this year's scorecard.";
    case "FORBIDDEN":
      return "Scorecards can only be changed by their owner.";
    default:
      return "The change could not be saved.";
  }
}

function toYearMovies(
  reviews: ConvexYearReview[],
  appUserId: string
): YearMovie[] {
  const byMovie = new Map<string, YearMovie>();
  for (const review of reviews) {
    const mine =
      review.user?.id === appUserId && review.rating
        ? review.rating.name
        : null;
    const episode =
      review.episode?.slug != null
        ? { slug: review.episode.slug, number: review.episode.number }
        : null;
    const existing = byMovie.get(review.movie.id);
    if (!existing) {
      byMovie.set(review.movie.id, {
        movie: review.movie,
        firstReviewedAt: review.reviewedAt,
        episode,
        myRatingName: mine,
      });
      continue;
    }
    if (review.reviewedAt < existing.firstReviewedAt) {
      existing.firstReviewedAt = review.reviewedAt;
      existing.episode = episode ?? existing.episode;
    }
    existing.myRatingName ??= mine;
  }
  return [...byMovie.values()];
}

function downloadCsv(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ScorecardManager({
  appUserId,
  canUseRankedLists,
}: {
  appUserId: string;
  canUseRankedLists: boolean;
}) {
  const convex = useConvex();
  const router = useRouter();
  const searchParams = useSearchParams();
  const todayYear =
    getPlainDateYear(getPacificTodayPlainDate()) ?? new Date().getFullYear();
  const defaultYear = getDefaultScorecardYear(getPacificTodayPlainDate());
  const year = parseScorecardYear(searchParams.get("year"), defaultYear);
  const years = Array.from({ length: 10 }, (_, index) => todayYear - index);

  const [yearMovies, setYearMovies] = useState<YearMovie[]>([]);
  const [entries, setEntries] = useState<ConvexScorecardEntry[]>([]);
  const [loadedYear, setLoadedYear] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("score");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, ScorecardScores>>(
    {}
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [showUnseen, setShowUnseen] = useState(false);
  const [entryMode, setEntryMode] = useState<EntryMode>("list");
  const loadGeneration = useRef(0);
  const loadedYearRef = useRef<number | null>(null);
  const pendingSaves = useRef(0);

  const reload = useCallback(
    async (forYear: number) => {
      const generation = loadGeneration.current + 1;
      loadGeneration.current = generation;
      try {
        const [reviews, scorecard] = await Promise.all([
          listConvexYearReviews(convex, forYear),
          listConvexScorecard(convex, forYear),
        ]);
        if (loadGeneration.current !== generation) return;
        setYearMovies(toYearMovies(reviews, appUserId));
        setEntries(scorecard);
        setLoadError(null);
        if (loadedYearRef.current !== forYear) {
          loadedYearRef.current = forYear;
          setTab(
            scorecard.some((entry) => entry.complete) ? "leaderboard" : "score"
          );
          setCurrentId(null);
          setOverrides({});
          track("scorecard_viewed", { year: forYear });
        }
        setLoadedYear(forYear);
      } catch {
        if (loadGeneration.current === generation) {
          setLoadError("Your scorecard could not be loaded.");
        }
      }
    },
    [appUserId, convex]
  );

  useEffect(() => {
    void reload(year);
  }, [reload, year]);

  // Read after mount so the server render and first client render agree.
  useEffect(() => {
    if (typeof window !== "undefined") setEntryMode(readEntryMode());
  }, []);

  const changeEntryMode = (mode: EntryMode) => {
    setEntryMode(mode);
    try {
      window.localStorage.setItem(ENTRY_MODE_STORAGE_KEY, mode);
    } catch {
      // Private browsing can refuse storage; the choice still applies now.
    }
    track("scorecard_entry_mode_changed", { mode });
  };

  const items = useMemo(
    () =>
      buildScorecardMovies(
        yearMovies.map((item) => ({
          movie: item.movie,
          firstReviewedAt: item.firstReviewedAt,
        })),
        entries
      ),
    [entries, yearMovies]
  );
  const yearInfo = useMemo(
    () => new Map(yearMovies.map((item) => [item.movie.id, item])),
    [yearMovies]
  );
  const queue = items.filter(isQueued);
  const unseenItems = items.filter((item) => item.entry?.unseen === true);
  const current =
    items.find((item) => item.movie.id === currentId) ?? queue[0] ?? null;
  const currentMovieId = current?.movie.id ?? null;
  // Pin the shown movie so finishing its 9th score never swaps the card;
  // only Next, Skip or Haven't seen move on.
  useEffect(() => {
    if (currentId === null && currentMovieId !== null)
      setCurrentId(currentMovieId);
  }, [currentId, currentMovieId]);
  const ranked = useMemo(
    () =>
      entries
        .filter((entry) => entry.position !== null)
        .sort((left, right) => (left.position ?? 0) - (right.position ?? 0)),
    [entries]
  );

  const scoresFor = (movieId: string): ScorecardScores => ({
    ...items.find((item) => item.movie.id === movieId)?.entry?.scores,
    ...overrides[movieId],
  });

  const nextQueuedAfter = (movieId: string): string | null => {
    const others = queue.filter((item) => item.movie.id !== movieId);
    const index = items.findIndex((item) => item.movie.id === movieId);
    const after =
      others.find(
        (item) =>
          items.findIndex((candidate) => candidate.movie.id === item.movie.id) >
          index
      ) ?? others[0];
    return after?.movie.id ?? null;
  };

  const goTo = (movieId: string | null) => {
    setCurrentId(movieId);
    setSaveState("idle");
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  };

  const replaceEntry = (entry: ConvexScorecardEntry) =>
    setEntries((all) => [
      ...all.filter((candidate) => candidate.movie.id !== entry.movie.id),
      entry,
    ]);

  const commitScore = async (
    movieId: string,
    criterion: ScorecardCriterion,
    value: number
  ) => {
    const wasComplete =
      countScored(scoresFor(movieId)) === SCORECARD_CRITERIA.length;
    setOverrides((all) => ({
      ...all,
      [movieId]: { ...all[movieId], [criterion]: value },
    }));
    setSaveState("saving");
    setError(null);
    pendingSaves.current += 1;
    try {
      const entry = await setConvexScorecardScore(convex, {
        year,
        movieId,
        criterion,
        value,
      });
      replaceEntry(entry);
      if (entry.complete && !wasComplete) {
        track("scorecard_movie_completed", { year });
      }
      setOverrides((all) => {
        if (all[movieId]?.[criterion] !== value) return all;
        const rest = { ...all[movieId] };
        delete rest[criterion];
        return { ...all, [movieId]: rest };
      });
      pendingSaves.current -= 1;
      if (pendingSaves.current === 0) {
        setSaveState("saved");
        // Positions of other movies can move; refresh them quietly.
        void reload(year);
      }
    } catch (caught) {
      pendingSaves.current -= 1;
      setOverrides((all) => {
        const rest = { ...all[movieId] };
        delete rest[criterion];
        return { ...all, [movieId]: rest };
      });
      setSaveState("error");
      setError(operationError(caught));
    }
  };

  const runBusy = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (caught) {
      setError(operationError(caught));
      if (getConvexDomainErrorCode(caught) === "CONFLICT") await reload(year);
    } finally {
      setBusy(false);
    }
  };

  const markUnseen = (movieId: string, unseen: boolean) =>
    runBusy(async () => {
      const next = unseen ? nextQueuedAfter(movieId) : null;
      replaceEntry(
        await setConvexScorecardUnseen(convex, { year, movieId, unseen })
      );
      if (unseen) goTo(next);
      await reload(year);
    });

  const clearMovie = (movieId: string) =>
    runBusy(async () => {
      await clearConvexScorecardMovie(convex, year, movieId);
      setEntries((all) => all.filter((entry) => entry.movie.id !== movieId));
      setOverrides((all) => {
        const rest = { ...all };
        delete rest[movieId];
        return rest;
      });
      await reload(year);
    });

  const orderTie = (movieIds: string[]) =>
    runBusy(async () => {
      await orderConvexScorecardTie(convex, year, movieIds);
      await reload(year);
    });

  const addMovie = (result: SearchResult) =>
    runBusy(async () => {
      const movie =
        result.kind === "catalog"
          ? result.movie
          : await upsertConvexTmdbMovie(convex, result.movie, result.year);
      const entry = await addConvexScorecardMovie(convex, year, movie.id);
      replaceEntry(entry);
      setTab("score");
      goTo(entry.movie.id);
      await reload(year);
    });

  const changeYear = (next: number) => {
    router.replace(`/year/scorecard?year=${String(next)}`, { scroll: false });
  };

  if (loadedYear === null || loadedYear !== year) {
    return loadError ? (
      <ErrorPanel message={loadError} onRetry={() => void reload(year)} />
    ) : (
      <LoadingIndicator variant="page" label="Loading your scorecard" />
    );
  }

  const currentScores = current ? scoresFor(current.movie.id) : {};
  const currentComplete =
    countScored(currentScores) === SCORECARD_CRITERIA.length;
  const nextId = current ? nextQueuedAfter(current.movie.id) : null;
  const totalSeen = items.length - unseenItems.length;
  const info = current ? yearInfo.get(current.movie.id) : undefined;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="scorecard-year" className="sr-only">
          Scorecard year
        </label>
        <select
          id="scorecard-year"
          value={year}
          onChange={(event) => changeYear(Number(event.target.value))}
          className="h-11 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm font-semibold"
        >
          {!years.includes(year) && <option value={year}>{year}</option>}
          {years.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <div
          role="tablist"
          aria-label="Scorecard view"
          className="flex rounded-md border border-zinc-700 p-0.5"
        >
          {(["score", "leaderboard"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={tab === option}
              onClick={() => setTab(option)}
              className={`min-h-10 rounded px-4 text-sm font-semibold ${
                tab === option
                  ? "bg-zinc-100 text-zinc-950"
                  : "text-muted-foreground"
              }`}
            >
              {option === "score" ? "Score" : "Leaderboard"}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300"
        >
          {error}
        </p>
      )}

      {tab === "score" ? (
        <div className="space-y-6">
          {current && (
            <div
              role="radiogroup"
              aria-label="Scoring style"
              className="flex w-fit rounded-md border border-zinc-700 p-0.5 text-xs"
            >
              {(["list", "illustrated"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={entryMode === mode}
                  onClick={() => changeEntryMode(mode)}
                  className={`min-h-9 rounded px-3 font-semibold ${
                    entryMode === mode
                      ? "bg-zinc-100 text-zinc-950"
                      : "text-muted-foreground"
                  }`}
                >
                  {mode === "list" ? "All at once" : "With pictures"}
                </button>
              ))}
            </div>
          )}
          {current ? (
            <CardForMode
              mode={entryMode}
              key={current.movie.id}
              movie={current.movie}
              scores={currentScores}
              myRatingName={
                current.entry?.myRating?.name ?? info?.myRatingName ?? null
              }
              episode={info?.episode ?? null}
              saveState={saveState}
              progressText={`${String(ranked.length)} of ${String(
                totalSeen
              )} scored · ${String(
                queue.filter((item) => item.movie.id !== current.movie.id)
                  .length + (currentComplete ? 0 : 1)
              )} to go`}
              busy={busy}
              canGoNext={currentComplete}
              nextLabel={nextId ? "Next movie" : "See leaderboard"}
              onCommit={(criterion, value) =>
                void commitScore(current.movie.id, criterion, value)
              }
              onNext={() => {
                if (nextId) goTo(nextId);
                else setTab("leaderboard");
              }}
              onSkip={() => goTo(nextId)}
              onUnseen={() => void markUnseen(current.movie.id, true)}
              onClear={() => void clearMovie(current.movie.id)}
            />
          ) : (
            <div className="rounded border border-dashed border-zinc-700 p-6 text-center text-sm">
              <p className="font-semibold">
                {items.length === 0
                  ? `No ${String(year)} movies yet.`
                  : "Everything is scored."}
              </p>
              <p className="mt-1 text-muted-foreground">
                {items.length === 0
                  ? "Add a movie below to start."
                  : "Check the leaderboard, or add another movie below."}
              </p>
            </div>
          )}

          {unseenItems.length > 0 && (
            <div>
              <button
                type="button"
                aria-expanded={showUnseen}
                onClick={() => setShowUnseen((open) => !open)}
                className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold"
              >
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${
                    showUnseen ? "" : "-rotate-90"
                  }`}
                />
                Haven&apos;t seen ({unseenItems.length})
              </button>
              {showUnseen && (
                <ul className="space-y-1">
                  {unseenItems.map((item) => (
                    <li
                      key={item.movie.id}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="truncate">{item.movie.title}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void markUnseen(item.movie.id, false)}
                      >
                        Restore
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <AddMovie
            year={year}
            busy={busy}
            existingMovieIds={new Set(items.map((item) => item.movie.id))}
            onAdd={(result) => void addMovie(result)}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {canUseRankedLists && (
              <Button
                type="button"
                disabled={ranked.length === 0}
                title={
                  ranked.length === 0
                    ? "Score at least one movie completely"
                    : undefined
                }
                onClick={() => setApplyOpen(true)}
              >
                <ListOrdered className="mr-2 h-4 w-4" />
                Use as my top 10
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={entries.length === 0}
              onClick={() => {
                downloadCsv(
                  `bbpc-scorecard-${String(year)}.csv`,
                  buildScorecardCsv(items)
                );
                track("scorecard_csv_downloaded", { year });
              }}
            >
              <Download className="mr-2 h-4 w-4" />
              Download CSV
            </Button>
          </div>
          <ScorecardLeaderboard
            entries={entries}
            unscoredYearCount={
              items.filter((item) => item.entry === null).length
            }
            busy={busy}
            onEdit={(movieId) => {
              setTab("score");
              goTo(movieId);
            }}
            onCommit={(movieId, criterion, value) =>
              void commitScore(movieId, criterion, value)
            }
            onOrderTie={(movieIds) => void orderTie(movieIds)}
          />
          {canUseRankedLists && (
            <ApplyTopTenDialog
              open={applyOpen}
              year={year}
              ranked={ranked}
              onOpenChange={setApplyOpen}
              onConflict={() => void reload(year)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function CardForMode({ mode, ...props }: ScoreCardProps & { mode: EntryMode }) {
  return mode === "illustrated" ? (
    <IllustratedScoreCard {...props} />
  ) : (
    <ScoreCard {...props} />
  );
}

function ErrorPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded border border-red-500/40 p-6 text-center">
      <p>{message}</p>
      <Button className="mt-4" variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function AddMovie({
  year,
  busy,
  existingMovieIds,
  onAdd,
}: {
  year: number;
  busy: boolean;
  existingMovieIds: Set<string>;
  onAdd: (result: SearchResult) => void;
}) {
  const convex = useConvex();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    const inYearWindow = (movieYear: number) => Math.abs(movieYear - year) <= 1;
    const trimmed = query.trim();
    const current = generation.current + 1;
    generation.current = current;
    if (trimmed.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timeout = window.setTimeout(() => {
      void Promise.allSettled([
        searchConvexCatalogMovies(convex, trimmed),
        searchConvexTmdbMovies(convex, trimmed),
      ]).then(([catalog, tmdb]) => {
        if (generation.current !== current) return;
        const catalogMovies =
          catalog.status === "fulfilled" ? catalog.value : [];
        const catalogTmdbIds = new Set(
          catalogMovies.flatMap((movie) =>
            movie.tmdbId === null ? [] : [movie.tmdbId]
          )
        );
        const tmdbMovies = tmdb.status === "fulfilled" ? tmdb.value : [];
        setResults([
          ...catalogMovies
            .filter((movie) => inYearWindow(movie.year))
            .map((movie): SearchResult => ({ kind: "catalog", movie })),
          ...tmdbMovies.flatMap((movie): SearchResult[] => {
            const movieYear = getPlainDateYear(movie.release_date);
            return movie.poster_path === null ||
              movieYear === null ||
              !inYearWindow(movieYear) ||
              catalogTmdbIds.has(movie.id)
              ? []
              : [{ kind: "tmdb", movie, year: movieYear }];
          }),
        ]);
        setSearching(false);
      });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [convex, query, year]);

  const visible = (results ?? []).filter(
    (result) =>
      result.kind !== "catalog" || !existingMovieIds.has(result.movie.id)
  );

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" />
        Add a movie
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <label className="relative block">
        <span className="sr-only">Search for a movie</span>
        <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${String(year - 1)}–${String(year + 1)} movies`}
          className="h-11 w-full rounded-md border border-zinc-700 bg-zinc-950 pl-9 pr-3 text-base"
        />
      </label>
      {searching && <p className="text-sm text-muted-foreground">Searching…</p>}
      {!searching && results !== null && visible.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No {String(year - 1)}–{String(year + 1)} movies match that search.
        </p>
      )}
      <ul className="space-y-1">
        {visible.map((result) => {
          const title = result.movie.title;
          const resultYear =
            result.kind === "catalog" ? result.movie.year : result.year;
          const poster =
            result.kind === "catalog"
              ? result.movie.poster
              : result.movie.poster_path;
          return (
            <li key={`${result.kind}:${String(result.movie.id)}`}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onAdd(result)}
                className="flex w-full items-center gap-3 rounded border border-zinc-800 p-2 text-left hover:bg-zinc-900 disabled:opacity-50"
              >
                {poster ? (
                  <Image
                    src={poster}
                    alt=""
                    width={28}
                    height={42}
                    sizes="28px"
                    className="h-[42px] w-7 rounded object-cover"
                  />
                ) : (
                  <div className="h-[42px] w-7 rounded bg-zinc-800" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {resultYear}
                    {resultYear !== year && ` · counts toward ${String(year)}`}
                  </span>
                </span>
                <Plus className="h-4 w-4 flex-shrink-0" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
