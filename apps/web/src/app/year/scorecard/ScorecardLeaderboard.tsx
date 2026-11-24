"use client";

import { GripVertical, Pencil } from "lucide-react";
import { Reorder, useDragControls } from "motion/react";
import { useEffect, useMemo, useState } from "react";

import type { ConvexScorecardEntry } from "@/convex/scorecard";
import {
  SCORECARD_CRITERIA,
  SCORECARD_TOP_COUNT,
  type ScorecardCriterion,
} from "@/lib/scorecard";

import { MoviePosterLink } from "./MoviePosterLink";

type Entry = ConvexScorecardEntry;

/** Consecutive ranked entries that share a score become one tie group. */
function groupRanked(ranked: Entry[]): Entry[][] {
  const groups: Entry[][] = [];
  for (const entry of ranked) {
    const last = groups.at(-1);
    if (last && entry.tied && last[0]?.average === entry.average) {
      last.push(entry);
    } else {
      groups.push([entry]);
    }
  }
  return groups;
}

export function ScorecardLeaderboard({
  entries,
  unscoredYearCount,
  busy,
  onEdit,
  onCommit,
  onOrderTie,
}: {
  entries: Entry[];
  unscoredYearCount: number;
  busy: boolean;
  onEdit: (movieId: string) => void;
  onCommit: (
    movieId: string,
    criterion: ScorecardCriterion,
    value: number
  ) => void;
  onOrderTie: (movieIds: string[]) => void;
}) {
  const [showIncomplete, setShowIncomplete] = useState(false);
  const ranked = useMemo(
    () =>
      entries
        .filter((entry) => entry.position !== null)
        .sort((left, right) => (left.position ?? 0) - (right.position ?? 0)),
    [entries]
  );
  const incomplete = entries.filter(
    (entry) => entry.position === null && !entry.unseen
  );
  const groups = groupRanked(ranked);

  return (
    <section aria-label="Leaderboard" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted-foreground">
          {ranked.length} ranked · {incomplete.length + unscoredYearCount} still
          to score
        </p>
        <label className="inline-flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={showIncomplete}
            onChange={(event) => setShowIncomplete(event.target.checked)}
          />
          Show incomplete
        </label>
      </div>

      {ranked.length === 0 ? (
        <p className="rounded border border-dashed border-zinc-700 p-4 text-sm text-muted-foreground">
          Score all 9 criteria for a movie to put it on the leaderboard.
        </p>
      ) : (
        <>
          <div
            aria-hidden
            className="hidden items-center gap-2 border border-transparent px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground md:flex"
          >
            <span className="w-6" />
            <span className="w-7" />
            <span className="flex-1" />
            <span className="flex gap-1">
              {SCORECARD_CRITERIA.map((criterion) => (
                <span
                  key={criterion.key}
                  title={criterion.label}
                  className="w-10 truncate text-center"
                >
                  {criterion.label.slice(0, 4)}
                </span>
              ))}
            </span>
            <span className="w-12 text-right">Score</span>
          </div>
          <ol className="space-y-1">
            {groups.map((group) => {
              const first = group[0];
              if (!first) return null;
              const crossesLine =
                (first.position ?? 0) <= SCORECARD_TOP_COUNT &&
                (first.position ?? 0) + group.length - 1 > SCORECARD_TOP_COUNT;
              const afterLine =
                (first.position ?? 0) === SCORECARD_TOP_COUNT + 1;
              return (
                <li key={group.map((entry) => entry.id).join(":")}>
                  {afterLine && <TopLine />}
                  {group.length > 1 ? (
                    <TieGroup
                      group={group}
                      busy={busy}
                      crossesLine={crossesLine}
                      onEdit={onEdit}
                      onCommit={onCommit}
                      onOrderTie={onOrderTie}
                    />
                  ) : (
                    <LeaderboardRow
                      entry={first}
                      busy={busy}
                      onEdit={onEdit}
                      onCommit={onCommit}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}

      {showIncomplete && incomplete.length > 0 && (
        <div className="space-y-1 pt-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Incomplete
          </p>
          {incomplete.map((entry) => (
            <LeaderboardRow
              key={entry.id}
              entry={entry}
              busy={busy}
              onEdit={onEdit}
              onCommit={onCommit}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TopLine() {
  return (
    <div className="my-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-amber-400">
      <span className="h-px flex-1 bg-amber-400/60" />
      Top {SCORECARD_TOP_COUNT}
      <span className="h-px flex-1 bg-amber-400/60" />
    </div>
  );
}

function TieGroup({
  group,
  busy,
  crossesLine,
  onEdit,
  onCommit,
  onOrderTie,
}: {
  group: Entry[];
  busy: boolean;
  crossesLine: boolean;
  onEdit: (movieId: string) => void;
  onCommit: (
    movieId: string,
    criterion: ScorecardCriterion,
    value: number
  ) => void;
  onOrderTie: (movieIds: string[]) => void;
}) {
  const [order, setOrder] = useState(group.map((entry) => entry.movie.id));
  const key = group.map((entry) => entry.movie.id).join(":");
  useEffect(() => {
    setOrder(key.split(":"));
  }, [key]);
  const byMovie = new Map(group.map((entry) => [entry.movie.id, entry]));

  return (
    <div className="rounded border border-amber-400/30 p-1">
      <p className="px-1 pb-1 text-[11px] text-amber-300">
        Tied at {group[0]?.average?.toFixed(2)}. Drag to order
        {crossesLine ? " — this tie crosses the top 10 line" : ""}.
      </p>
      <Reorder.Group
        axis="y"
        values={order}
        onReorder={setOrder}
        className="space-y-1"
      >
        {order.map((movieId, index) => {
          const entry = byMovie.get(movieId);
          if (!entry) return null;
          const position = (group[0]?.position ?? 0) + index;
          return (
            <TieItem
              key={movieId}
              movieId={movieId}
              disabled={busy}
              onDragEnd={() => {
                if (order.join(":") !== key) onOrderTie(order);
              }}
            >
              <LeaderboardRow
                entry={{ ...entry, position }}
                busy={busy}
                onEdit={onEdit}
                onCommit={onCommit}
              />
              {crossesLine &&
                position === SCORECARD_TOP_COUNT &&
                index < order.length - 1 && <TopLine />}
            </TieItem>
          );
        })}
      </Reorder.Group>
    </div>
  );
}

function TieItem({
  movieId,
  disabled,
  onDragEnd,
  children,
}: {
  movieId: string;
  disabled: boolean;
  onDragEnd: () => void;
  children: React.ReactNode;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={movieId}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDragEnd}
      className="flex flex-wrap items-center gap-x-1"
    >
      <button
        type="button"
        aria-label="Drag to reorder this tie"
        disabled={disabled}
        className="flex-shrink-0 cursor-grab touch-none p-1 text-zinc-500 active:cursor-grabbing disabled:opacity-50"
        onPointerDown={(event) => controls.start(event)}
      >
        <GripVertical className="h-5 w-5" />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </Reorder.Item>
  );
}

function LeaderboardRow({
  entry,
  busy,
  onEdit,
  onCommit,
}: {
  entry: Entry;
  busy: boolean;
  onEdit: (movieId: string) => void;
  onCommit: (
    movieId: string,
    criterion: ScorecardCriterion,
    value: number
  ) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/60 p-2">
      <span className="w-6 flex-shrink-0 text-center text-sm font-bold tabular-nums">
        {entry.position ?? "–"}
      </span>
      <MoviePosterLink movie={entry.movie} width={28} height={42} />
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => onEdit(entry.movie.id)}
      >
        <span className="block truncate text-sm font-semibold">
          {entry.movie.title}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {entry.movie.year}
          {entry.tied && (
            <span className="rounded bg-amber-400/15 px-1 text-[10px] font-bold uppercase text-amber-300">
              Tied
            </span>
          )}
          <Pencil className="h-3 w-3 md:hidden" aria-hidden />
        </span>
      </button>
      <div className="hidden gap-1 md:flex">
        {SCORECARD_CRITERIA.map((criterion) => {
          const value = entry.scores[criterion.key];
          return (
            <select
              key={criterion.key}
              aria-label={`${criterion.label} for ${entry.movie.title}`}
              title={criterion.label}
              disabled={busy}
              value={value ?? ""}
              onChange={(event) =>
                onCommit(
                  entry.movie.id,
                  criterion.key,
                  Number(event.target.value)
                )
              }
              className="h-8 w-10 rounded border border-zinc-700 bg-zinc-950 text-center text-xs tabular-nums"
            >
              {value === undefined && <option value="">–</option>}
              {Array.from({ length: 10 }, (_, index) => index + 1).map(
                (option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                )
              )}
            </select>
          );
        })}
      </div>
      <span className="w-12 flex-shrink-0 text-right text-sm font-black tabular-nums">
        {entry.average === null ? "–" : entry.average.toFixed(2)}
      </span>
    </div>
  );
}
