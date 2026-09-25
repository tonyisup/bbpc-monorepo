"use client";

import { useConvex } from "convex/react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MoviePoster } from "@/components/MoviePoster";
import { Button } from "@/components/ui/button";
import {
  type ConvexSeasonPoint,
  loadConvexSeasonPointsPage,
} from "@/convex/seasons";
import { formatInstantLocal } from "@/lib/dates";
import { getAssignmentPath, getEpisodePath } from "@/lib/routes";
import {
  ASSIGNMENT_TYPE_LABELS,
  type EpisodePointGroup,
  formatSignedPoints,
  groupSeasonPointsByEpisode,
  signedPointsClass,
} from "@/lib/seasonActivity";

interface HistoryState {
  points: ConvexSeasonPoint[];
  cursor: string | null;
  isDone: boolean;
}

const emptyHistory: HistoryState = {
  points: [],
  cursor: null,
  isDone: false,
};

export function SeasonPointsByEpisode({ seasonId }: { seasonId: string }) {
  const convex = useConvex();
  const [history, setHistory] = useState<HistoryState>(emptyHistory);
  const [isLoading, setIsLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const loadGenerationRef = useRef(0);

  const loadPage = useCallback(
    async (cursor: string | null, replace: boolean) => {
      const generation = loadGenerationRef.current + 1;
      loadGenerationRef.current = generation;
      setIsLoading(true);
      setFailed(false);
      try {
        const result = await loadConvexSeasonPointsPage(
          convex,
          seasonId,
          cursor
        );
        if (loadGenerationRef.current !== generation) {
          return;
        }
        if (!result.isDone && result.continueCursor === cursor) {
          throw new Error("Season point pagination did not advance.");
        }
        setHistory((current) => {
          const points = replace
            ? result.page
            : [
                ...current.points,
                ...result.page.filter(
                  (point) =>
                    !current.points.some(
                      (currentPoint) => currentPoint.id === point.id
                    )
                ),
              ];
          return {
            points,
            cursor: result.continueCursor,
            isDone: result.isDone,
          };
        });
      } catch {
        if (loadGenerationRef.current === generation) {
          setFailed(true);
        }
      } finally {
        if (loadGenerationRef.current === generation) {
          setIsLoading(false);
        }
      }
    },
    [convex, seasonId]
  );

  useEffect(() => {
    setHistory(emptyHistory);
    void loadPage(null, true);
  }, [loadPage]);

  const groups = useMemo(
    () => groupSeasonPointsByEpisode(history.points),
    [history.points]
  );
  // Pages are cut by time, not by episode, and late awards land days after
  // an episode's picks, so any group can still have older points to come.
  // Every subtotal stays marked until the last page lands.
  const partial = !history.isDone;

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <EpisodeGroup key={group.key} group={group} partial={partial} />
      ))}
      {partial && groups.length > 0 ? (
        <p className="text-xs text-zinc-500">
          Subtotals cover the points loaded so far.
        </p>
      ) : null}

      {!isLoading && history.points.length === 0 && !failed ? (
        <p className="text-sm text-zinc-400">No points this season yet.</p>
      ) : null}

      {failed ? (
        <div className="space-y-3" role="alert">
          <p className="text-sm text-red-300">
            Your season points could not be loaded.
          </p>
          <Button
            variant="outline"
            onClick={() =>
              void loadPage(history.cursor, history.points.length === 0)
            }
          >
            Try again
          </Button>
        </div>
      ) : null}

      {isLoading ? (
        <div
          className="h-24 w-full animate-pulse rounded-xl bg-white/[0.04]"
          aria-label="Loading season points"
        />
      ) : null}

      {!isLoading && !failed && !history.isDone && history.points.length > 0 ? (
        <Button
          variant="outline"
          onClick={() => void loadPage(history.cursor, false)}
        >
          Show older points
        </Button>
      ) : null}
    </div>
  );
}

function EpisodeHeading({
  episode,
  id,
}: {
  episode: EpisodePointGroup["episode"];
  id: string;
}) {
  if (episode === null) {
    return (
      <h3 id={id} className="text-lg font-bold text-white">
        Season adjustments
        <span className="font-medium text-zinc-400">
          {" "}
          · not tied to an episode
        </span>
      </h3>
    );
  }
  const label = `Episode ${episode.number}`;
  const title =
    episode.title.trim() === label ? null : (
      <span className="font-medium text-zinc-400"> · {episode.title}</span>
    );
  if (episode.slug === null) {
    return (
      <h3 id={id} className="text-lg font-bold text-white">
        {label}
        {title}
      </h3>
    );
  }
  return (
    <h3 id={id} className="text-lg font-bold text-white">
      <Link
        href={getEpisodePath(episode.slug)}
        className="inline-flex items-center gap-2 transition-colors hover:text-red-300"
      >
        <span>
          {label}
          {title}
        </span>
        <ArrowRight className="h-4 w-4 text-zinc-400" aria-hidden="true" />
      </Link>
    </h3>
  );
}

function AssignmentHeading({
  assignment,
}: {
  assignment: NonNullable<ConvexSeasonPoint["assignment"]>;
}) {
  const movie = `${assignment.movie.title} (${assignment.movie.year})`;
  return (
    <div className="flex items-center gap-3">
      <MoviePoster poster={assignment.movie.poster} />
      <h4 className="text-sm font-semibold text-indigo-300">
        {assignment.slug === null ? (
          movie
        ) : (
          <Link
            href={getAssignmentPath(assignment.slug)}
            className="transition-colors hover:text-indigo-200"
          >
            {movie}
          </Link>
        )}
        <span className="block font-medium text-zinc-500">
          {ASSIGNMENT_TYPE_LABELS[assignment.type]}
        </span>
      </h4>
    </div>
  );
}

function PointRow({ point }: { point: ConvexSeasonPoint }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.04] px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-white">
          {point.reason ?? point.gamePointType?.title ?? "Point adjustment"}
        </p>
        {point.gamePointType?.description ? (
          <p className="mt-1 text-sm text-zinc-400">
            {point.gamePointType.description}
          </p>
        ) : null}
        <p className="mt-1.5 font-mono text-xs text-zinc-500">
          {formatInstantLocal(new Date(point.earnedAt), { dateStyle: "long" })}
        </p>
      </div>
      <p
        className={`ml-4 text-2xl font-bold tabular-nums ${signedPointsClass(
          point.total
        )}`}
      >
        {formatSignedPoints(point.total)}
      </p>
    </div>
  );
}

function EpisodeGroup({
  group,
  partial,
}: {
  group: EpisodePointGroup;
  partial: boolean;
}) {
  const headingId = `season-points-${group.key}`;
  return (
    <section className="bbpc-panel overflow-hidden" aria-labelledby={headingId}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-3">
        <EpisodeHeading episode={group.episode} id={headingId} />
        <span
          className={`text-lg font-bold tabular-nums ${signedPointsClass(
            group.subtotal
          )}`}
        >
          {formatSignedPoints(group.subtotal)}
          {partial ? (
            <span className="ml-1 text-xs font-medium text-zinc-500">
              so far
            </span>
          ) : null}
        </span>
      </header>
      <div className="space-y-5 p-4">
        {group.blocks.map((block) => (
          <div
            key={block.key}
            className={
              block.assignment === null
                ? "space-y-2"
                : "space-y-2 border-l-2 border-indigo-500/50 pl-4"
            }
          >
            {block.assignment !== null && (
              <AssignmentHeading assignment={block.assignment} />
            )}
            {block.points.map((point) => (
              <PointRow key={point.id} point={point} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
