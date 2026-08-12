import { useConvex } from "convex/react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import Head from "next/head";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { getConvexDomainErrorCode } from "@/convex/identity";
import {
  type ConvexSideEffectIntent,
  type ConvexSideEffectStatus,
  loadConvexSideEffectPage,
  redriveConvexSideEffect,
} from "@/convex/sideEffects";
import { formatInstantLocal } from "@/lib/dates";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ConfirmModal } from "../ui/confirm-modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

type StatusFilter = "all" | ConvexSideEffectStatus;

const statusLabels: Record<ConvexSideEffectStatus, string> = {
  pending: "Pending",
  processing: "Processing",
  retryScheduled: "Retry scheduled",
  succeeded: "Succeeded",
  terminal: "Needs attention",
};

const resourceLabels: Record<
  ConvexSideEffectIntent["resourceType"],
  string
> = {
  episodeAudioMessage: "Episode audio",
  assignmentAudioMessage: "Assignment audio",
  profileImage: "Profile image",
};

function errorLabel(code: string | null): string {
  switch (code) {
    case "configuration_missing":
      return "UploadThing is not configured";
    case "provider_rejected":
      return "Provider rejected the request";
    case "provider_unavailable":
      return "Provider unavailable";
    default:
      return "—";
  }
}

function statusBadge(intent: ConvexSideEffectIntent) {
  if (intent.status === "succeeded") {
    return (
      <Badge className="gap-1" variant="default">
        <CheckCircle2 className="h-3 w-3" />
        {statusLabels[intent.status]}
      </Badge>
    );
  }
  if (intent.status === "terminal") {
    return (
      <Badge className="gap-1" variant="destructive">
        <AlertTriangle className="h-3 w-3" />
        {statusLabels[intent.status]}
      </Badge>
    );
  }
  return (
    <Badge className="gap-1" variant="secondary">
      <Clock3 className="h-3 w-3" />
      {statusLabels[intent.status]}
    </Badge>
  );
}

function redriveFailureMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "CONFLICT":
      return "This cleanup changed after it was loaded. Refresh before trying again.";
    case "WRITE_DISABLED":
      return "External cleanup is paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    default:
      return "The cleanup request could not be redriven.";
  }
}

export function ConvexSideEffectsPage() {
  const convex = useConvex();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [intents, setIntents] = useState<
    ConvexSideEffectIntent[] | null
  >(null);
  const [continueCursor, setContinueCursor] = useState<string | null>(
    null
  );
  const [isDone, setIsDone] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const [redriving, setRedriving] =
    useState<ConvexSideEffectIntent | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    setIntents(null);
    setContinueCursor(null);
    setIsDone(true);
    void loadConvexSideEffectPage(
      convex,
      null,
      filter === "all" ? undefined : filter
    )
      .then((result) => {
        if (active) {
          setIntents(result.intents);
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
  }, [convex, filter, revision]);

  const refresh = () => {
    setRevision((value) => value + 1);
  };

  const loadMore = () => {
    if (isDone || continueCursor === null || isLoadingMore) {
      return;
    }
    setIsLoadingMore(true);
    void loadConvexSideEffectPage(
      convex,
      continueCursor,
      filter === "all" ? undefined : filter
    )
      .then((result) => {
        setIntents((current) => [
          ...(current ?? []),
          ...result.intents,
        ]);
        setContinueCursor(result.continueCursor);
        setIsDone(result.isDone);
      })
      .catch(() => {
        toast.error("The next cleanup page could not be loaded.");
      })
      .finally(() => {
        setIsLoadingMore(false);
      });
  };

  const confirmRedrive = () => {
    const target = redriving;
    if (target === null) {
      return;
    }
    setPendingId(target.id);
    setRedriving(null);
    void redriveConvexSideEffect(convex, target)
      .then(() => {
        toast.success(
          target.status === "succeeded"
            ? "Remote cleanup reconciliation queued."
            : "Cleanup retry queued."
        );
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(redriveFailureMessage(error));
      })
      .finally(() => {
        setPendingId(null);
      });
  };

  return (
    <>
      <Head>
        <title>External Cleanup - BBPC Admin</title>
      </Head>
      <ConfirmModal
        confirmText={
          redriving?.status === "succeeded"
            ? "Reconcile again"
            : "Retry cleanup"
        }
        description={
          redriving === null
            ? ""
            : redriving.status === "succeeded"
              ? `Repeat the already successful ${resourceLabels[redriving.resourceType].toLowerCase()} deletion to reconcile remote state? UploadThing deletion is idempotent.`
              : `Retry the failed ${resourceLabels[redriving.resourceType].toLowerCase()} deletion now?`
        }
        isOpen={redriving !== null}
        onClose={() => setRedriving(null)}
        onConfirm={confirmRedrive}
        title={
          redriving?.status === "succeeded"
            ? "Reconcile remote state"
            : "Retry external cleanup"
        }
      />

      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">
              External Cleanup
            </h2>
            <p className="text-muted-foreground">
              Monitor durable UploadThing deletion intents. Provider keys and
              response bodies are never shown.
              {intents === null ? "" : ` (${intents.length} shown)`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              onValueChange={(value) => setFilter(value as StatusFilter)}
              value={filter}
            >
              <SelectTrigger
                aria-label="Filter cleanup status"
                className="w-[190px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={refresh} size="icon" variant="outline">
              <RefreshCw className="h-4 w-4" />
              <span className="sr-only">Refresh cleanup intents</span>
            </Button>
          </div>
        </div>

        {loadFailed ? (
          <div className="rounded-md border bg-card p-8 text-center">
            <p className="mb-4 text-sm text-muted-foreground">
              Cleanup intents could not be loaded. No legacy SQL fallback was
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
                  <TableHead>Status</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Last result</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {intents === null && (
                  <TableRow>
                    <TableCell className="h-24 text-center" colSpan={6}>
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                )}
                {intents?.length === 0 && (
                  <TableRow>
                    <TableCell className="h-24 text-center" colSpan={6}>
                      No cleanup intents match this filter.
                    </TableCell>
                  </TableRow>
                )}
                {intents?.map((intent) => (
                  <TableRow key={intent.id}>
                    <TableCell>{statusBadge(intent)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {resourceLabels[intent.resourceType]}
                        </span>
                        <span className="max-w-[260px] truncate font-mono text-xs text-muted-foreground">
                          {intent.resourceId}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>{intent.attemptCount}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {errorLabel(intent.lastErrorCode)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatInstantLocal(new Date(intent.updatedAt))}
                    </TableCell>
                    <TableCell className="text-right">
                      {(intent.status === "terminal" ||
                        intent.status === "succeeded") && (
                        <Button
                          aria-label={
                            intent.status === "succeeded"
                              ? "Reconcile cleanup again"
                              : "Retry cleanup"
                          }
                          disabled={pendingId !== null}
                          onClick={() => setRedriving(intent)}
                          size="sm"
                          variant="outline"
                        >
                          {pendingId === intent.id ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <RotateCcw className="mr-2 h-4 w-4" />
                          )}
                          {intent.status === "succeeded"
                            ? "Reconcile"
                            : "Retry"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {!isDone && intents !== null && (
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
