"use client";

import { useConvex } from "convex/react";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getConvexDomainErrorCode } from "@/convex/identity";
import {
  applyConvexScorecardToRankedList,
  type ConvexRankingListType,
  type ConvexScorecardEntry,
  listConvexMovieRankingTypes,
} from "@/convex/scorecard";
import {
  type ConvexMovieRankingList,
  type ConvexMovieRankingListSummary,
  getMyConvexMovieRankingList,
  listMyConvexMovieRankingLists,
} from "@/convex/year";
import { track } from "@/lib/analytics";
import { SCORECARD_TOP_COUNT } from "@/lib/scorecard";

const CREATE = "create";

export function applyErrorMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "CONFLICT":
      return "Your scorecard changed since you opened this. Check the new top movies and try again.";
    case "WRITE_DISABLED":
      return "Changes are paused while this environment is read-only.";
    case "STALE_CLIENT":
      return "This page is out of date. Refresh it before trying again.";
    case "VALIDATION_FAILED":
      return "That list can't be filled from your scorecard.";
    case "FORBIDDEN":
      return "You can only fill your own ranked lists.";
    default:
      return "Your top 10 could not be saved.";
  }
}

export function ApplyTopTenDialog({
  open,
  year,
  ranked,
  onOpenChange,
  onConflict,
}: {
  open: boolean;
  year: number;
  /** Leaderboard entries in position order. */
  ranked: ConvexScorecardEntry[];
  onOpenChange: (open: boolean) => void;
  onConflict: () => void;
}) {
  const convex = useConvex();
  const [lists, setLists] = useState<ConvexMovieRankingListSummary[] | null>(
    null
  );
  const [types, setTypes] = useState<ConvexRankingListType[]>([]);
  const [target, setTarget] = useState<string>(CREATE);
  const [typeId, setTypeId] = useState<string>("");
  const [current, setCurrent] = useState<ConvexMovieRankingList | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ConvexMovieRankingList | null>(null);
  const defaultTitle = `${String(year)} Top ${String(SCORECARD_TOP_COUNT)}`;

  useEffect(() => {
    if (!open) return;
    setLists(null);
    setError(null);
    setDone(null);
    void Promise.all([
      listMyConvexMovieRankingLists(convex),
      listConvexMovieRankingTypes(convex),
    ]).then(
      ([loadedLists, loadedTypes]) => {
        setLists(loadedLists);
        setTypes(loadedTypes);
        const match = loadedLists.find((list) =>
          (list.title ?? "").includes(String(year))
        );
        setTarget(match ? match.id : CREATE);
        const preferred =
          loadedTypes.find((type) => type.maxItems >= SCORECARD_TOP_COUNT) ??
          loadedTypes[0];
        setTypeId(preferred?.id ?? "");
      },
      () => setError("Your ranked lists could not be loaded.")
    );
  }, [convex, open, year]);

  useEffect(() => {
    setCurrent(null);
    if (!open || target === CREATE) return;
    void getMyConvexMovieRankingList(convex, target).then(setCurrent, () =>
      setCurrent(null)
    );
  }, [convex, open, target]);

  const maxItems =
    target === CREATE
      ? types.find((type) => type.id === typeId)?.maxItems ??
        SCORECARD_TOP_COUNT
      : lists?.find((list) => list.id === target)?.type.maxItems ??
        SCORECARD_TOP_COUNT;
  const count = Math.min(SCORECARD_TOP_COUNT, maxItems, ranked.length);
  const after = useMemo(() => ranked.slice(0, count), [ranked, count]);
  const cutOff = ranked.slice(
    count,
    Math.min(SCORECARD_TOP_COUNT, ranked.length)
  );
  const canCreate = types.length > 0;

  const apply = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await applyConvexScorecardToRankedList(convex, {
        year,
        target:
          target === CREATE
            ? { kind: "create", rankedListTypeId: typeId, title: defaultTitle }
            : { kind: "existing", rankedListId: target },
        expectedMovieIds: after.map((entry) => entry.movie.id),
      });
      track("scorecard_applied_to_list", { item_count: result.items.length });
      setDone(result);
    } catch (caught) {
      setError(applyErrorMessage(caught));
      if (getConvexDomainErrorCode(caught) === "CONFLICT") onConflict();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Use as my top {SCORECARD_TOP_COUNT}</DialogTitle>
          <DialogDescription>
            Replaces everything in the list you pick with your leaderboard, in
            order. The list stays a draft until you publish it on the year page.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-3 text-sm">
            <p>
              Saved {done.items.length} movies to{" "}
              <strong>{done.title ?? "your list"}</strong>.
            </p>
            <Link className="underline" href={`/year?y=${String(year)}`}>
              Open it on the year page
            </Link>
          </div>
        ) : lists === null && error === null ? (
          <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your lists
          </p>
        ) : (
          <div className="space-y-4 text-sm">
            <label className="block space-y-1">
              <span className="font-semibold">List</span>
              <select
                className="h-11 w-full rounded border border-zinc-700 bg-zinc-950 px-2"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              >
                {(lists ?? []).map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.title ?? list.type.name} ({list.itemCount}/
                    {list.type.maxItems}, {list.status.toLowerCase()})
                  </option>
                ))}
                {canCreate && (
                  <option value={CREATE}>Create “{defaultTitle}”</option>
                )}
              </select>
            </label>
            {target === CREATE && types.length > 1 && (
              <label className="block space-y-1">
                <span className="font-semibold">List type</span>
                <select
                  className="h-11 w-full rounded border border-zinc-700 bg-zinc-950 px-2"
                  value={typeId}
                  onChange={(event) => setTypeId(event.target.value)}
                >
                  {types.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name} (up to {type.maxItems})
                    </option>
                  ))}
                </select>
              </label>
            )}
            {target === CREATE && !canCreate && (
              <p className="text-red-400">
                There is no movie list type to create a list from.
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
                  Now
                </p>
                <ol className="list-decimal space-y-0.5 pl-5 text-muted-foreground">
                  {target === CREATE ? (
                    <li className="-ml-5 list-none">New empty list</li>
                  ) : current === null ? (
                    <li className="-ml-5 list-none">Loading…</li>
                  ) : current.items.length === 0 ? (
                    <li className="-ml-5 list-none">Empty</li>
                  ) : (
                    current.items.map((item) => (
                      <li key={item.id} className="truncate">
                        {item.movie?.title ?? "Unavailable movie"}
                      </li>
                    ))
                  )}
                </ol>
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
                  After
                </p>
                <ol className="list-decimal space-y-0.5 pl-5">
                  {after.map((entry) => (
                    <li key={entry.id} className="truncate">
                      {entry.movie.title}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
            {cutOff.length > 0 && (
              <p className="text-amber-300">
                This list holds {maxItems}, so these won&apos;t fit:{" "}
                {cutOff.map((entry) => entry.movie.title).join(", ")}.
              </p>
            )}
            {ranked.length < SCORECARD_TOP_COUNT && (
              <p className="text-muted-foreground">
                Only {ranked.length} movies are fully scored so far.
              </p>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        {!done && (
          <DialogFooter>
            <Button
              type="button"
              disabled={
                saving ||
                lists === null ||
                after.length === 0 ||
                (target === CREATE && typeId === "")
              }
              onClick={() => void apply()}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Replace with these {after.length}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
