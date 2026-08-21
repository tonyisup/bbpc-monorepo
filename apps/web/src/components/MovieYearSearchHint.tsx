import type {
  MovieYearHint,
  MovieYearHintAction,
} from "@bbpc/movie-search-hints";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function MovieYearSearchHint({
  className,
  hint,
  query,
  onAction,
}: {
  className?: string;
  hint: MovieYearHint;
  query: string;
  onAction: (action: MovieYearHintAction) => void;
}) {
  if (hint.kind === "hidden") {
    return <div className={cn("min-h-[3.25rem]", className)} aria-hidden />;
  }

  const isImmediate = hint.kind.startsWith("immediate");
  const copy =
    hint.kind === "immediate-rewrite"
      ? "Search by release year instead."
      : hint.kind === "immediate-add"
        ? `No available movie results for “${query}.” Try adding the release year.`
        : "Looking for a specific release?";
  const action =
    hint.kind === "immediate-rewrite"
      ? ({ kind: "rewrite", year: hint.year } as const)
      : ({ kind: "append" } as const);
  const actionable =
    hint.kind === "immediate-rewrite" ? true : hint.actionable;
  const actionLabel =
    hint.kind === "immediate-rewrite"
      ? `Use ${String(hint.year)} as release year`
      : "Add y:year";

  return (
    <div
      className={cn(
        "flex min-h-[3.25rem] flex-col items-start gap-1 text-sm text-zinc-400 sm:flex-row sm:items-center sm:gap-2",
        className,
      )}
      role={isImmediate ? "status" : undefined}
      data-movie-year-hint={hint.kind}
    >
      <span>{copy}</span>
      {actionable ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto shrink-0 p-0 text-amber-200"
          onClick={() => onAction(action)}
          aria-label={actionLabel}
        >
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
