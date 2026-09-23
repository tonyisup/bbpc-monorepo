import { useConvex } from "convex/react";
import { History, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  formatQuoteReuseLikelihood,
  loadConvexAdminQuoteReuseReport,
  quoteReuseTone,
} from "../../convex/quotabunga";
import { getAdminQuoteReusePath } from "../../lib/routes";
import { cn } from "../../lib/utils";

type ReuseState =
  | { status: "loading" }
  | { status: "ready"; likelihood: number }
  | { status: "missing" }
  | { status: "failed" };

/** Link to a submission's reuse breakdown, labeled with its estimated reuse chance. */
export function QuoteReuseChance({
  submissionId,
  quoteText,
}: {
  submissionId: string;
  quoteText: string;
}) {
  const client = useConvex();
  const [state, setState] = useState<ReuseState>({ status: "loading" });

  // quoteText is a dependency so an edited entry is scored again.
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    loadConvexAdminQuoteReuseReport(client, submissionId)
      .then((report) => {
        if (!cancelled) {
          setState(
            report === null
              ? { status: "missing" }
              : { status: "ready", likelihood: report.likelihood }
          );
        }
      })
      .catch((error: unknown) => {
        // Includes a backend deployed before this query existed; keep it visible.
        console.error("Quote reuse check failed", error);
        if (!cancelled) {
          setState({ status: "failed" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, submissionId, quoteText]);

  const value =
    state.status === "ready"
      ? formatQuoteReuseLikelihood(state.likelihood)
      : state.status === "loading"
        ? "…"
        : "—";
  const label = state.status === "failed" ? "Reuse check failed" : "Reuse chance";

  return (
    <Link
      aria-label={`${label} ${value}. See where this quote may have been used before.`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        state.status === "ready"
          ? quoteReuseTone(state.likelihood)
          : state.status === "failed"
            ? "border-destructive/50 text-destructive"
            : "text-muted-foreground"
      )}
      href={getAdminQuoteReusePath(submissionId)}
    >
      {state.status === "loading" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <History className="h-3.5 w-3.5" />
      )}
      {label}
      <span className="text-sm font-black tabular-nums">{value}</span>
    </Link>
  );
}
