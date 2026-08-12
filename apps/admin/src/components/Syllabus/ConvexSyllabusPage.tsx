import { useConvex } from "convex/react";
import { BookOpen, Loader2, RefreshCw, Trash2, User } from "lucide-react";
import Head from "next/head";
import Image from "next/image";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { getConvexDomainErrorCode } from "@/convex/identity";
import {
  type ConvexAdminSyllabusEntry,
  loadConvexAdminSyllabusPage,
  removeConvexAdminSyllabusEntry,
} from "@/convex/syllabus";
import { formatInstantLocal } from "@/lib/dates";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ConfirmModal } from "../ui/confirm-modal";
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
    case "NOT_FOUND":
      return "That syllabus entry no longer exists.";
    case "WRITE_DISABLED":
      return "Syllabus changes are paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    default:
      return "The syllabus entry could not be removed.";
  }
}

function userLabel(entry: ConvexAdminSyllabusEntry): string {
  return entry.user.name ?? entry.user.email ?? "Unknown user";
}

export function ConvexSyllabusPage() {
  const convex = useConvex();
  const [entries, setEntries] = useState<
    ConvexAdminSyllabusEntry[] | null
  >(null);
  const [continueCursor, setContinueCursor] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const [removingEntry, setRemovingEntry] =
    useState<ConvexAdminSyllabusEntry | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    void loadConvexAdminSyllabusPage(convex, null)
      .then((result) => {
        if (active) {
          setEntries(result.entries);
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
    setEntries(null);
    setContinueCursor(null);
    setIsDone(true);
    setRevision((value) => value + 1);
  };

  const loadMore = () => {
    if (isDone || continueCursor === null || isLoadingMore) {
      return;
    }
    setIsLoadingMore(true);
    void loadConvexAdminSyllabusPage(convex, continueCursor)
      .then((result) => {
        setEntries((current) => [...(current ?? []), ...result.entries]);
        setContinueCursor(result.continueCursor);
        setIsDone(result.isDone);
      })
      .catch(() => {
        toast.error("The next syllabus page could not be loaded.");
      })
      .finally(() => {
        setIsLoadingMore(false);
      });
  };

  const removeEntry = (entry: ConvexAdminSyllabusEntry) => {
    setPendingAction(entry.id);
    void removeConvexAdminSyllabusEntry(convex, entry.id)
      .then(() => {
        toast.success("Syllabus entry removed.");
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(mutationFailureMessage(error));
      })
      .finally(() => {
        setPendingAction(null);
      });
  };

  return (
    <>
      <Head>
        <title>Global Syllabus - BBPC Admin</title>
      </Head>
      <ConfirmModal
        confirmText="Remove entry"
        description={
          removingEntry === null
            ? ""
            : `Remove “${removingEntry.movie.title}” from ${userLabel(removingEntry)}’s syllabus? The movie and any assignment record are preserved.`
        }
        isOpen={removingEntry !== null}
        onClose={() => setRemovingEntry(null)}
        onConfirm={() => {
          if (removingEntry !== null) {
            removeEntry(removingEntry);
          }
        }}
        title="Remove syllabus entry"
      />

      <div className="flex flex-col gap-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">
            Global Syllabus
          </h2>
          <p className="text-muted-foreground">
            Review all user movie syllabuses.
            {entries === null ? "" : ` (${entries.length} shown)`}
          </p>
        </div>

        {loadFailed ? (
          <div className="rounded-md border bg-card p-8 text-center">
            <p className="mb-4 text-sm text-muted-foreground">
              Syllabus entries could not be loaded. No legacy SQL fallback was
              attempted.
            </p>
            <Button onClick={refresh} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          </div>
        ) : (
          <div className="rounded-md border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Movie</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Added On</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries === null && (
                  <TableRow>
                    <TableCell className="h-24 text-center" colSpan={5}>
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                )}
                {entries?.length === 0 && (
                  <TableRow>
                    <TableCell className="h-24 text-center" colSpan={5}>
                      No syllabus items found.
                    </TableCell>
                  </TableRow>
                )}
                {entries?.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">
                          {userLabel(entry)}
                        </span>
                        {entry.user.status === "disabled" && (
                          <Badge variant="secondary">Disabled</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {entry.movie.poster === null ? (
                          <div className="flex h-12 w-8 items-center justify-center rounded bg-muted">
                            <BookOpen className="h-4 w-4 text-muted-foreground" />
                          </div>
                        ) : (
                          <div className="relative h-12 w-8 flex-shrink-0 overflow-hidden rounded shadow-sm">
                            <Image
                              alt={entry.movie.title}
                              className="object-cover"
                              fill
                              src={entry.movie.poster}
                              unoptimized
                            />
                          </div>
                        )}
                        <div className="flex flex-col">
                          <span className="line-clamp-1 font-bold">
                            {entry.movie.title}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {entry.movie.year}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {entry.assignment === null ? (
                        <Badge variant="outline">Pending</Badge>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <Badge className="w-fit" variant="default">
                            Assigned
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            Ep {entry.assignment.episode.number}:{" "}
                            {entry.assignment.episode.title}
                          </span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatInstantLocal(new Date(entry.createdAt))}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        aria-label={`Remove ${entry.movie.title}`}
                        disabled={pendingAction !== null}
                        onClick={() => setRemovingEntry(entry)}
                        size="icon"
                        variant="ghost"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {!isDone && entries !== null && (
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
