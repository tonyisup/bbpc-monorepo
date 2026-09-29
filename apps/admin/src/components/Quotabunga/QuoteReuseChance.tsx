import { useConvex } from "convex/react";
import { History, Loader2 } from "lucide-react";
import Link from "next/link";
import { createContext, useContext, useEffect, useState } from "react";

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

type SettledReuseState = Exclude<ReuseState, { status: "loading" | "failed" }>;

/**
 * Finished checks, by submission and text, that a screen can share among its
 * cards. The recording panel remounts an entry's card at every cut round and
 * matchup, and the check is a full-text search, so it provides these to run
 * each entry's check once while it's on screen. Elsewhere every card checks
 * for itself. A failed check isn't kept, so the next card tries again.
 */
export type QuoteReuseCheckCache = Map<string, SettledReuseState>;
export const createQuoteReuseChecks = (): QuoteReuseCheckCache => new Map();
export const QuoteReuseChecks = createContext<QuoteReuseCheckCache | null>(
  null
);
const reuseCheckKey = (submissionId: string, quoteText: string) =>
  `${submissionId}\n${quoteText}`;

/** Link to a submission's reuse breakdown, labeled with its estimated reuse chance. */
export function QuoteReuseChance({
  submissionId,
  quoteText,
  blind = false,
}: {
  submissionId: string;
  quoteText: string;
  /** Open the breakdown without the listener's name, for blind judging. */
  blind?: boolean;
}) {
  const client = useConvex();
  const settledChecks = useContext(QuoteReuseChecks);
  const key = reuseCheckKey(submissionId, quoteText);
  const [state, setState] = useState<ReuseState>(
    () => settledChecks?.get(key) ?? { status: "loading" }
  );

  // quoteText is part of the key so an edited entry is scored again.
  useEffect(() => {
    const settled = settledChecks?.get(key);
    if (settled !== undefined) {
      setState(settled);
      return undefined;
    }
    let cancelled = false;
    setState({ status: "loading" });
    loadConvexAdminQuoteReuseReport(client, submissionId)
      .then((report) => {
        const result: SettledReuseState =
          report === null
            ? { status: "missing" }
            : { status: "ready", likelihood: report.likelihood };
        settledChecks?.set(key, result);
        if (!cancelled) setState(result);
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
  }, [client, key, settledChecks, submissionId]);

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
      href={getAdminQuoteReusePath(submissionId, { blind })}
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
