import { useConvex } from "convex/react";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import Head from "next/head";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  type ConvexAdminEpisode,
  type ConvexAdminEpisodeDateRange,
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
  const [episodes, setEpisodes] = useState<ConvexAdminEpisode[] | null>(null);
  const [continueCursor, setContinueCursor] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateRange, setDateRange] = useState<ConvexAdminEpisodeDateRange>({});
  const requestVersion = useRef(0);
  const rangeIsInvalid = dateFrom !== "" && dateTo !== "" && dateFrom > dateTo;
  const hasDateFilter = Boolean(dateRange.dateFrom || dateRange.dateTo);

  useEffect(() => {
    const version = ++requestVersion.current;
    setLoadFailed(false);
    void loadConvexAdminEpisodesPage(convex, null, dateRange)
      .then((result) => {
        if (version === requestVersion.current) {
          setEpisodes(result.episodes);
          setContinueCursor(result.continueCursor);
          setIsDone(result.isDone);
        }
      })
      .catch(() => {
        if (version === requestVersion.current) {
          setLoadFailed(true);
        }
      });
    return () => {
      requestVersion.current += 1;
    };
  }, [convex, revision, dateRange]);

  const refresh = () => {
    requestVersion.current += 1;
    setEpisodes(null);
    setContinueCursor(null);
    setIsDone(true);
    setIsLoadingMore(false);
    setRevision((value) => value + 1);
  };

  const loadMore = () => {
    if (isDone || continueCursor === null || isLoadingMore) {
      return;
    }
    const version = requestVersion.current;
    setIsLoadingMore(true);
    void loadConvexAdminEpisodesPage(convex, continueCursor, dateRange)
      .then((result) => {
        if (version !== requestVersion.current) return;
        setEpisodes((current) => [...(current ?? []), ...result.episodes]);
        setContinueCursor(result.continueCursor);
        setIsDone(result.isDone);
      })
      .catch(() => {
        if (version === requestVersion.current) {
          toast.error("The next episode page could not be loaded.");
        }
      })
      .finally(() => {
        if (version === requestVersion.current) setIsLoadingMore(false);
      });
  };

  const createEpisode = (input: { number: number; title: string }) => {
    setIsCreating(true);
    void createConvexAdminEpisode(convex, input)
      .then(() => {
        toast.success("Pending episode created.");
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
              Browse the paginated episode catalog and create pending episodes.
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

        <form
          aria-label="Filter episodes by date"
          className="space-y-3 rounded-md border bg-card p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (rangeIsInvalid) return;
            setDateRange({
              ...(dateFrom ? { dateFrom } : {}),
              ...(dateTo ? { dateTo } : {}),
            });
            refresh();
          }}
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid w-full gap-2 sm:w-auto">
              <Label htmlFor="episode-date-from">From</Label>
              <Input
                aria-describedby={
                  rangeIsInvalid ? "episode-date-error" : "episode-date-help"
                }
                aria-invalid={rangeIsInvalid}
                id="episode-date-from"
                max={dateTo || "9999-12-31"}
                onChange={(event) => setDateFrom(event.target.value)}
                type="date"
                value={dateFrom}
              />
            </div>
            <div className="grid w-full gap-2 sm:w-auto">
              <Label htmlFor="episode-date-to">To</Label>
              <Input
                aria-describedby={
                  rangeIsInvalid ? "episode-date-error" : "episode-date-help"
                }
                aria-invalid={rangeIsInvalid}
                id="episode-date-to"
                max="9999-12-31"
                min={dateFrom || undefined}
                onChange={(event) => setDateTo(event.target.value)}
                type="date"
                value={dateTo}
              />
            </div>
            <Button disabled={rangeIsInvalid} type="submit">
              Apply
            </Button>
            <Button
              disabled={!dateFrom && !dateTo && !hasDateFilter}
              onClick={() => {
                setDateFrom("");
                setDateTo("");
                setDateRange({});
                refresh();
              }}
              type="button"
              variant="outline"
            >
              Clear
            </Button>
          </div>
          <p className="text-sm text-muted-foreground" id="episode-date-help">
            Filter by episode date, including both dates. Leave either field
            blank for an open-ended range.
          </p>
          {rangeIsInvalid && (
            <p
              className="text-sm text-destructive"
              id="episode-date-error"
              role="alert"
            >
              From must be on or before To.
            </p>
          )}
          {hasDateFilter && (
            <p className="text-sm" role="status">
              Showing episodes{" "}
              {dateRange.dateFrom
                ? `from ${formatPlainDate(dateRange.dateFrom)} `
                : ""}
              {dateRange.dateTo
                ? `through ${formatPlainDate(dateRange.dateTo)}`
                : "onward"}
              , newest date first.
            </p>
          )}
        </form>

        {loadFailed ? (
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
                      {hasDateFilter
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

        {!isDone && episodes !== null && (
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
