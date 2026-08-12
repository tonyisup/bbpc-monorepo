"use client";

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

import MovieInlinePreview from "@/components/MovieInlinePreview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesText, setNotesText] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [externalSearchUnavailable, setExternalSearchUnavailable] =
    useState(false);
  const [insertPosition, setInsertPosition] =
    useState<SyllabusInsertPosition>("END");
  const loadGenerationRef = useRef(0);
  const searchGenerationRef = useRef(0);

  const reload = useCallback(async () => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const result = await listConvexSyllabus(convex);
      if (loadGenerationRef.current === generation) {
        setEntries(result);
      }
    } catch {
      if (loadGenerationRef.current === generation) {
        setErrorMessage("Your syllabus could not be loaded.");
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
    const query = searchInput.trim();
    const generation = searchGenerationRef.current + 1;
    searchGenerationRef.current = generation;
    if (query.length < 2) {
      setSearchResults([]);
      setExternalSearchUnavailable(false);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
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
        setSearchResults([
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
        ]);
        setExternalSearchUnavailable(tmdbResult.status === "rejected");
        setIsSearching(false);
      });
    }, 300);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [convex, searchInput]);

  const pending = useMemo(() => pendingEntries(entries), [entries]);
  const assigned = useMemo(() => assignedEntries(entries), [entries]);
  const visibleSearchResults = useMemo(() => {
    const syllabusMovieIds = new Set(entries.map((entry) => entry.movie.id));
    const syllabusTmdbIds = new Set(
      entries.flatMap((entry) =>
        entry.movie.tmdbId === null ? [] : [entry.movie.tmdbId]
      )
    );
    return searchResults.filter((result) =>
      result.kind === "catalog"
        ? !syllabusMovieIds.has(result.movie.id)
        : !syllabusTmdbIds.has(result.movie.id)
    );
  }, [entries, searchResults]);

  const addMovie = async (result: SearchResult) => {
    setBusyOperation(`add:${String(result.movie.id)}`);
    setErrorMessage(null);
    try {
      const movie =
        result.kind === "catalog"
          ? result.movie
          : await upsertConvexTmdbMovie(convex, result.movie, result.year);
      await addConvexSyllabusEntry(convex, movie.id, insertPosition);
      setSearchInput("");
      setSearchResults([]);
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
      setEditingNotes(null);
      setNotesText("");
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
          variant="outline"
          onClick={() => setShowSearch((visible) => !visible)}
        >
          {showSearch ? "Cancel movie search" : "Add movie"}
        </Button>
        {showSearch ? (
          <label className="flex items-center gap-2 text-sm">
            Add position
            <select
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
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
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
          <div className="grid gap-3 sm:grid-cols-2">
            {visibleSearchResults.map((result) => {
              const movie =
                result.kind === "catalog"
                  ? result.movie
                  : {
                      id: String(result.movie.id),
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

      {errorMessage ? (
        <p className="text-sm text-red-300" role="alert">
          {errorMessage}
        </p>
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

      <section className="flex flex-col gap-4">
        {pending.map((entry, index) => (
          <div
            key={entry.id}
            className={cn(
              "flex items-start gap-4 rounded-lg border p-4",
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
              <div className="flex items-center gap-4">
                <MovieInlinePreview movie={entry.movie} responsive />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold">
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
                      maxLength={5000}
                      onChange={(event) => setNotesText(event.target.value)}
                      placeholder="Add your notes here..."
                    />
                    <div className="flex gap-2">
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
                          setEditingNotes(null);
                          setNotesText("");
                        }}
                      >
                        <X className="mr-1 h-3 w-3" />
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm text-gray-400">
                      {entry.notes ?? "No notes yet"}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyOperation !== null}
                      onClick={() => {
                        setEditingNotes(entry.id);
                        setNotesText(entry.notes ?? "");
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
              onClick={() => void removeEntry(entry.id)}
              aria-label={`Remove movie ${entry.movie.title}`}
            >
              <X className="h-4 w-4 text-red-500" />
            </Button>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Assigned</h2>
        {assigned.map((entry) => (
          <div key={entry.id} className="rounded-lg border p-4">
            <div className="flex items-center gap-4">
              <MovieInlinePreview movie={entry.movie} responsive />
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-semibold">{entry.movie.title}</h3>
                <p className="text-gray-400">{entry.movie.year}</p>
              </div>
              <p className="text-sm text-zinc-400">
                Reviewed in Episode {entry.assignment?.episode.number}:{" "}
                {entry.assignment?.episode.title}
              </p>
            </div>
            {entry.notes ? (
              <p className="mt-2 whitespace-pre-wrap text-sm text-gray-400">
                {entry.notes}
              </p>
            ) : null}
          </div>
        ))}
      </section>
    </div>
  );
}
