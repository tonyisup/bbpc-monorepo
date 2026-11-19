import { useConvex } from "convex/react";
import { formatDistanceToNowStrict } from "date-fns";
import {
  Archive,
  Bug,
  CheckCheck,
  Inbox,
  Lightbulb,
  Loader2,
  Mail,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  type ConvexAdminFeedback,
  type ConvexAdminFeedbackCounts,
  type ConvexFeedbackCategory,
  type ConvexFeedbackStatus,
  deleteConvexAdminFeedback,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_STATUSES,
  formatFeedbackCount,
  loadConvexAdminFeedback,
  loadConvexAdminFeedbackCounts,
  setConvexAdminFeedbackStatus,
} from "@/convex/feedback";
import { getConvexDomainErrorCode } from "@/convex/identity";
import { formatInstantLocal } from "@/lib/dates";
import { cn } from "@/lib/utils";

import { Button } from "../ui/button";
import { ConfirmModal } from "../ui/confirm-modal";

type CategoryFilter = ConvexFeedbackCategory | "all";

const CATEGORY_FILTERS: readonly CategoryFilter[] = [
  "all",
  "bug",
  "idea",
  "praise",
  "other",
];

const CATEGORY_STYLES: Record<
  ConvexFeedbackCategory,
  { icon: typeof Bug; chip: string }
> = {
  bug: {
    icon: Bug,
    chip: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300",
  },
  idea: {
    icon: Lightbulb,
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  praise: {
    icon: Sparkles,
    chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  other: {
    icon: MessageSquare,
    chip: "border-border bg-muted text-muted-foreground",
  },
};

const DETAIL_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

function mutationFailureMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "NOT_FOUND":
      return "That feedback no longer exists.";
    case "WRITE_DISABLED":
      return "Feedback changes are paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    default:
      return "The feedback change could not be completed.";
  }
}

function CategoryChip({
  category,
  className,
}: {
  category: ConvexFeedbackCategory;
  className?: string;
}) {
  const { icon: Icon, chip } = CATEGORY_STYLES[category];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        chip,
        className
      )}
    >
      <Icon aria-hidden="true" className="h-3 w-3" />
      {FEEDBACK_CATEGORY_LABELS[category]}
    </span>
  );
}

function submitterName(item: ConvexAdminFeedback): string {
  return item.submitter?.name ?? item.submitter?.email ?? "Deleted member";
}

function relativeTime(value: number): string {
  return formatDistanceToNowStrict(value, { addSuffix: true });
}

function FeedbackDetail({
  item,
  pending,
  onStatus,
  onDelete,
}: {
  item: ConvexAdminFeedback;
  pending: boolean;
  onStatus: (status: ConvexFeedbackStatus) => void;
  onDelete: () => void;
}) {
  const email = item.submitter?.email ?? null;
  return (
    <article
      aria-label="Selected feedback"
      className="flex h-full flex-col rounded-lg border bg-card shadow-sm"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b p-5">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <CategoryChip category={item.category} />
            <span className="text-xs text-muted-foreground">
              {formatInstantLocal(new Date(item.createdAt), DETAIL_TIME_FORMAT)}
            </span>
          </div>
          <p className="truncate text-sm font-semibold">
            {submitterName(item)}
          </p>
          {email !== null && (
            <a
              className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              href={`mailto:${email}?subject=${encodeURIComponent("Your BBPC feedback")}`}
            >
              <Mail aria-hidden="true" className="h-3 w-3" />
              {email}
            </a>
          )}
        </div>
        <Button
          aria-label="Delete feedback"
          disabled={pending}
          onClick={onDelete}
          size="icon"
          title="Delete"
          variant="ghost"
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </header>

      <div className="flex-1 space-y-4 p-5">
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {item.message}
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Sent from</dt>
          <dd className="min-w-0 truncate font-mono">
            {item.pagePath ?? "Unknown page"}
          </dd>
          <dt className="text-muted-foreground">Status</dt>
          <dd>{FEEDBACK_STATUS_LABELS[item.status]}</dd>
        </dl>
      </div>

      <footer className="flex flex-wrap justify-end gap-2 border-t bg-muted/30 p-4">
        {item.status !== "new" && (
          <Button
            disabled={pending}
            onClick={() => onStatus("new")}
            size="sm"
            variant="ghost"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Move to New
          </Button>
        )}
        {item.status !== "archived" && (
          <Button
            disabled={pending}
            onClick={() => onStatus("archived")}
            size="sm"
            variant="outline"
          >
            <Archive className="mr-2 h-4 w-4" />
            Archive
          </Button>
        )}
        {item.status === "new" && (
          <Button
            disabled={pending}
            onClick={() => onStatus("reviewed")}
            size="sm"
          >
            <CheckCheck className="mr-2 h-4 w-4" />
            Mark reviewed
          </Button>
        )}
      </footer>
    </article>
  );
}

export function ConvexFeedbackPage() {
  const convex = useConvex();
  const [status, setStatus] = useState<ConvexFeedbackStatus>("new");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [items, setItems] = useState<ConvexAdminFeedback[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [counts, setCounts] = useState<ConvexAdminFeedbackCounts | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] =
    useState<ConvexAdminFeedback | null>(null);

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    setLoading(true);
    void Promise.all([
      loadConvexAdminFeedback(convex, status),
      loadConvexAdminFeedbackCounts(convex),
    ])
      .then(([page, nextCounts]) => {
        if (!active) return;
        setItems(page.items);
        setHasMore(page.hasMore);
        setCounts(nextCounts);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLoadFailed(true);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [convex, status, revision]);

  const visible = useMemo(
    () =>
      (items ?? []).filter(
        (item) => category === "all" || item.category === category
      ),
    [items, category]
  );
  const selected =
    visible.find((item) => item.id === selectedId) ?? visible[0] ?? null;

  const refresh = () => setRevision((value) => value + 1);

  const changeTab = (next: ConvexFeedbackStatus) => {
    if (next === status) return;
    setItems(null);
    setSelectedId(null);
    setStatus(next);
  };

  // The item leaves this tab. If it was selected, select its neighbour to keep
  // triage moving; a selection made while the request ran stays put. The
  // reload then refills the page from older feedback and supersedes any load
  // that started before the change.
  const removeFromList = (id: string) => {
    const index = visible.findIndex((item) => item.id === id);
    const neighbour = visible[index + 1] ?? visible[index - 1] ?? null;
    setSelectedId((current) =>
      current === null || current === id ? neighbour?.id ?? null : current
    );
    setItems((current) => current?.filter((item) => item.id !== id) ?? null);
    refresh();
  };

  const moveTo = (item: ConvexAdminFeedback, next: ConvexFeedbackStatus) => {
    setPending(true);
    void setConvexAdminFeedbackStatus(convex, item.id, next)
      .then(() => {
        toast.success(`Moved to ${FEEDBACK_STATUS_LABELS[next]}.`);
        removeFromList(item.id);
      })
      .catch((error: unknown) => toast.error(mutationFailureMessage(error)))
      .finally(() => setPending(false));
  };

  const remove = (item: ConvexAdminFeedback) => {
    setPending(true);
    void deleteConvexAdminFeedback(convex, item.id)
      .then(() => {
        toast.success("Feedback deleted.");
        removeFromList(item.id);
      })
      .catch((error: unknown) => toast.error(mutationFailureMessage(error)))
      .finally(() => setPending(false));
  };

  return (
    <>
      <Head>
        <title>Feedback - BBPC Admin</title>
      </Head>
      <ConfirmModal
        confirmText="Delete"
        description="Delete this feedback permanently? Archive it instead to keep a record."
        isOpen={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete !== null) remove(confirmDelete);
        }}
        title="Delete feedback"
      />

      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Feedback</h2>
            <p className="text-muted-foreground">
              Bugs, ideas and kind words sent from the listener site.
            </p>
          </div>
          <Button onClick={refresh} variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            aria-label="Feedback status"
            className="inline-flex rounded-lg border bg-muted/40 p-1"
            role="tablist"
          >
            {FEEDBACK_STATUSES.map((value) => (
              <button
                aria-selected={status === value}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  status === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
                key={value}
                onClick={() => changeTab(value)}
                role="tab"
                type="button"
              >
                {FEEDBACK_STATUS_LABELS[value]}
                {counts !== null && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[11px] tabular-nums",
                      value === "new" && counts.new > 0
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {formatFeedbackCount(counts[value], counts.cap)}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div
            aria-label="Filter by category"
            className="flex flex-wrap gap-1.5"
            role="group"
          >
            {CATEGORY_FILTERS.map((value) => (
              <button
                aria-pressed={category === value}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  category === value
                    ? "border-foreground bg-foreground text-background"
                    : "text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                )}
                key={value}
                onClick={() => {
                  setCategory(value);
                  setSelectedId(null);
                }}
                type="button"
              >
                {value === "all" ? "All" : FEEDBACK_CATEGORY_LABELS[value]}
              </button>
            ))}
          </div>
        </div>

        {loadFailed ? (
          <div className="rounded-md border bg-card p-8 text-center">
            <p className="mb-4 text-sm text-muted-foreground">
              Feedback could not be loaded. Try again.
            </p>
            <Button onClick={refresh} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          </div>
        ) : items === null || (visible.length === 0 && hasMore && loading) ? (
          <div className="rounded-md border bg-card p-16 text-center">
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-muted-foreground" />
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed bg-card p-12 text-center">
            <Inbox aria-hidden="true" className="h-8 w-8 text-muted-foreground" />
            <p className="font-semibold">
              {status === "new" && category === "all"
                ? "You're all caught up."
                : "Nothing here."}
            </p>
            <p className="text-sm text-muted-foreground">
              {status === "new" && category === "all"
                ? "New feedback from listeners shows up here."
                : `No ${category === "all" ? "" : `${FEEDBACK_CATEGORY_LABELS[category].toLowerCase()} `}feedback ${hasMore ? "in the newest 100 here" : `is ${FEEDBACK_STATUS_LABELS[status].toLowerCase()}`}.`}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="flex flex-col gap-2">
              <ul
                aria-label="Feedback list"
                className="divide-y overflow-hidden rounded-lg border bg-card shadow-sm"
              >
                {visible.map((item) => {
                  const isSelected = selected?.id === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        aria-current={isSelected ? "true" : undefined}
                        className={cn(
                          "flex w-full flex-col gap-1.5 border-l-2 px-4 py-3 text-left transition-colors",
                          isSelected
                            ? "border-l-primary bg-muted/60"
                            : "border-l-transparent hover:bg-muted/30"
                        )}
                        onClick={() => setSelectedId(item.id)}
                        type="button"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold">
                            {submitterName(item)}
                          </span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {relativeTime(item.createdAt)}
                          </span>
                        </span>
                        <span className="line-clamp-2 text-sm text-muted-foreground">
                          {item.message}
                        </span>
                        <span className="flex items-center gap-2">
                          <CategoryChip category={item.category} />
                          {item.pagePath !== null && (
                            <span className="truncate font-mono text-[11px] text-muted-foreground">
                              {item.pagePath}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {hasMore && (
                <p className="text-center text-xs text-muted-foreground">
                  Showing the newest 100.
                </p>
              )}
            </div>
            {selected !== null && (
              <div className="lg:sticky lg:top-4 lg:self-start">
                <FeedbackDetail
                  item={selected}
                  onDelete={() => setConfirmDelete(selected)}
                  onStatus={(next) => moveTo(selected, next)}
                  pending={pending}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
