"use client";

import { useConvex } from "convex/react";
import { Trophy } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  type ConvexPointHistoryItem,
  loadConvexPointHistoryPage,
} from "@/convex/profile";
import { formatInstantLocal } from "@/lib/dates";

interface HistoryState {
  points: ConvexPointHistoryItem[];
  cursor: string | null;
  isDone: boolean;
}

const emptyHistory: HistoryState = {
  points: [],
  cursor: null,
  isDone: false,
};

export function ConvexPointHistory({ appUserId }: { appUserId: string }) {
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
        const result = await loadConvexPointHistoryPage(convex, cursor);
        if (loadGenerationRef.current !== generation) {
          return;
        }
        if (!result.isDone && result.continueCursor === cursor) {
          throw new Error("Point-history pagination did not advance.");
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
    [convex]
  );

  useEffect(() => {
    setHistory(emptyHistory);
    void loadPage(null, true);
  }, [appUserId, loadPage]);

  const seasonGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        id: string;
        title: string;
        points: ConvexPointHistoryItem[];
      }
    >();
    for (const point of history.points) {
      const group = groups.get(point.season.id) ?? {
        id: point.season.id,
        title: point.season.title,
        points: [],
      };
      group.points.push(point);
      groups.set(point.season.id, group);
    }
    return [...groups.values()];
  }, [history.points]);

  return (
    <section className="w-full max-w-4xl space-y-6">
      <h3 className="text-2xl font-bold text-white">Point History</h3>

      {seasonGroups.map((season) => (
        <div
          key={season.id}
          className="overflow-hidden rounded-xl border border-gray-700 bg-gray-900/40"
        >
          <div className="flex items-center gap-3 border-b border-gray-700 bg-gradient-to-r from-gray-800 to-gray-900 p-4">
            <Trophy className="h-5 w-5 text-yellow-500" />
            <h4 className="text-xl font-bold text-white">{season.title}</h4>
          </div>
          <div className="grid gap-3 p-4">
            {season.points.map((point) => (
              <div
                key={point.id}
                className="flex items-center justify-between rounded-lg border border-gray-700/50 bg-gray-800/50 p-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-white">
                    {point.reason ??
                      point.gamePointType?.title ??
                      "Point adjustment"}
                  </p>
                  {point.gamePointType?.description ? (
                    <p className="mt-1 text-sm text-gray-400">
                      {point.gamePointType.description}
                    </p>
                  ) : null}
                  <p className="mt-2 font-mono text-xs text-gray-500">
                    {formatInstantLocal(new Date(point.earnedAt), {
                      dateStyle: "long",
                    })}
                  </p>
                </div>
                <p
                  className={`ml-4 text-2xl font-bold ${
                    point.total >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {point.total > 0 ? "+" : ""}
                  {point.total}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}

      {!isLoading && history.points.length === 0 && !failed ? (
        <p className="text-sm text-zinc-400">No point history yet.</p>
      ) : null}

      {failed ? (
        <div className="space-y-3" role="alert">
          <p className="text-sm text-red-300">
            Point history could not be loaded.
          </p>
          <Button
            variant="outline"
            onClick={() => void loadPage(history.cursor, false)}
          >
            Try again
          </Button>
        </div>
      ) : null}

      {isLoading ? (
        <div
          className="h-20 animate-pulse rounded-lg bg-white/[0.04]"
          aria-label="Loading point history"
        />
      ) : null}

      {!isLoading && !failed && !history.isDone ? (
        <Button
          variant="outline"
          onClick={() => void loadPage(history.cursor, false)}
        >
          Load older history
        </Button>
      ) : null}
    </section>
  );
}
