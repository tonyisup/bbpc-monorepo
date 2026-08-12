import { useConvex } from "convex/react";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import Head from "next/head";
import Link from "next/link";
import { useEffect, useState } from "react";
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
  const [episodes, setEpisodes] = useState<ConvexAdminEpisode[] | null>(
    null
  );
  const [continueCursor, setContinueCursor] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    void loadConvexAdminEpisodesPage(convex, null)
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
    };
  }, [convex, revision]);

  const refresh = () => {
    setEpisodes(null);
    setContinueCursor(null);
    setIsDone(true);
    setRevision((value) => value + 1);
  };

  const loadMore = () => {
    if (isDone || continueCursor === null || isLoadingMore) {
      return;
    }
    setIsLoadingMore(true);
    void loadConvexAdminEpisodesPage(convex, continueCursor)
      .then((result) => {
        setEpisodes((current) => [
          ...(current ?? []),
          ...result.episodes,
        ]);
        setContinueCursor(result.continueCursor);
        setIsDone(result.isDone);
      })
      .catch(() => {
        toast.error("The next episode page could not be loaded.");
      })
      .finally(() => setIsLoadingMore(false));
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
          Episode workbenches are available for canonical slugs. Assignment
          and extra relationship editing remains in dedicated routes.
        </div>

        {loadFailed ? (
          <div className="rounded-md border bg-card p-8 text-center">
            <p className="mb-4 text-sm text-muted-foreground">
              Episodes could not be loaded. No legacy SQL fallback was
              attempted.
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
                      No episodes found.
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
