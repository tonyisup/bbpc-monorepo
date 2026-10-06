"use client";

import Link from "next/link";

import {
  listenerName,
  listenerRanks,
  quoted,
} from "@/lib/quotabungaArchive";
import { getEpisodePath } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type {
  QuotabungaEntry,
  QuotabungaListener,
  QuotabungaRound,
} from "@/types/quotabunga";

import { useClipPlayback } from "./ClipPlayback";
import { EntryByline, PlaceBadge } from "./QuotabungaParts";
import { ClipButton, ClipPlayer } from "./QuoteClip";

const TOP_LISTENERS = 3;
// A winning quote longer than this reads as a paragraph, not a headline.
const LONG_QUOTE_LENGTH = 90;

interface RankedListener {
  listener: QuotabungaListener;
  rank: number;
}

function ListenerRows({ listeners }: { listeners: RankedListener[] }) {
  return (
    <>
      {listeners.map(({ listener, rank }) => (
        <li
          key={listener.user.id}
          className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-baseline gap-2.5 border-t border-white/[0.12] py-2.5 first:border-t-0"
        >
          <span className="text-[13px] tabular-nums text-zinc-400">
            {rank}
          </span>
          <span className="truncate font-bold text-white">
            {listenerName(listener.user.name)}
          </span>
          <span className="text-[13px] tabular-nums text-zinc-400">
            <b className="text-white">{listener.wins}</b>{" "}
            {listener.wins === 1 ? "win" : "wins"} · {listener.points} pts
          </span>
        </li>
      ))}
    </>
  );
}

/**
 * The newest winning quote beside the listeners with the most wins. Only
 * listeners who have won make the short list; everyone else who entered is
 * one tap away.
 */
export function QuotabungaChampionBand({
  round,
  entry,
  listeners,
  scope,
}: {
  round: QuotabungaRound;
  entry: QuotabungaEntry;
  listeners: QuotabungaListener[];
  scope: string;
}) {
  const playback = useClipPlayback();
  const clipKey = `band:${entry.id}`;
  const playing = playback.playingKey === clipKey;
  const { episode } = round;
  const episodeLabel = `Ep. ${episode.number}, ${episode.title}`;
  const ranks = listenerRanks(listeners);
  const ranked = listeners.map((listener, index) => ({
    listener,
    rank: ranks[index] ?? index + 1,
  }));
  // Listeners arrive sorted by wins, so the winners are a prefix.
  const top = ranked
    .slice(0, TOP_LISTENERS)
    .filter(({ listener }) => listener.wins > 0);
  const rest = ranked.slice(top.length);
  const isLong = entry.quoteText.length > LONG_QUOTE_LENGTH;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section
        aria-labelledby="latest-winner-heading"
        className="bbpc-panel p-5 sm:px-7 sm:py-6"
      >
        <h2 id="latest-winner-heading" className="bbpc-kicker">
          Latest winner ·{" "}
          {episode.slug === null ? (
            episodeLabel
          ) : (
            <Link
              href={getEpisodePath(episode.slug)}
              className="rounded underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              {episodeLabel}
            </Link>
          )}
        </h2>
        <p
          className={cn(
            "mt-2.5 break-words font-extrabold tracking-tight text-white",
            isLong
              ? "max-w-[44ch] text-xl leading-snug sm:text-2xl"
              : "max-w-[20ch] text-[26px] leading-[1.15] sm:text-[34px]"
          )}
        >
          {quoted(entry.quoteText)}
        </p>
        <EntryByline entry={entry} className="mt-2.5 text-[15px]" />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {entry.clipUrl !== null && (
            <ClipButton
              entry={entry}
              playing={playing}
              onToggle={() => playback.toggle(clipKey)}
            />
          )}
          {entry.placement !== null && (
            <PlaceBadge placement={entry.placement} />
          )}
        </div>
        {playing && (
          <ClipPlayer entry={entry} onStop={playback.stop} className="mt-4" />
        )}
      </section>

      <section
        aria-labelledby="most-wins-heading"
        className="bbpc-panel p-5"
      >
        <h2 id="most-wins-heading" className="bbpc-label">
          Most wins · {scope}
        </h2>
        <ol className="mt-2">
          <ListenerRows listeners={top} />
        </ol>
        {rest.length > 0 && (
          <details className="group border-t border-white/[0.12]">
            <summary className="flex min-h-11 cursor-pointer list-none items-center rounded text-[13px] font-semibold text-white underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">
                All {listeners.length} listeners
              </span>
              <span className="hidden group-open:inline">
                Show top {TOP_LISTENERS} only
              </span>
            </summary>
            <ol>
              <ListenerRows listeners={rest} />
            </ol>
          </details>
        )}
      </section>
    </div>
  );
}
