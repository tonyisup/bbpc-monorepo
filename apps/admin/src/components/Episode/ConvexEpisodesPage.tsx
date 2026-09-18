import { useConvex } from "convex/react";
import { Loader2, Plus, RefreshCw, Search, X } from "lucide-react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  type ConvexAdminEpisode,
  createConvexAdminEpisode,
  loadConvexAdminEpisodesPage,
} from "@/convex/episodes";
import { getConvexDomainErrorCode } from "@/convex/identity";
import { formatPlainDate } from "@/lib/dates";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

import { EpisodeId } from "./EpisodeId";
import { EpisodeSearchResults } from "./EpisodeSearchResults";

const FUZZY_SEARCH_STORAGE_KEY = "bbpc-admin-episode-fuzzy-search";

function dateRangeError(from: string, to: string): string | null {
  for (const value of [from, to]) {
    if (!value) continue;
    const date = new Date(`${value}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    ) {
      return "Enter valid dates in YYYY-MM-DD format.";
    }
  }
  return from && to && from > to
    ? "The start date must be on or before the end date."
    : null;
}

function mutationFailureMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "CONFLICT":
      return "The episode number, title, or generated slug conflicts with existing data.";
    case "VALIDATION_FAILED":
      return "Use a title and an integer episode number from -32768 through 32767.";
    case "WRITE_DISABLED":
      return "Episode changes are paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    default:
      return "The episode could not be created.";
  }
}

function AddEpisodeDialog({
  isSaving,
  onClose,
  onSave,
}: {
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: { number: number; title: string }) => void;
}) {
  const [number, setNumber] = useState("");
  const [title, setTitle] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const parsedNumber = Number(number);
  const isValid =
    title.trim().length > 0 &&
    Number.isSafeInteger(parsedNumber) &&
    parsedNumber >= -32_768 &&
    parsedNumber <= 32_767;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add Episode</DialogTitle>
          <DialogDescription>
            Convex creates a pending episode and allocates a collision-safe
            slug.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="convex-episode-number">Episode Number</Label>
            <Input
              id="convex-episode-number"
              max={32_767}
              min={-32_768}
              onChange={(event) => setNumber(event.target.value)}
              step={1}
              type="number"
              value={number}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="convex-episode-title">Title</Label>
            <Input
              id="convex-episode-title"
              onChange={(event) => setTitle(event.target.value)}
              value={title}
            />
          </div>
          {showErrors && !isValid && (
            <p className="text-xs text-destructive">
              A title and integer episode number from -32768 through 32767 are
              required.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button disabled={isSaving} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={isSaving}
            onClick={() => {
              setShowErrors(true);
              if (isValid) {
                onSave({ number: parsedNumber, title: title.trim() });
              }
            }}
          >
            {isSaving ? "Creating..." : "Create Episode"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function statusVariant(
  status: string | null
): "default" | "secondary" | "outline" {
  if (status === "published") {
    return "default";
  }
  if (status === "recording" || status === "next") {
    return "secondary";
  }
  return "outline";
}

export function ConvexEpisodesPage() {
  const convex = useConvex();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [fuzzySearch, setFuzzySearch] = useState(true);
  const urlTimer = useRef<ReturnType<typeof setTimeout>>();
  const pageGeneration = useRef(0);
  const isSearching = query.trim().length > 0;
  const hasDateRange = Boolean(dateFrom || dateTo);
  const rangeError = dateRangeError(dateFrom, dateTo);

  useEffect(() => {
    if (!router.isReady) return;
    clearTimeout(urlTimer.current);
    setQuery(typeof router.query.q === "string" ? router.query.q : "");
    setDateFrom(typeof router.query.from === "string" ? router.query.from : "");
    setDateTo(typeof router.query.to === "string" ? router.query.to : "");
  }, [router.isReady, router.query.q, router.query.from, router.query.to]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(FUZZY_SEARCH_STORAGE_KEY);
      if (stored === "false") setFuzzySearch(false);
    } catch {
      /* Storage is optional. */
    }
    return () => clearTimeout(urlTimer.current);
  }, []);

  const updateFilterUrl = (search: string, from: string, to: string) => {
    clearTimeout(urlTimer.current);
    urlTimer.current = setTimeout(() => {
      const params = { ...router.query };
      if (search.trim()) params.q = search;
      else delete params.q;
      if (from) params.from = from;
      else delete params.from;
      if (to) params.to = to;
      else delete params.to;
      void router
        .replace({ pathname: router.pathname, query: params }, undefined, {
          shallow: true,
          scroll: false,
        })
        .catch(() => {
          // A cancelled navigation must not interrupt local search.
        });
    }, 500);
  };

  const changeQuery = (value: string) => {
    setQuery(value);
    updateFilterUrl(value, dateFrom, dateTo);
  };

  const changeDateRange = (from: string, to: string) => {
    setDateFrom(from);
    setDateTo(to);
    updateFilterUrl(query, from, to);
  };

  const changeFuzzySearch = (enabled: boolean) => {
    setFuzzySearch(enabled);
    try {
      localStorage.setItem(FUZZY_SEARCH_STORAGE_KEY, String(enabled));
    } catch {
      /* Storage is optional. */
    }
  };
  const [episodes, setEpisodes] = useState<ConvexAdminEpisode[] | null>(null);
  const [continueCursor, setContinueCursor] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    pageGeneration.current += 1;
    setLoadFailed(false);
    setEpisodes(null);
    setContinueCursor(null);
    setIsDone(true);
    setIsLoadingMore(false);
    if (rangeError || !router.isReady) return;
    void loadConvexAdminEpisodesPage(convex, null, {
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
    })
      .then((result) => {
        if (active) {
          setEpisodes(result.episodes);
          setContinueCursor(result.continueCursor);
          setIsDone(result.isDone);
        }
      })
      .catch(() => {
        if (active) {
          setLoadFailed(true);
        }
      });
    return () => {
      active = false;
      pageGeneration.current += 1;
    };
  }, [convex, revision, dateFrom, dateTo, rangeError, router.isReady]);

  const refresh = () => {
    pageGeneration.current += 1;
    setIsLoadingMore(false);
    setEpisodes(null);
    setContinueCursor(null);
    setIsDone(true);
    setRevision((value) => value + 1);
  };

  const loadMore = () => {
    if (isDone || continueCursor === null || isLoadingMore) {
      return;
    }
    const generation = pageGeneration.current;
    setIsLoadingMore(true);
    void loadConvexAdminEpisodesPage(convex, continueCursor, {
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
    })
      .then((result) => {
        if (generation !== pageGeneration.current) return;
        setEpisodes((current) => [...(current ?? []), ...result.episodes]);
        setContinueCursor(result.continueCursor);
        setIsDone(result.isDone);
      })
      .catch(() => {
        if (generation === pageGeneration.current)
          toast.error("The next episode page could not be loaded.");
      })
      .finally(() => {
        if (generation === pageGeneration.current) setIsLoadingMore(false);
      });
  };

  const createEpisode = (input: { number: number; title: string }) => {
    setIsCreating(true);
    void createConvexAdminEpisode(convex, input)
      .then((episode) => {
        toast.success("Pending episode created.", {
          duration: 5000,
          description: episode.slug ? (
            <Link
              className="font-medium underline underline-offset-4"
              href={`/episode/${episode.slug}`}
            >
              View episode
            </Link>
          ) : undefined,
        });
        setDialogOpen(false);
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(mutationFailureMessage(error));
      })
      .finally(() => setIsCreating(false));
  };

  return (
    <>
      <Head>
        <title>Episodes - BBPC Admin</title>
      </Head>
      {dialogOpen && (
        <AddEpisodeDialog
          isSaving={isCreating}
          onClose={() => setDialogOpen(false)}
          onSave={createEpisode}
        />
      )}

      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Episodes</h2>
            <p className="text-muted-foreground">
              Search the episode catalog, edit relationships, and create pending
              episodes.
            </p>
          </div>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Episode
          </Button>
        </div>

        <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
          Open an episode to edit its assignments and extra reviews.
        </div>

        <div className="space-y-3">
          <Label htmlFor="episode-search">Search episodes</Label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="episode-search"
                aria-label="Search episodes"
                className="pl-9"
                type="search"
                placeholder="Episode title, movie, show, transcript words, number, or ID"
                value={query}
                onChange={(event) => changeQuery(event.target.value)}
              />
            </div>
            {query && (
              <Button
                variant="outline"
                onClick={() => changeQuery("")}
                aria-label="Clear episode search"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                <span className="ml-2">Clear</span>
              </Button>
            )}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={fuzzySearch}
              onChange={(event) => changeFuzzySearch(event.target.checked)}
            />
            Match close spellings in titles
          </label>
          <p className="text-xs text-muted-foreground">
            Search episode numbers, titles, assigned movies, and extra-review
            movies and shows across all episode statuses. Transcripts match
            words, including the beginning of the last word. Coverage depends on
            available published transcripts.
          </p>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Episode date</legend>
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid min-w-0 flex-1 gap-2 sm:flex-none">
              <Label htmlFor="episode-date-from">From</Label>
              <Input
                id="episode-date-from"
                aria-label="Episode date from"
                aria-describedby={
                  rangeError ? "episode-date-error" : "episode-date-help"
                }
                aria-invalid={Boolean(rangeError)}
                className="w-full sm:w-44"
                type="date"
                min="0001-01-01"
                max={dateTo || "9999-12-31"}
                value={dateFrom}
                onChange={(event) => changeDateRange(event.target.value, dateTo)}
              />
            </div>
            <div className="grid min-w-0 flex-1 gap-2 sm:flex-none">
              <Label htmlFor="episode-date-to">To</Label>
              <Input
                id="episode-date-to"
                aria-label="Episode date to"
                aria-describedby={
                  rangeError ? "episode-date-error" : "episode-date-help"
                }
                aria-invalid={Boolean(rangeError)}
                className="w-full sm:w-44"
                type="date"
                min={dateFrom || "0001-01-01"}
                max="9999-12-31"
                value={dateTo}
                onChange={(event) =>
                  changeDateRange(dateFrom, event.target.value)
                }
              />
            </div>
            {hasDateRange && (
              <Button variant="outline" onClick={() => changeDateRange("", "")}>
                Clear dates
              </Button>
            )}
          </div>
          <p id="episode-date-help" className="text-xs text-muted-foreground">
            Includes both dates. Leave either date blank for an open-ended range.
            Episodes without a date are excluded when filtering.
          </p>
          {rangeError && (
            <p
              id="episode-date-error"
              role="alert"
              className="text-sm text-destructive"
            >
              {rangeError}
            </p>
          )}
        </fieldset>

        {rangeError ? null : isSearching ? (
          <EpisodeSearchResults
            key={`${revision}:${dateFrom}:${dateTo}`}
            query={query}
            fuzzy={fuzzySearch}
            dateFrom={dateFrom}
            dateTo={dateTo}
          />
        ) : loadFailed ? (
          <div className="rounded-md border bg-card p-8 text-center">
            <p className="mb-4 text-sm text-muted-foreground">
              Episodes could not be loaded. Try again.
            </p>
            <Button onClick={refresh} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          </div>
        ) : (
          <div className="rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Number</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Relationships</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {episodes === null && (
                  <TableRow>
                    <TableCell className="h-24 text-center" colSpan={5}>
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                )}
                {episodes?.length === 0 && (
                  <TableRow>
                    <TableCell className="h-24 text-center" colSpan={5}>
                      {hasDateRange
                        ? "No episodes found in this date range."
                        : "No episodes found."}
                    </TableCell>
                  </TableRow>
                )}
                {episodes?.map((episode) => (
                  <TableRow key={episode.id}>
                    <TableCell className="font-medium">
                      {episode.number}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        {episode.slug === null ? (
                          <span className="font-medium">{episode.title}</span>
                        ) : (
                          <Link
                            className="font-medium hover:text-primary"
                            href={`/episode/${episode.slug}`}
                          >
                            {episode.title}
                          </Link>
                        )}
                        <code className="text-xs text-muted-foreground">
                          {episode.slug ?? "No slug"}
                        </code>
                        <EpisodeId id={episode.id} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(episode.status)}>
                        {episode.status ?? "unset"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {episode.date === null
                        ? "-"
                        : formatPlainDate(episode.date)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {episode.assignments.length} assignments ·{" "}
                      {episode.extras.length} extras · {episode.links.length}{" "}
                      links
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {!rangeError && !isSearching && !loadFailed && !isDone && episodes !== null && (
          <div className="flex justify-center py-4">
            <Button
              className="w-full max-w-xs"
              disabled={isLoadingMore}
              onClick={loadMore}
              variant="outline"
            >
              {isLoadingMore && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {isLoadingMore ? "Loading more..." : "Load More"}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
