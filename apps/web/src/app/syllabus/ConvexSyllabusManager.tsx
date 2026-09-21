"use client";

import {
  analyzeMovieYearQuery,
  applyMovieYearHint,
  type MovieYearHintAction,
  useMovieYearHint,
} from "@bbpc/movie-search-hints";
import { prioritizeExactMovieMatches } from "@bbpc/movie-search-hints/search-order";
import { useConvex } from "convex/react";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUp,
  Edit3,
  Loader2,
  Save,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import MovieInlinePreview from "@/components/MovieInlinePreview";
import { MovieYearSearchHint } from "@/components/MovieYearSearchHint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type ConvexCatalogMovie,
  type ConvexSyllabusEntry,
  type ConvexTmdbMovie,
  addConvexSyllabusEntry,
  listConvexSyllabus,
  removeConvexSyllabusEntry,
  reorderConvexSyllabus,
  searchConvexCatalogMovies,
  searchConvexTmdbMovies,
  updateConvexSyllabusNotes,
  upsertConvexTmdbMovie,
} from "@/convex/syllabus";
import { getConvexDomainErrorCode } from "@/convex/identity";
import { getPlainDateYear } from "@/lib/dates";
import {
  type SyllabusInsertPosition,
  syllabusInsertPositionLabels,
  syllabusInsertPositions,
} from "@/lib/syllabus";
import { cn } from "@/lib/utils";

type SearchResult =
  | { kind: "catalog"; movie: ConvexCatalogMovie }
  | { kind: "tmdb"; movie: ConvexTmdbMovie; year: number };

type SearchSnapshot = {
  generation: number;
  requestQuery: string;
  mediaKind: "movie";
  tmdbStatus: "fulfilled" | "rejected";
  visibleResults: SearchResult[];
};

function operationError(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "WRITE_DISABLED":
      return "Syllabus changes are paused while this environment is read-only.";
    case "STALE_CLIENT":
      return "This page is out of date. Refresh it before trying again.";
    case "CONFLICT":
      return "That change conflicts with the latest syllabus state. Reload and try again.";
    case "VALIDATION_FAILED":
      return "That syllabus change is not valid.";
    default:
      return "The syllabus change could not be saved.";
  }
}

function pendingEntries(entries: ConvexSyllabusEntry[]) {
  return entries.filter((entry) => entry.assignment === null);
}

function assignedEntries(entries: ConvexSyllabusEntry[]) {
  return entries.filter((entry) => entry.assignment !== null);
}

export function ConvexSyllabusManager({ appUserId }: { appUserId: string }) {
  const convex = useConvex();
  const [entries, setEntries] = useState<ConvexSyllabusEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyOperation, setBusyOperation] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(
    null
  );
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesDrafts, setNotesDrafts] = useState<Record<string, string>>({});
  const [entryToRemove, setEntryToRemove] =
    useState<ConvexSyllabusEntry | null>(null);
  const [queueFilter, setQueueFilter] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchSnapshot, setSearchSnapshot] = useState<SearchSnapshot | null>(
    null
  );
  const [searchingGeneration, setSearchingGeneration] = useState<number | null>(
    null
  );
  const [searchGeneration, setSearchGeneration] = useState(0);
  const [insertPosition, setInsertPosition] =
    useState<SyllabusInsertPosition>("END");
  const loadGenerationRef = useRef(0);
  const searchGenerationRef = useRef(0);
  const entriesRef = useRef(entries);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const addMovieButtonRef = useRef<HTMLButtonElement>(null);
  const removeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const noteButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const notesReturnFocusRef = useRef<string | null>(null);

  const notesText =
    editingNotes === null ? "" : notesDrafts[editingNotes] ?? "";
  const discardNotesDraft = (id: string) => {
    setNotesDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };
  const closeNotes = (id: string) => {
    notesReturnFocusRef.current = id;
    setEditingNotes(null);
    discardNotesDraft(id);
  };
  useEffect(() => {
    if (editingNotes === null && notesReturnFocusRef.current !== null) {
      noteButtonsRef.current.get(notesReturnFocusRef.current)?.focus();
      notesReturnFocusRef.current = null;
    }
  }, [editingNotes]);

  useEffect(() => {
    if (showSearch) searchInputRef.current?.focus();
  }, [showSearch]);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const invalidateSearch = useCallback(() => {
    const nextGeneration = searchGenerationRef.current + 1;
    searchGenerationRef.current = nextGeneration;
    setSearchGeneration(nextGeneration);
  }, []);

  const reload = useCallback(async () => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setIsLoading(true);
    setLoadErrorMessage(null);
    try {
      const result = await listConvexSyllabus(convex);
      if (loadGenerationRef.current === generation) {
        setEntries(result);
      }
    } catch {
      if (loadGenerationRef.current === generation) {
        setLoadErrorMessage("Your syllabus could not be loaded.");
      }
    } finally {
      if (loadGenerationRef.current === generation) {
        setIsLoading(false);
      }
    }
  }, [convex]);

  useEffect(() => {
    void reload();
  }, [appUserId, reload]);

  useEffect(() => {
    const analysis = analyzeMovieYearQuery(searchInput);
    const query = analysis.normalizedQuery;
    const generation = searchGenerationRef.current;
    if (query.length < 2 || analysis.syntax === "incomplete") {
      setSearchingGeneration(null);
      return;
    }
    setSearchingGeneration(generation);
    const timeout = window.setTimeout(() => {
      void Promise.allSettled([
        searchConvexCatalogMovies(convex, query),
        searchConvexTmdbMovies(convex, query),
      ]).then(([catalogResult, tmdbResult]) => {
        if (searchGenerationRef.current !== generation) {
          return;
        }
        const catalogMovies =
          catalogResult.status === "fulfilled" ? catalogResult.value : [];
        const tmdbMovies =
          tmdbResult.status === "fulfilled" ? tmdbResult.value : [];
        const catalogTmdbIds = new Set(
          catalogMovies.flatMap((movie) =>
            movie.tmdbId === null ? [] : [movie.tmdbId]
          )
        );
        const combinedResults: SearchResult[] = [
          ...catalogMovies.map(
            (movie): SearchResult => ({ kind: "catalog", movie })
          ),
          ...tmdbMovies.flatMap((movie): SearchResult[] => {
            const year = getPlainDateYear(movie.release_date);
            return movie.poster_path === null ||
              year === null ||
              catalogTmdbIds.has(movie.id)
              ? []
              : [{ kind: "tmdb", movie, year }];
          }),
        ];
        const syllabusEntries = entriesRef.current;
        const syllabusMovieIds = new Set(
          syllabusEntries.map((entry) => entry.movie.id)
        );
        const syllabusTmdbIds = new Set(
          syllabusEntries.flatMap((entry) =>
            entry.movie.tmdbId === null ? [] : [entry.movie.tmdbId]
          )
        );
        const visibleResults = combinedResults.filter((result) =>
          result.kind === "catalog"
            ? !syllabusMovieIds.has(result.movie.id)
            : !syllabusTmdbIds.has(result.movie.id)
        );
        setSearchSnapshot({
          generation,
          requestQuery: query,
          mediaKind: "movie",
          tmdbStatus:
            tmdbResult.status === "fulfilled" ? "fulfilled" : "rejected",
          visibleResults: prioritizeExactMovieMatches(
            visibleResults,
            query,
            (result) => result.movie.title
          ),
        });
        setSearchingGeneration(null);
      });
    }, 300);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [convex, searchInput]);

  const pending = useMemo(() => pendingEntries(entries), [entries]);
  const assigned = useMemo(() => assignedEntries(entries), [entries]);
  const filteredPending = pending
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) =>
      `${entry.movie.title} ${notesDrafts[entry.id] ?? entry.notes ?? ""}`
        .toLowerCase()
        .includes(queueFilter.trim().toLowerCase())
    );
  const displayedErrorMessage = errorMessage ?? loadErrorMessage;
  const searchAnalysis = analyzeMovieYearQuery(searchInput);
  const currentSearchSnapshot =
    searchSnapshot?.generation === searchGeneration &&
    searchSnapshot.requestQuery === searchAnalysis.normalizedQuery &&
    searchSnapshot.mediaKind === "movie"
      ? searchSnapshot
      : null;
  const isSearching = searchingGeneration === searchGeneration;
  const searchPhase = isSearching
    ? "searching"
    : currentSearchSnapshot
    ? "settled"
    : "idle";
  const visibleSearchResults = currentSearchSnapshot?.visibleResults ?? [];
  const movieYearHint = useMovieYearHint({
    mediaKind: "movie",
    currentInput: searchInput,
    requestQuery: currentSearchSnapshot?.requestQuery ?? "",
    phase: searchPhase,
    tmdbStatus: currentSearchSnapshot?.tmdbStatus ?? "not-run",
    visibleResultCount: visibleSearchResults.length,
    requestGeneration: searchGeneration,
  });
  const externalSearchUnavailable =
    currentSearchSnapshot?.tmdbStatus === "rejected";

  const updateSearchInput = (value: string) => {
    invalidateSearch();
    setSearchInput(value);
  };

  const applyYearHint = (action: MovieYearHintAction) => {
    const applied = applyMovieYearHint(searchInput, action);
    if (!applied) {
      return;
    }
    flushSync(() => {
      updateSearchInput(applied.query);
    });
    searchInputRef.current?.focus();
    searchInputRef.current?.setSelectionRange(applied.caret, applied.caret);
  };

  const addMovie = async (result: SearchResult) => {
    setBusyOperation(`add:${String(result.movie.id)}`);
    setErrorMessage(null);
    try {
      const movie =
        result.kind === "catalog"
          ? result.movie
          : await upsertConvexTmdbMovie(convex, result.movie, result.year);
      await addConvexSyllabusEntry(convex, movie.id, insertPosition);
      invalidateSearch();
      setSearchInput("");
      setShowSearch(false);
      await reload();
    } catch (error) {
      setErrorMessage(operationError(error));
    } finally {
      setBusyOperation(null);
    }
  };

  const removeEntry = async (id: string) => {
    setBusyOperation(`remove:${id}`);
    setErrorMessage(null);
    try {
      await removeConvexSyllabusEntry(convex, id);
      setEntries((current) => current.filter((entry) => entry.id !== id));
      discardNotesDraft(id);
      if (editingNotes === id) setEditingNotes(null);
      setEntryToRemove(null);
    } catch (error) {
      setErrorMessage(operationError(error));
    } finally {
      setBusyOperation(null);
    }
  };

  const persistPendingOrder = async (
    reorderedPending: ConvexSyllabusEntry[]
  ) => {
    const previousEntries = entries;
    setEntries([...reorderedPending, ...assigned]);
    setBusyOperation("reorder");
    setErrorMessage(null);
    try {
      await reorderConvexSyllabus(
        convex,
        reorderedPending.map((entry) => entry.id)
      );
      await reload();
    } catch (error) {
      setEntries(previousEntries);
      setErrorMessage(operationError(error));
    } finally {
      setBusyOperation(null);
    }
  };

  const moveEntry = (id: string, targetIndex: number) => {
    if (busyOperation !== null) {
      return;
    }
    const currentIndex = pending.findIndex((entry) => entry.id === id);
    if (
      currentIndex < 0 ||
      targetIndex < 0 ||
      targetIndex >= pending.length ||
      currentIndex === targetIndex
    ) {
      return;
    }
    const nextPending = [...pending];
    const [entry] = nextPending.splice(currentIndex, 1);
    if (entry === undefined) {
      return;
    }
    nextPending.splice(targetIndex, 0, entry);
    void persistPendingOrder(nextPending);
  };

  const saveNotes = async (id: string) => {
    setBusyOperation(`notes:${id}`);
    setErrorMessage(null);
    try {
      const updated = await updateConvexSyllabusNotes(
        convex,
        id,
        notesText.trim() || null
      );
      setEntries((current) =>
        current.map((entry) => (entry.id === id ? updated : entry))
      );
      closeNotes(id);
    } catch (error) {
      setErrorMessage(operationError(error));
    } finally {
      setBusyOperation(null);
    }
  };

  if (isLoading && entries.length === 0) {
    return (
      <div
        className="h-48 w-full max-w-4xl animate-pulse rounded-lg bg-white/[0.04]"
        aria-label="Loading syllabus entries"
      />
    );
  }

  return (
    <div className="flex w-full max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button
          ref={addMovieButtonRef}
          variant="outline"
          disabled={busyOperation !== null}
          onClick={() => {
            invalidateSearch();
            if (showSearch) {
              setSearchInput("");
              setSearchingGeneration(null);
            }
            setShowSearch((visible) => !visible);
          }}
        >
          {showSearch ? "Cancel movie search" : "Add movie"}
        </Button>
        {showSearch ? (
          <label className="flex items-center gap-2 text-sm">
            Add position
            <select
              disabled={busyOperation !== null}
              value={insertPosition}
              onChange={(event) =>
                setInsertPosition(event.target.value as SyllabusInsertPosition)
              }
              className="rounded-md border border-gray-700 bg-gray-800 px-3 py-2"
            >
              {syllabusInsertPositions.map((position) => (
                <option key={position} value={position}>
                  {syllabusInsertPositionLabels[position]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {showSearch ? (
        <section className="space-y-3 rounded-lg border border-white/10 p-4">
          <div className="relative">
            <label htmlFor="convex-movie-search" className="sr-only">
              Search movies
            </label>
            <Input
              id="convex-movie-search"
              ref={searchInputRef}
              value={searchInput}
              disabled={busyOperation !== null}
              onChange={(event) => updateSearchInput(event.target.value)}
              placeholder="Search for a movie..."
              className="pl-9"
            />
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
          </div>
          {externalSearchUnavailable ? (
            <p className="text-xs text-amber-300">
              External movie search is unavailable; migrated catalog matches are
              still shown.
            </p>
          ) : null}
          {isSearching ? (
            <p className="flex items-center gap-2 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching movies...
            </p>
          ) : null}
          {searchPhase === "settled" ? (
            <MovieYearSearchHint
              hint={movieYearHint}
              query={currentSearchSnapshot?.requestQuery ?? ""}
              onAction={applyYearHint}
            />
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {visibleSearchResults.map((result) => {
              const movie =
                result.kind === "catalog"
                  ? result.movie
                  : {
                      id: String(result.movie.id),
                      tmdbId: result.movie.id,
                      title: result.movie.title,
                      year: result.year,
                      poster: result.movie.poster_path,
                      url:
                        result.movie.imdb_path ??
                        `https://www.themoviedb.org/movie/${String(
                          result.movie.id
                        )}`,
                    };
              const key = `${result.kind}:${String(result.movie.id)}`;
              return (
                <div
                  key={key}
                  className="flex items-center gap-3 rounded-lg border border-white/10 p-3"
                >
                  <MovieInlinePreview
                    movie={movie}
                    responsive
                    imageClassName="h-[108px] w-[72px] sm:h-[108px] sm:w-[72px]"
                    sizes="72px"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{movie.title}</p>
                    <p className="text-sm text-zinc-400">{movie.year}</p>
                    <Button
                      className="mt-2"
                      size="sm"
                      disabled={busyOperation !== null}
                      onClick={() => void addMovie(result)}
                    >
                      {busyOperation === `add:${String(result.movie.id)}`
                        ? "Adding..."
                        : "Add"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {displayedErrorMessage ? (
        <div
          className="flex items-center gap-3 text-sm text-red-300"
          role="alert"
        >
          <p>{displayedErrorMessage}</p>
          {loadErrorMessage !== null && !entryToRemove ? (
            <Button
              variant="outline"
              disabled={isLoading || busyOperation !== null}
              onClick={() => void reload()}
            >
              Retry loading
            </Button>
          ) : null}
        </div>
      ) : null}

      {busyOperation === "reorder" ? (
        <p
          className="flex items-center justify-center gap-2 text-sm text-zinc-400"
          role="status"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          Saving order...
        </p>
      ) : null}

      <section
        className="flex flex-col gap-3"
        aria-labelledby="syllabus-queue-heading"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="syllabus-queue-heading" className="text-lg font-bold">
            Up next{" "}
            <span className="text-muted-foreground">({pending.length})</span>
          </h2>
          <Input
            aria-label="Filter your queue"
            placeholder="Filter your queue…"
            value={queueFilter}
            onChange={(event) => setQueueFilter(event.target.value)}
            className="sm:max-w-xs"
          />
        </div>
        {queueFilter.trim() ? (
          <p className="text-sm text-muted-foreground">
            Positions and order controls refer to your full queue.
          </p>
        ) : null}
        {pending.length === 0 && !displayedErrorMessage ? (
          <p className="bbpc-panel p-5 text-muted-foreground">
            Add your first movie. The movie at the top is your next assignment
            when you win the bonus spin.
          </p>
        ) : null}
        {pending.length > 0 && filteredPending.length === 0 ? (
          <p role="status" className="text-muted-foreground">
            No queued movies match this filter.
          </p>
        ) : null}
        {filteredPending.map(({ entry, index }) => (
          <div
            key={entry.id}
            className={cn(
              "flex items-start gap-2 rounded-lg border p-3 sm:gap-4 sm:p-4",
              index === 0 && "border-red-500/70 bg-red-500/5"
            )}
          >
            <div className="flex flex-col gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => moveEntry(entry.id, 0)}
                disabled={index === 0 || busyOperation !== null}
                aria-label={`Send to top ${entry.movie.title}`}
              >
                <ChevronsUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => moveEntry(entry.id, index - 1)}
                disabled={index === 0 || busyOperation !== null}
                aria-label={`Move up ${entry.movie.title}`}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => moveEntry(entry.id, index + 1)}
                disabled={
                  index === pending.length - 1 || busyOperation !== null
                }
                aria-label={`Move down ${entry.movie.title}`}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-3">
                <MovieInlinePreview
                  movie={entry.movie}
                  responsive
                  className="shrink-0"
                  imageClassName="h-[72px] w-12 rounded-md sm:h-24 sm:w-16 md:h-24 md:w-16"
                  sizes="(min-width: 640px) 64px, 48px"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="text-xs font-bold tabular-nums text-muted-foreground"
                      aria-label={`Position ${index + 1}`}
                    >
                      #{index + 1}
                    </span>
                    <h3 className="break-words text-lg font-semibold">
                      {entry.movie.title}
                    </h3>
                    {index === 0 ? (
                      <span className="rounded-full border border-red-500/60 bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-red-200">
                        Next
                      </span>
                    ) : null}
                  </div>
                  <p className="text-gray-400">{entry.movie.year}</p>
                </div>
              </div>

              <div className="mt-3">
                {editingNotes === entry.id ? (
                  <div className="space-y-2">
                    <Textarea
                      value={notesText}
                      aria-label={`Notes for ${entry.movie.title}`}
                      autoFocus
                      disabled={busyOperation !== null}
                      maxLength={5000}
                      onChange={(event) =>
                        setNotesDrafts((current) => ({
                          ...current,
                          [entry.id]: event.target.value,
                        }))
                      }
                      placeholder="Add your notes here..."
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={busyOperation !== null}
                        onClick={() => void saveNotes(entry.id)}
                      >
                        <Save className="mr-1 h-3 w-3" />
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyOperation !== null}
                        onClick={() => {
                          closeNotes(entry.id);
                        }}
                      >
                        <X className="mr-1 h-3 w-3" />
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                        {notesDrafts[entry.id] ?? entry.notes ?? "No notes yet"}
                      </p>
                      {notesDrafts[entry.id] !== undefined &&
                      notesDrafts[entry.id] !== (entry.notes ?? "") ? (
                        <p className="mt-1 text-xs text-amber-200">
                          Unsaved notes
                        </p>
                      ) : null}
                    </div>
                    <Button
                      ref={(node) => {
                        if (node) noteButtonsRef.current.set(entry.id, node);
                        else noteButtonsRef.current.delete(entry.id);
                      }}
                      variant="ghost"
                      size="sm"
                      disabled={busyOperation !== null}
                      onClick={() => {
                        setEditingNotes(entry.id);
                        setNotesDrafts((current) => ({
                          ...current,
                          [entry.id]: current[entry.id] ?? entry.notes ?? "",
                        }));
                      }}
                      aria-label={`Edit notes ${entry.movie.title}`}
                    >
                      <Edit3 className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <Button
              variant="ghost"
              size="icon"
              disabled={busyOperation !== null}
              onClick={(event) => {
                removeTriggerRef.current = event.currentTarget;
                setErrorMessage(null);
                setEntryToRemove(entry);
              }}
              aria-label={`Remove movie ${entry.movie.title}`}
            >
              <X className="h-4 w-4 text-red-500" />
            </Button>
          </div>
        ))}
      </section>

      <details className="bbpc-panel p-3 sm:p-4">
        <summary className="min-h-11 cursor-pointer py-2 font-bold">
          Assigned ({assigned.length})
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          {assigned.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Your assigned movies will appear here.
            </p>
          ) : null}
          {assigned.map((entry) => (
            <div key={entry.id} className="rounded-lg border p-4">
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]">
                <MovieInlinePreview
                  movie={entry.movie}
                  responsive
                  className="row-span-2 shrink-0 sm:row-span-1"
                  imageClassName="h-[72px] w-12 rounded-md sm:h-24 sm:w-16 md:h-24 md:w-16"
                  sizes="(min-width: 640px) 64px, 48px"
                />
                <div className="min-w-0">
                  <h3 className="break-words text-lg font-semibold">
                    {entry.movie.title}
                  </h3>
                  <p className="text-gray-400">{entry.movie.year}</p>
                </div>
                <p className="col-start-2 min-w-0 break-words text-sm text-muted-foreground sm:col-start-auto">
                  Reviewed in Episode {entry.assignment?.episode.number}:{" "}
                  {entry.assignment?.episode.title}
                </p>
              </div>
              {entry.notes ? (
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                  {entry.notes}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </details>
      <Dialog
        open={entryToRemove !== null}
        onOpenChange={(open) => {
          if (!open && busyOperation === null) setEntryToRemove(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const trigger = removeTriggerRef.current;
            if (trigger?.isConnected) trigger.focus();
            else addMovieButtonRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Remove {entryToRemove?.movie.title}?</DialogTitle>
            <DialogDescription>
              This removes the movie from your queue. Its notes, including any
              unsaved draft, will be deleted. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {errorMessage ? (
            <p role="alert" className="text-sm text-red-300">
              {errorMessage}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              autoFocus
              disabled={busyOperation !== null}
              onClick={() => setEntryToRemove(null)}
            >
              Keep movie
            </Button>
            <Button
              variant="destructive"
              disabled={busyOperation !== null}
              onClick={() =>
                entryToRemove && void removeEntry(entryToRemove.id)
              }
            >
              {busyOperation?.startsWith("remove:")
                ? "Removing…"
                : "Remove movie"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
