import Link from "next/link";
import type { ReactNode } from "react";

import type { QuotabungaRound } from "@/types/quotabunga";

import { QuotabungaRoundRow } from "./QuotabungaRoundRow";

const rowsClass = "divide-y divide-white/[0.12]";
const footClass =
  "flex min-h-14 items-center justify-center px-4 text-sm font-semibold text-white underline underline-offset-4 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500";

function Rows({ rounds }: { rounds: QuotabungaRound[] }) {
  return (
    // Tailwind's reset removes list markers, which makes Safari drop the list
    // role unless it is stated.
    <ul role="list" className={rowsClass}>
      {rounds.map((round) => (
        <li key={round.episode.id}>
          <QuotabungaRoundRow round={round} />
        </li>
      ))}
    </ul>
  );
}

/**
 * A season's rounds, newest first. Rounds past `initialCount` either wait
 * behind a disclosure or, given `moreHref`, behind a link to the full season.
 */
export function QuotabungaLedger({
  rounds,
  initialCount,
  moreHref,
  empty,
}: {
  rounds: QuotabungaRound[];
  initialCount: number;
  moreHref?: string;
  empty: ReactNode;
}) {
  if (rounds.length === 0) {
    return <>{empty}</>;
  }
  const shown = rounds.slice(0, initialCount);
  const rest = rounds.slice(initialCount);
  return (
    <>
      <Rows rounds={shown} />
      {rest.length > 0 &&
        (moreHref === undefined ? (
          <details className="group border-t border-white/[0.12]">
            <summary
              className={`${footClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
            >
              <span className="group-open:hidden">
                Show {rest.length} earlier{" "}
                {rest.length === 1 ? "round" : "rounds"}
              </span>
              <span className="hidden group-open:inline">
                Hide earlier rounds
              </span>
            </summary>
            <div className="border-t border-white/[0.12]">
              <Rows rounds={rest} />
            </div>
          </details>
        ) : (
          <Link
            href={moreHref}
            className={`${footClass} border-t border-white/[0.12]`}
          >
            See the full season
          </Link>
        ))}
    </>
  );
}
