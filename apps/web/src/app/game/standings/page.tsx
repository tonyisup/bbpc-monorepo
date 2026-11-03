import type { Metadata } from "next";
import Link from "next/link";

import GamePerformanceTracking from "@/components/GamePerformanceTracking";
import { CurrentSeasonBadge } from "@/components/SeasonSummary";
import { SeasonTabs } from "@/components/SeasonTabs";
import { getPacificTodayPlainDate } from "@/lib/dates";
import { seasonDateRange } from "@/lib/quotabungaArchive";
import { ordinal } from "@/lib/seasonActivity";
import {
  isSeasonFinished,
  joinNames,
  pointsLabel,
  rankPlayers,
  type RankedPlayer,
  selectStandingsSeason,
} from "@/lib/seasonStandings";
import {
  getQuotabungaArchivePath,
  getStandingsArchivePath,
} from "@/lib/routes";
import { cn } from "@/lib/utils";
import {
  getConvexSeasonStandings,
  getConvexStandingsSeasons,
} from "@/server/convex/games";
import type { StandingsSeason } from "@/types/game";

export const metadata: Metadata = {
  title: "Season standings | BBPC",
  description:
    "Final WTFIR standings from every season, and how the points piled up.",
};

function EmptyPanel({ title, children }: { title: string; children: string }) {
  return (
    <div className="bbpc-panel px-6 py-10 text-center">
      <h2 className="text-lg font-bold text-white">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-[44ch] text-zinc-400">{children}</p>
    </div>
  );
}

/** Whoever finished first, or is first so far, in the shown season. */
function LeaderBand({
  season,
  leaders,
  finished,
}: {
  season: StandingsSeason;
  leaders: RankedPlayer[];
  finished: boolean;
}) {
  const tied = leaders.length > 1;
  const kicker = finished
    ? tied
      ? `${season.title} co-champions`
      : `${season.title} champion`
    : tied
    ? "Tied for the lead"
    : "Leading so far";
  const dates = seasonDateRange(season);
  return (
    <section
      aria-labelledby="season-leader-heading"
      className="bbpc-panel flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-5 py-6 lg:px-6"
    >
      <div>
        <p className="bbpc-kicker">{kicker}</p>
        <h2
          id="season-leader-heading"
          className="mt-1 break-words text-3xl font-black tracking-tight text-white sm:text-4xl"
        >
          {joinNames(leaders.map((leader) => leader.name))}
        </h2>
        {dates !== "" && (
          <p className="mt-1 flex items-center gap-2.5 text-[13px] text-zinc-400">
            {dates}
            {season.isCurrent && <CurrentSeasonBadge />}
          </p>
        )}
      </div>
      <p className="text-[22px] font-extrabold tabular-nums text-white">
        {pointsLabel(leaders[0]?.total ?? 0)}
      </p>
    </section>
  );
}

function StandingsTable({
  season,
  players,
  finished,
}: {
  season: StandingsSeason;
  players: RankedPlayer[];
  finished: boolean;
}) {
  return (
    <section className="bbpc-panel overflow-hidden">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">
          {season.title} {finished ? "final standings" : "standings so far"}
        </caption>
        <thead className="border-b border-white/[0.12] text-xs font-semibold text-zinc-400">
          <tr>
            <th scope="col" className="w-16 px-4 py-3 lg:px-5">
              Place
            </th>
            <th scope="col" className="px-4 py-3">
              Player
            </th>
            <th scope="col" className="px-4 py-3 text-right lg:px-5">
              Points
            </th>
          </tr>
        </thead>
        <tbody>
          {players.map((player) => (
            <tr
              key={player.id}
              className={cn(
                "border-b border-white/[0.06] last:border-b-0",
                player.rank === 1 && "bg-red-500/[0.06]"
              )}
            >
              <td className="px-4 py-3 tabular-nums text-zinc-400 lg:px-5">
                {ordinal(player.rank)}
              </td>
              <th
                scope="row"
                className={cn(
                  "break-words px-4 py-3 font-semibold text-zinc-100",
                  player.rank === 1 && "font-extrabold text-white"
                )}
              >
                {player.name}
              </th>
              <td className="px-4 py-3 text-right font-bold tabular-nums text-white lg:px-5">
                {player.total}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default async function StandingsArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string | string[] }>;
}) {
  const { season: requested } = await searchParams;
  const today = getPacificTodayPlainDate();
  const seasons = await getConvexStandingsSeasons(today);
  const season = selectStandingsSeason(
    seasons,
    typeof requested === "string" ? requested : undefined
  );
  // Only a season the backend listed is ever loaded.
  const standings =
    season === null ? null : await getConvexSeasonStandings(season.id, today);
  const players = standings === null ? [] : rankPlayers(standings.userSummary);
  const leaders = players.filter((player) => player.rank === 1);
  const finished = season !== null && isSeasonFinished(season, today);
  const episodes = standings?.recordedEpisodeCount ?? null;
  const stats: Array<[string, number]> = [["Players", players.length]];
  if (episodes !== null) {
    stats.push(["Episodes", episodes]);
  }

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
            / Standings
          </nav>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-white sm:text-5xl">
            Season standings
          </h1>
          <p className="mt-2 max-w-[56ch] text-base text-zinc-400">
            Who won each season of the{" "}
            <span title="Who The Fuck Is Reggie">WTFIR</span> game, and how the
            points piled up.{" "}
            <Link
              href={getQuotabungaArchivePath()}
              className="rounded font-semibold text-red-300 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              Quotabunga winners
            </Link>{" "}
            have their own page.
          </p>
        </div>
        {players.length > 0 && (
          <dl className="flex w-full justify-between gap-7 sm:w-auto sm:justify-start">
            {stats.map(([label, value]) => (
              <div key={label} className="sm:text-right">
                <dt className="text-xs font-semibold text-zinc-400">{label}</dt>
                <dd className="text-[22px] font-extrabold tabular-nums text-white">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </header>

      {season === null ? (
        <EmptyPanel title="No standings yet">
          Standings land here once a season has its first points.
        </EmptyPanel>
      ) : (
        <>
          <SeasonTabs
            tabs={seasons.map((listed) => ({
              key: listed.id,
              label: listed.title,
              isCurrent: listed.isCurrent,
              href: getStandingsArchivePath(listed.id),
            }))}
            selected={season.id}
          />
          {standings === null || players.length === 0 ? (
            <EmptyPanel title="No points yet">
              Standings land here once each episode is out.
            </EmptyPanel>
          ) : (
            <>
              <LeaderBand
                season={season}
                leaders={leaders}
                finished={finished}
              />
              <StandingsTable
                season={season}
                players={players}
                finished={finished}
              />
              <GamePerformanceTracking data={standings} showSummary={false} />
            </>
          )}
        </>
      )}
    </div>
  );
}
