"use client";

import { ChevronDownIcon } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatPlainDate } from "@/lib/dates";
import { entryCountLabel, leadEntry, quoted } from "@/lib/quotabungaArchive";
import { getEpisodePath, SUBMIT_QUOTE_PATH } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { QuotabungaEntry, QuotabungaRound } from "@/types/quotabunga";

import { useClipPlayback } from "./ClipPlayback";
import { EntryByline, PlaceBadge } from "./QuotabungaParts";
import { ClipButton, ClipPlayer } from "./QuoteClip";

// The four columns need a wide screen; below that the quote would be left
// with a sliver beside the episode and the controls.
const rowGridClass =
  "grid grid-cols-1 gap-x-5 gap-y-1.5 px-4 py-3.5 lg:grid-cols-[3rem_12.5rem_minmax(0,1fr)_auto] lg:items-center lg:px-5 lg:py-4";

/** The key a round row plays an entry's clip under. */
function clipKey(entry: QuotabungaEntry): string {
  return `round:${entry.id}`;
}

function EpisodeCells({
  round,
  status,
}: {
  round: QuotabungaRound;
  status: string;
}) {
  const { episode } = round;
  return (
    <>
      <p className="font-mono text-[13px] text-zinc-400">
        <span className="sr-only">Episode </span>
        {episode.number}
      </p>
      <div className="flex flex-wrap items-baseline gap-x-2 lg:block">
        <p className="font-bold text-white">
          {episode.slug === null ? (
            episode.title
          ) : (
            <Link
              href={getEpisodePath(episode.slug)}
              className="rounded underline decoration-white/30 underline-offset-4 hover:decoration-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              {episode.title}
            </Link>
          )}
        </p>
        <p className="text-[13px] text-zinc-400">{status}</p>
      </div>
    </>
  );
}

function HiddenRound({ round }: { round: QuotabungaRound }) {
  const isOpen = round.state === "open";
  return (
    <div
      className={cn(
        rowGridClass,
        isOpen && "bg-[color:var(--bbpc-accent-soft)]"
      )}
    >
      <EpisodeCells
        round={round}
        status={isOpen ? "Round open" : "Round locked"}
      />
      <p className="text-[15px] text-zinc-200">
        {isOpen
          ? `${
              round.entryCount === 0
                ? "No entries yet."
                : `${entryCountLabel(round.entryCount)} so far.`
            } Quotes stay hidden until the episode is out.`
          : "The winner shows up here once the episode is out."}
      </p>
      {isOpen ? (
        <Button asChild className="h-11 justify-self-start px-4 font-bold">
          <Link href={SUBMIT_QUOTE_PATH}>Submit your quote</Link>
        </Button>
      ) : (
        <p className="text-[13px] tabular-nums text-zinc-400">
          {entryCountLabel(round.entryCount)}
        </p>
      )}
    </div>
  );
}

function EntryRow({
  entry,
  tag,
  playback,
}: {
  entry: QuotabungaEntry;
  tag: "place" | "bracket" | "none";
  playback: ReturnType<typeof useClipPlayback>;
}) {
  const playing = playback.playingKey === clipKey(entry);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 border-t border-white/[0.12] py-3 first:border-t-0 md:grid-cols-[6rem_minmax(0,1fr)_auto]">
      <div
        className={cn(
          "col-span-full md:col-span-1",
          tag === "none" && "hidden md:block"
        )}
      >
        {tag === "place" && entry.placement !== null && (
          <PlaceBadge placement={entry.placement} />
        )}
        {tag === "bracket" && (
          <span className="text-[13px] text-zinc-400">In the bracket</span>
        )}
      </div>
      <div className="min-w-0">
        <p className="break-words text-[15px] font-medium leading-snug text-white">
          {quoted(entry.quoteText)}
        </p>
        <EntryByline entry={entry} className="mt-0.5" />
      </div>
      <ClipButton
        entry={entry}
        playing={playing}
        onToggle={() => playback.toggle(clipKey(entry))}
      />
      {playing && (
        <ClipPlayer
          entry={entry}
          onStop={playback.stop}
          className="col-span-full"
        />
      )}
    </li>
  );
}

/**
 * One round of the ledger. A revealed round leads with its winner, when it
 * has one, and opens to the rest of its entries; an open or locked round
 * shows only its count.
 */
export function QuotabungaRoundRow({ round }: { round: QuotabungaRound }) {
  const [expanded, setExpanded] = useState(false);
  const playback = useClipPlayback();
  const entriesId = useId();
  if (round.state !== "revealed") {
    return <HiddenRound round={round} />;
  }
  // Null when the episode is out but the hosts never placed an entry.
  const lead = leadEntry(round);

  const others = round.entries.filter((entry) => entry.id !== lead?.id);
  const leadPlaying = lead !== null && playback.playingKey === clipKey(lead);
  const toggleExpanded = () => {
    // Collapsing takes the other entries' players away with it.
    if (
      expanded &&
      others.some((entry) => playback.playingKey === clipKey(entry))
    ) {
      playback.stop();
    }
    setExpanded(!expanded);
  };
  // Only a full bracket leaves entries that played without placing.
  const hadBracket =
    round.entries.filter((entry) => entry.inBracket).length >= 4;
  const played = others.filter(
    (entry) => entry.placement !== null || entry.inBracket
  );
  const alsoSubmitted = others.filter(
    (entry) => entry.placement === null && !entry.inBracket
  );

  return (
    <div
      className={cn(expanded && "bg-[color:var(--bbpc-surface-raised)]")}
    >
      <div className={rowGridClass}>
        <EpisodeCells
          round={round}
          status={formatPlainDate(round.episode.date, undefined, "en-US")}
        />
        {lead === null ? (
          <p className="text-[15px] text-zinc-200">
            No winner was recorded for this round.
          </p>
        ) : (
          <div className="min-w-0">
            <p className="break-words text-[17px] font-semibold leading-snug text-white">
              {quoted(lead.quoteText)}
            </p>
            <EntryByline entry={lead} className="mt-0.5" />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {lead !== null && lead.placement !== null && (
            <PlaceBadge placement={lead.placement} />
          )}
          {lead !== null && lead.clipUrl !== null && (
            <ClipButton
              entry={lead}
              playing={leadPlaying}
              onToggle={() => playback.toggle(clipKey(lead))}
            />
          )}
          {others.length === 0 ? (
            <span className="text-[13px] tabular-nums text-zinc-400">
              {entryCountLabel(round.entryCount)}
            </span>
          ) : (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={entriesId}
              onClick={toggleExpanded}
              className="-mx-2 inline-flex h-11 items-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold tabular-nums text-zinc-200 transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 lg:h-9"
            >
              {entryCountLabel(round.entryCount)}
              <span className="sr-only">
                {expanded ? ", hide " : ", show "}
                {lead === null ? "them" : "the others"}
              </span>
              <ChevronDownIcon
                aria-hidden="true"
                className={cn(
                  "size-4 text-zinc-400 transition-transform motion-reduce:transition-none",
                  expanded && "rotate-180"
                )}
              />
            </button>
          )}
        </div>
        {lead !== null && leadPlaying && (
          <ClipPlayer
            entry={lead}
            onStop={playback.stop}
            className="col-span-full lg:col-start-3"
          />
        )}
      </div>
      {expanded && (
        <div id={entriesId} className="px-4 pb-3 lg:pl-[5.5rem] lg:pr-5">
          {played.length > 0 && (
            <ul role="list" className="border-t border-white/[0.12]">
              {played.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  playback={playback}
                  tag={
                    entry.placement !== null
                      ? "place"
                      : hadBracket
                      ? "bracket"
                      : "none"
                  }
                />
              ))}
            </ul>
          )}
          {alsoSubmitted.length > 0 && (
            <>
              <h3 className="bbpc-label border-t border-white/[0.12] pb-1 pt-3.5">
                Also submitted
              </h3>
              <ul role="list">
                {alsoSubmitted.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    playback={playback}
                    tag="none"
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
