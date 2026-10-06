import { ChevronDownIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { CurrentSeasonBadge } from "@/components/SeasonSummary";
import { getPacificTodayPlainDate } from "@/lib/dates";
import {
  ALL_SEASONS,
  archiveStats,
  latestWinner,
  listenerName,
  mergeListeners,
  seasonDateRange,
  selectSeasonView,
} from "@/lib/quotabungaArchive";
import { getQuotabungaArchivePath } from "@/lib/routes";
import { cn } from "@/lib/utils";
import {
  getQuotabungaSeason,
  getQuotabungaSeasons,
} from "@/server/convex/quotabunga";
import type {
  QuotabungaSeason,
  QuotabungaSeasonDetail,
} from "@/types/quotabunga";

import { ClipPlaybackProvider } from "./ClipPlayback";
import { QuotabungaChampionBand } from "./QuotabungaChampionBand";
import { QuotabungaLedger } from "./QuotabungaLedger";
import { SeasonTabLabel } from "./SeasonTabLabel";

export const metadata: Metadata = {
  title: "Quotabunga | BBPC",
  description:
    "Every quote listeners sent in to Quotabunga, and the ones the hosts crowned.",
};

const SEASON_ROUNDS_SHOWN = 8;
const ALL_SEASONS_ROUNDS_SHOWN = 3;

function SeasonTabs({
  seasons,
  selected,
}: {
  seasons: QuotabungaSeason[];
  selected: string;
}) {
  const tabs = [
    ...seasons.map((season) => ({
      key: season.id,
      label: season.title,
      isCurrent: season.isCurrent,
    })),
    { key: ALL_SEASONS, label: "All seasons", isCurrent: false },
  ];
  return (
    <nav aria-label="Seasons" className="max-w-full overflow-x-auto">
      <ul className="inline-flex gap-1 rounded-[10px] border border-white/[0.12] bg-[color:var(--bbpc-surface)] p-1">
        {tabs.map((tab) => (
          <li key={tab.key}>
            <Link
              href={getQuotabungaArchivePath(tab.key)}
              aria-current={tab.key === selected ? "page" : undefined}
              className={cn(
                "flex h-11 items-center whitespace-nowrap rounded-[7px] px-3.5 text-sm font-semibold text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 md:h-9",
                tab.key === selected &&
                  "bg-[color:var(--bbpc-surface-raised)] text-white shadow-[inset_0_0_0_1px_var(--bbpc-border)]"
              )}
            >
              <SeasonTabLabel>
                {tab.label}
                {tab.isCurrent && (
                  <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-red-300">
                    Current
                  </span>
                )}
              </SeasonTabLabel>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// A season with no rounds has no open round either (an open round always
// gets a row), so there is nothing to send the listener to from here.
function EmptySeason() {
  return (
    <div className="px-6 py-10 text-center">
      <h3 className="text-lg font-bold text-white">No finished rounds yet</h3>
      <p className="mx-auto mt-1.5 max-w-[44ch] text-zinc-400">
        Winners land here once each episode is out.
      </p>
    </div>
  );
}

function SeasonBlock({
  detail,
  defaultOpen,
}: {
  detail: QuotabungaSeasonDetail;
  defaultOpen: boolean;
}) {
  const { season } = detail;
  const stats = archiveStats([detail]);
  const leader = detail.listeners.find((listener) => listener.wins > 0);
  const dates = seasonDateRange(season);
  return (
    <details className="bbpc-panel group overflow-hidden" open={defaultOpen}>
      <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-1 px-4 py-4 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500 md:grid-cols-[minmax(0,1fr)_auto_auto] md:px-5 [&::-webkit-details-marker]:hidden">
        <div>
          <h2 className="flex items-center gap-2.5 text-xl font-extrabold text-white">
            {season.title}
            {season.isCurrent && <CurrentSeasonBadge />}
          </h2>
          {dates !== "" && (
            <p className="mt-0.5 text-[13px] text-zinc-400">{dates}</p>
          )}
        </div>
        <p className="col-start-1 text-[13px] text-zinc-400 md:col-start-2 md:text-right">
          <b className="font-semibold text-zinc-200">{stats.rounds}</b>{" "}
          {stats.rounds === 1 ? "round" : "rounds"} ·{" "}
          <b className="font-semibold text-zinc-200">{stats.quotes}</b>{" "}
          {stats.quotes === 1 ? "quote" : "quotes"}
          {leader !== undefined && (
            <>
              <br />
              Most wins:{" "}
              <b className="font-semibold text-zinc-200">
                {listenerName(leader.user.name)}, {leader.wins}
              </b>
            </>
          )}
        </p>
        <ChevronDownIcon
          aria-hidden="true"
          className="col-start-2 row-span-2 row-start-1 size-4 text-zinc-400 transition-transform group-open:rotate-180 motion-reduce:transition-none md:col-start-3 md:row-span-1"
        />
      </summary>
      <div className="border-t border-white/[0.12]">
        <QuotabungaLedger
          rounds={detail.rounds}
          initialCount={ALL_SEASONS_ROUNDS_SHOWN}
          moreHref={getQuotabungaArchivePath(season.id)}
          empty={<EmptySeason />}
        />
      </div>
    </details>
  );
}

export default async function QuotabungaArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string | string[] }>;
}) {
  const { season: requested } = await searchParams;
  const today = getPacificTodayPlainDate();
  const seasons = await getQuotabungaSeasons(today);
  const view = selectSeasonView(
    seasons,
    typeof requested === "string" ? requested : undefined
  );
  const shown =
    view.kind === "all" ? seasons : view.kind === "season" ? [view.season] : [];
  // Whole minutes, so repeat views of a season can share one cached query.
  const now = Math.floor(Date.now() / 60_000) * 60_000;
  const details = (
    await Promise.all(
      shown.map((season) => getQuotabungaSeason(season.id, today, now))
    )
  ).flatMap((detail) => (detail === null ? [] : [detail]));

  const stats = archiveStats(details);
  const winner = latestWinner(details);
  const listeners = mergeListeners(details);

  return (
    <div className="bbpc-page space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-5">
        <div>
          <nav aria-label="Breadcrumb" className="text-[13px] text-zinc-400">
            <Link
              href="/game"
              className="rounded underline underline-offset-4 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              Game
            </Link>{" "}
            / Quotabunga
          </nav>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-white sm:text-5xl">
            Quotabunga
          </h1>
          <p className="mt-2 max-w-[56ch] text-base text-zinc-400">
            Every quote listeners sent in, and the ones the hosts crowned.
          </p>
        </div>
        <dl className="flex w-full justify-between gap-7 sm:w-auto sm:justify-start">
          {(
            [
              ["Rounds", stats.rounds],
              ["Quotes", stats.quotes],
              ["Listeners", stats.listeners],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="sm:text-right">
              <dt className="text-xs font-semibold text-zinc-400">{label}</dt>
              <dd className="text-[22px] font-extrabold tabular-nums text-white">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </header>

      {view.kind === "none" ? (
        <div className="bbpc-panel px-6 py-10 text-center">
          <h2 className="text-lg font-bold text-white">
            No Quotabunga rounds yet
          </h2>
          <p className="mx-auto mt-1.5 max-w-[44ch] text-zinc-400">
            Winners land here once each episode is out.
          </p>
        </div>
      ) : (
        <ClipPlaybackProvider>
          <SeasonTabs
            seasons={seasons}
            selected={view.kind === "all" ? ALL_SEASONS : view.season.id}
          />

          {winner !== null && (
            <QuotabungaChampionBand
              key={winner.entry.id}
              round={winner.round}
              entry={winner.entry}
              listeners={listeners}
              scope={view.kind === "all" ? "All seasons" : view.season.title}
            />
          )}

          {view.kind === "all" ? (
            <div className="space-y-3">
              {details.map((detail, index) => (
                <SeasonBlock
                  key={detail.season.id}
                  detail={detail}
                  defaultOpen={index === 0}
                />
              ))}
            </div>
          ) : (
            details.map((detail) => (
              <section
                key={detail.season.id}
                aria-labelledby="season-rounds-heading"
                className="bbpc-panel overflow-hidden"
              >
                <h2 id="season-rounds-heading" className="sr-only">
                  {detail.season.title} rounds
                </h2>
                <QuotabungaLedger
                  rounds={detail.rounds}
                  initialCount={SEASON_ROUNDS_SHOWN}
                  empty={<EmptySeason />}
                />
              </section>
            ))
          )}
        </ClipPlaybackProvider>
      )}
    </div>
  );
}
