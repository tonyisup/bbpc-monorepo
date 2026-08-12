"use client";

import { useConvex } from "convex/react";
import {
  ArrowDownUp,
  Check,
  ChevronDown,
  ExternalLink,
  GripVertical,
  LayoutGrid,
  List,
  Loader2,
  Trash2,
} from "lucide-react";
import { Reorder, useDragControls } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import RatingIcon from "@/components/RatingIcon";
import UserTag from "@/components/UserTag";
import { useBbpcAuth } from "@/components/auth/BbpcAuthContext";
import { Button } from "@/components/ui/button";
import { getConvexDomainErrorCode } from "@/convex/identity";
import {
  type ConvexMovieRankingItem,
  type ConvexMovieRankingList,
  type ConvexMovieRankingListSummary,
  type ConvexYearReview,
  getMyConvexMovieRankingList,
  listConvexYearReviews,
  listMyConvexMovieRankingLists,
  removeConvexMovieRankingItem,
  reorderConvexMovieRankingItems,
  upsertConvexMovieRankingItem,
} from "@/convex/year";
import {
  formatInstantLocal,
  getPacificTodayPlainDate,
  getPlainDateYear,
} from "@/lib/dates";
import { getEpisodePath } from "@/lib/routes";

type ViewMode = "grid" | "list";
type YearMovieGroup = {
  movie: ConvexYearReview["movie"];
  reviews: ConvexYearReview[];
  episodes: Array<NonNullable<ConvexYearReview["episode"]>>;
};

function getInitialViewMode(value: string | null): ViewMode {
  return value === "list" ? "list" : "grid";
}

function getSelectedYear(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1900 && parsed <= 2200
    ? parsed
    : fallback;
}

function rankingOperationError(error: unknown) {
  switch (getConvexDomainErrorCode(error)) {
    case "WRITE_DISABLED":
      return "Ranking changes are paused while this environment is read-only.";
    case "STALE_CLIENT":
      return "This page is out of date. Refresh it before trying again.";
    case "CONFLICT":
      return "That change conflicts with the latest ranking. Reload and try again.";
    case "VALIDATION_FAILED":
      return "That ranking change is not valid.";
    case "FORBIDDEN":
      return "You no longer have access to that ranked list.";
    default:
      return "The ranking change could not be saved.";
  }
}

function RankedItemRow({
  disabled,
  index,
  item,
  onDragEnd,
  onRemove,
}: {
  disabled: boolean;
  index: number;
  item: ConvexMovieRankingItem;
  onDragEnd: () => void;
  onRemove: () => void;
}) {
  const dragControls = useDragControls();

  return (
    <Reorder.Item
      value={item}
      id={item.id}
      dragListener={false}
      dragControls={dragControls}
      onDragStart={() => {
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate(50);
        }
      }}
      onDragEnd={onDragEnd}
    >
      <div className="group flex select-none items-center gap-3 rounded border border-zinc-700/50 bg-zinc-800/40 p-2 transition-colors hover:bg-zinc-800/80">
        <button
          type="button"
          aria-label={`Drag ${item.movie?.title ?? "movie"} to reorder`}
          className="flex-shrink-0 cursor-grab touch-none p-1 text-zinc-500 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          onPointerDown={(event) => dragControls.start(event)}
        >
          <GripVertical className="h-5 w-5" />
        </button>
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-zinc-700/50 text-sm font-bold">
          {index + 1}
        </div>
        {item.movie?.poster && (
          <Image
            src={item.movie.poster}
            alt=""
            width={32}
            height={48}
            className="pointer-events-none h-12 w-8 rounded object-cover shadow"
          />
        )}
        <div className="min-w-0 flex-grow">
          <p className="truncate text-sm font-bold text-white">
            {item.movie?.title ?? "Unavailable movie"}
          </p>
          {item.movie && (
            <p className="text-xs text-zinc-400">{item.movie.year}</p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-zinc-500 transition-opacity hover:text-destructive"
          aria-label={`Remove ${item.movie?.title ?? "movie"} from ranking`}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </Reorder.Item>
  );
}

export function ConvexYearPageClient() {
  const convex = useConvex();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accountStatus, status, user } = useBbpcAuth();
  const currentYear =
    getPlainDateYear(getPacificTodayPlainDate()) ?? new Date().getFullYear();
  const selectedYear = getSelectedYear(searchParams.get("y"), currentYear);
  const viewMode = getInitialViewMode(searchParams.get("view"));
  const sortDesc = searchParams.get("sort") !== "asc";
  const canManageRankings =
    status === "authenticated" &&
    accountStatus === "ready" &&
    user?.appUserId !== null &&
    user?.appUserId !== undefined &&
    user.isAdmin;

  const [reviews, setReviews] = useState<ConvexYearReview[]>([]);
  const [isArchiveLoading, setIsArchiveLoading] = useState(true);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [rankingLists, setRankingLists] = useState<
    ConvexMovieRankingListSummary[]
  >([]);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [selectedList, setSelectedList] =
    useState<ConvexMovieRankingList | null>(null);
  const [orderedItems, setOrderedItems] = useState<ConvexMovieRankingItem[]>(
    []
  );
  const [rankSelections, setRankSelections] = useState<
    Record<string, { sourceRank: number | null; value: string }>
  >({});
  const [isRankingsLoading, setIsRankingsLoading] = useState(false);
  const [rankingError, setRankingError] = useState<string | null>(null);
  const [busyOperation, setBusyOperation] = useState<string | null>(null);
  const archiveGenerationRef = useRef(0);
  const rankingGenerationRef = useRef(0);

  const replaceControls = ({
    descending = sortDesc,
    view = viewMode,
    year = selectedYear,
  }: {
    descending?: boolean;
    view?: ViewMode;
    year?: number;
  }) => {
    const params = new URLSearchParams();
    params.set("y", year.toString());
    params.set("view", view);
    params.set("sort", descending ? "desc" : "asc");
    router.replace(`/year?${params.toString()}`, { scroll: false });
  };

  useEffect(() => {
    const generation = archiveGenerationRef.current + 1;
    archiveGenerationRef.current = generation;
    setIsArchiveLoading(true);
    setArchiveError(null);
    void listConvexYearReviews(convex, selectedYear)
      .then((result) => {
        if (archiveGenerationRef.current === generation) {
          setReviews(result);
        }
      })
      .catch(() => {
        if (archiveGenerationRef.current === generation) {
          setReviews([]);
          setArchiveError("The year archive could not be loaded.");
        }
      })
      .finally(() => {
        if (archiveGenerationRef.current === generation) {
          setIsArchiveLoading(false);
        }
      });
  }, [convex, selectedYear]);

  const reloadRankingState = useCallback(
    async (rankedListId: string | null = selectedListId) => {
      if (!canManageRankings) {
        setRankingLists([]);
        setSelectedList(null);
        setOrderedItems([]);
        return;
      }
      const generation = rankingGenerationRef.current + 1;
      rankingGenerationRef.current = generation;
      setIsRankingsLoading(true);
      setRankingError(null);
      try {
        const [lists, detail] = await Promise.all([
          listMyConvexMovieRankingLists(convex),
          rankedListId === null
            ? Promise.resolve(null)
            : getMyConvexMovieRankingList(convex, rankedListId),
        ]);
        if (rankingGenerationRef.current !== generation) {
          return;
        }
        setRankingLists(lists);
        if (
          rankedListId !== null &&
          !lists.some((list) => list.id === rankedListId)
        ) {
          setSelectedListId(null);
          setSelectedList(null);
          setOrderedItems([]);
          return;
        }
        setSelectedList(detail);
        setOrderedItems(detail?.items ?? []);
      } catch {
        if (rankingGenerationRef.current === generation) {
          setRankingError("Your ranked lists could not be loaded.");
          setSelectedList(null);
          setOrderedItems([]);
        }
      } finally {
        if (rankingGenerationRef.current === generation) {
          setIsRankingsLoading(false);
        }
      }
    },
    [canManageRankings, convex, selectedListId]
  );

  useEffect(() => {
    void reloadRankingState();
  }, [reloadRankingState]);

  const sortedReviews = useMemo(
    () =>
      [...reviews].sort((left, right) =>
        sortDesc
          ? right.reviewedAt - left.reviewedAt
          : left.reviewedAt - right.reviewedAt
      ),
    [reviews, sortDesc]
  );

  const groupedMovies = useMemo(
    () =>
      Array.from(
        sortedReviews
          .reduce<Map<string, YearMovieGroup>>((groups, review) => {
            const existing = groups.get(review.movie.id);
            if (existing) {
              existing.reviews.push(review);
              if (
                review.episode &&
                !existing.episodes.some(
                  (episode) => episode.id === review.episode?.id
                )
              ) {
                existing.episodes.push(review.episode);
              }
            } else {
              groups.set(review.movie.id, {
                movie: review.movie,
                reviews: [review],
                episodes: review.episode ? [review.episode] : [],
              });
            }
            return groups;
          }, new Map())
          .values()
      ),
    [sortedReviews]
  );

  const years = Array.from({ length: 10 }, (_, index) => currentYear - index);

  const selectRankingList = (id: string | null) => {
    setSelectedListId(id);
    setSelectedList(null);
    setOrderedItems([]);
    setRankSelections({});
  };

  const saveRank = async (movieId: string, rank: number) => {
    if (selectedListId === null || selectedList === null) {
      return;
    }
    const previousList = selectedList;
    const previousItems = orderedItems;
    setBusyOperation(`rank:${movieId}`);
    setRankingError(null);
    try {
      await upsertConvexMovieRankingItem(convex, {
        rankedListId: selectedListId,
        movieId,
        rank,
      });
      await reloadRankingState(selectedListId);
    } catch (error) {
      setSelectedList(previousList);
      setOrderedItems(previousItems);
      setRankingError(rankingOperationError(error));
    } finally {
      setBusyOperation(null);
    }
  };

  const removeRankingItem = async (item: ConvexMovieRankingItem) => {
    if (selectedListId === null || selectedList === null) {
      return;
    }
    const previousList = selectedList;
    const previousItems = orderedItems;
    setSelectedList({
      ...selectedList,
      itemCount: Math.max(0, selectedList.itemCount - 1),
      items: selectedList.items.filter((entry) => entry.id !== item.id),
    });
    setOrderedItems((current) =>
      current.filter((entry) => entry.id !== item.id)
    );
    setBusyOperation(`remove:${item.id}`);
    setRankingError(null);
    try {
      await removeConvexMovieRankingItem(convex, item.id);
      await reloadRankingState(selectedListId);
    } catch (error) {
      setSelectedList(previousList);
      setOrderedItems(previousItems);
      setRankingError(rankingOperationError(error));
    } finally {
      setBusyOperation(null);
    }
  };

  const persistOrderedItems = async () => {
    if (selectedListId === null || selectedList === null) {
      return;
    }
    const previousList = selectedList;
    const previousItems = selectedList.items;
    setBusyOperation("reorder");
    setRankingError(null);
    try {
      const updated = await reorderConvexMovieRankingItems(
        convex,
        selectedListId,
        orderedItems.map((item) => item.id)
      );
      setSelectedList(updated);
      setOrderedItems(updated.items);
      const lists = await listMyConvexMovieRankingLists(convex);
      setRankingLists(lists);
    } catch (error) {
      setSelectedList(previousList);
      setOrderedItems(previousItems);
      setRankingError(rankingOperationError(error));
    } finally {
      setBusyOperation(null);
    }
  };

  return (
    <div className="bbpc-page space-y-6">
      <div className="bbpc-panel flex flex-col items-start justify-between gap-4 p-4 md:flex-row md:items-center">
        <div>
          <p className="bbpc-kicker">Movie archive</p>
          <h1 className="text-3xl font-black tracking-tight text-white">
            Year in review
          </h1>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-4">
          <div className="relative">
            <label htmlFor="year-filter" className="sr-only">
              Review year
            </label>
            <select
              id="year-filter"
              value={selectedYear}
              onChange={(event) =>
                replaceControls({ year: Number(event.target.value) })
              }
              className="h-11 cursor-pointer appearance-none rounded-md border border-zinc-700 bg-zinc-800 py-2 pl-3 pr-8 text-white focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {!years.includes(selectedYear) && (
                <option value={selectedYear}>{selectedYear}</option>
              )}
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-white">
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </div>
          </div>

          <Button
            variant="ghost"
            onClick={() => replaceControls({ descending: !sortDesc })}
            className={`h-11 ${sortDesc ? "bg-zinc-800" : ""}`}
            aria-pressed={sortDesc}
          >
            <ArrowDownUp className="h-5 w-5" />
            {sortDesc ? "Newest first" : "Oldest first"}
          </Button>

          <div
            className="flex items-center rounded-md bg-zinc-800 p-1"
            role="group"
            aria-label="View"
          >
            <Button
              variant="ghost"
              onClick={() => replaceControls({ view: "grid" })}
              className={`h-11 px-3 ${
                viewMode === "grid" ? "bg-zinc-700" : ""
              }`}
              aria-label="Grid view"
              aria-pressed={viewMode === "grid"}
            >
              <LayoutGrid className="h-5 w-5" />
              <span className="hidden sm:inline">Grid</span>
            </Button>
            <Button
              variant="ghost"
              onClick={() => replaceControls({ view: "list" })}
              className={`h-11 px-3 ${
                viewMode === "list" ? "bg-zinc-700" : ""
              }`}
              aria-label="List view"
              aria-pressed={viewMode === "list"}
            >
              <List className="h-5 w-5" />
              <span className="hidden sm:inline">List</span>
            </Button>
          </div>
        </div>
      </div>

      {archiveError && (
        <div
          role="alert"
          className="bbpc-panel border-red-900/60 p-4 text-red-200"
        >
          {archiveError}
        </div>
      )}

      {isArchiveLoading ? (
        <div className="flex justify-center py-20" aria-label="Loading archive">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      ) : sortedReviews.length === 0 ? (
        <div className="py-20 text-center text-zinc-500">
          No movies found for {selectedYear}.
        </div>
      ) : (
        <div className="min-h-[50vh]">
          {viewMode === "grid" && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-6">
              {groupedMovies.map((group, index) => (
                <article key={group.movie.id} className="min-w-0">
                  <a
                    href={group.movie.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block overflow-hidden rounded-lg bg-zinc-900 transition-opacity hover:opacity-80"
                  >
                    {group.movie.poster ? (
                      <Image
                        src={group.movie.poster}
                        alt={group.movie.title}
                        width={200}
                        height={300}
                        priority={index === 0}
                        className="aspect-[2/3] h-auto w-full object-cover"
                      />
                    ) : (
                      <div className="flex aspect-[2/3] items-center justify-center px-3 text-center text-sm text-zinc-500">
                        {group.movie.title}
                      </div>
                    )}
                  </a>
                  <div className="mt-3 space-y-2 text-sm text-zinc-300">
                    <h2 className="font-bold text-white">
                      {group.movie.title}
                    </h2>
                    {group.reviews.length > 1 && (
                      <p className="font-semibold text-white">
                        {group.reviews.length} reviews
                      </p>
                    )}
                    <ul className="space-y-2" aria-label="Host ratings">
                      {group.reviews.map((review) => (
                        <li
                          key={review.id}
                          className="flex min-w-0 flex-wrap items-center gap-2"
                        >
                          <UserTag user={review.user} />
                          {review.rating && (
                            <span className="inline-flex items-center gap-1 text-xs text-zinc-300">
                              <RatingIcon value={review.rating.value} />
                              {review.rating.name}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                    {group.episodes.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 text-xs">
                        <span className="text-zinc-500">
                          {group.episodes.length === 1
                            ? "Episode:"
                            : "Episodes:"}
                        </span>
                        {group.episodes.map((episode) => (
                          <Link
                            key={episode.id}
                            href={getEpisodePath(episode.slug ?? episode.id)}
                            className="text-red-300 hover:underline"
                          >
                            Ep {episode.number}
                          </Link>
                        ))}
                      </div>
                    )}
                    {group.movie.url && (
                      <a
                        href={group.movie.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-400 hover:text-white"
                      >
                        IMDb <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}

          {viewMode === "list" && (
            <div className="space-y-6">
              {canManageRankings && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
                  <label
                    htmlFor="ranked-list-selector"
                    className="mb-2 block text-sm font-medium text-zinc-300"
                  >
                    Select a ranked list to add movies
                  </label>
                  <select
                    id="ranked-list-selector"
                    value={selectedListId ?? ""}
                    onChange={(event) =>
                      selectRankingList(event.target.value || null)
                    }
                    disabled={isRankingsLoading || busyOperation !== null}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-primary/50 md:w-auto"
                  >
                    <option value="">None selected</option>
                    {rankingLists.map((list) => (
                      <option key={list.id} value={list.id}>
                        {list.title ?? list.type.name} ({list.itemCount}/
                        {list.type.maxItems})
                      </option>
                    ))}
                  </select>
                  {isRankingsLoading && (
                    <Loader2
                      className="ml-3 inline h-4 w-4 animate-spin"
                      aria-label="Loading ranked lists"
                    />
                  )}
                  {!isRankingsLoading && rankingLists.length === 0 && (
                    <p className="mt-2 text-sm text-zinc-500">
                      You do not have a movie ranked list yet.
                    </p>
                  )}
                </div>
              )}

              {rankingError && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-200"
                >
                  {rankingError}
                </div>
              )}

              {selectedListId && selectedList && orderedItems.length > 0 && (
                <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/40 p-6">
                  <h2 className="flex items-center gap-2 border-b border-zinc-700 pb-2 text-lg font-bold text-white">
                    <Check className="h-5 w-5 text-primary" />
                    Current rankings:{" "}
                    {selectedList.title ?? selectedList.type.name}
                  </h2>
                  <Reorder.Group
                    axis="y"
                    values={orderedItems}
                    onReorder={
                      busyOperation === null ? setOrderedItems : () => undefined
                    }
                    className="flex flex-col gap-3"
                  >
                    {orderedItems.map((item, index) => (
                      <RankedItemRow
                        key={item.id}
                        item={item}
                        index={index}
                        disabled={busyOperation !== null}
                        onRemove={() => {
                          if (
                            window.confirm(
                              "Remove this item from the ranked list?"
                            )
                          ) {
                            void removeRankingItem(item);
                          }
                        }}
                        onDragEnd={() => void persistOrderedItems()}
                      />
                    ))}
                  </Reorder.Group>
                </div>
              )}

              <div className="flex flex-col gap-4">
                {groupedMovies.map((group) => {
                  const existingItem = selectedList?.items.find(
                    (item) => item.movieId === group.movie.id
                  );
                  const currentRank = existingItem?.rank ?? null;
                  const selectionKey = `${selectedListId ?? "none"}:${
                    group.movie.id
                  }`;
                  const rankSelection = rankSelections[selectionKey];
                  const selectedRank =
                    rankSelection?.sourceRank === currentRank
                      ? rankSelection.value
                      : currentRank?.toString() ?? "";
                  const parsedRank = Number.parseInt(selectedRank, 10);
                  const validRank =
                    selectedList !== null &&
                    parsedRank >= 1 &&
                    parsedRank <= selectedList.type.maxItems;

                  return (
                    <article
                      key={group.movie.id}
                      className="flex flex-col gap-4 rounded-lg border border-zinc-800/50 bg-zinc-900/40 p-4 transition-colors hover:bg-zinc-900/80 md:flex-row"
                    >
                      <div className="mx-auto flex-shrink-0 md:mx-0">
                        {group.movie.poster ? (
                          <Image
                            src={group.movie.poster}
                            alt={group.movie.title}
                            width={96}
                            height={144}
                            className="h-36 w-24 rounded object-cover shadow-lg"
                          />
                        ) : (
                          <div className="flex h-36 w-24 items-center justify-center rounded bg-zinc-800 px-2 text-center text-xs text-zinc-500">
                            No image
                          </div>
                        )}
                      </div>
                      <div className="flex flex-grow flex-col justify-between py-1 text-center md:text-left">
                        <div>
                          <h2 className="mb-1 text-xl font-bold text-white">
                            {group.movie.title}
                          </h2>
                          <div className="mb-2 text-zinc-400">
                            {group.movie.year}
                          </div>
                          <ul
                            className="mb-3 space-y-2"
                            aria-label="Host ratings"
                          >
                            {group.reviews.map((review) => (
                              <li
                                key={review.id}
                                className="flex flex-wrap items-center justify-center gap-2 md:justify-start"
                              >
                                <UserTag user={review.user} />
                                {review.rating && (
                                  <span className="inline-flex items-center gap-1 text-sm text-zinc-300">
                                    <RatingIcon value={review.rating.value} />
                                    {review.rating.name}
                                  </span>
                                )}
                                <span className="text-xs text-zinc-500">
                                  {formatInstantLocal(
                                    new Date(review.reviewedAt)
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center justify-center gap-4 md:justify-start">
                          {group.episodes.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-300">
                              <span>Reviewed on</span>
                              {group.episodes.map((episode) => (
                                <Link
                                  key={episode.id}
                                  href={getEpisodePath(
                                    episode.slug ?? episode.id
                                  )}
                                  className="font-semibold text-primary hover:underline"
                                >
                                  Episode {episode.number}
                                </Link>
                              ))}
                            </div>
                          )}
                          {group.movie.url && (
                            <a
                              href={group.movie.url}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-auto rounded border border-yellow-600/50 bg-yellow-600/20 px-3 py-1 text-xs text-yellow-500 transition-colors hover:bg-yellow-600/30"
                            >
                              IMDb
                            </a>
                          )}
                        </div>
                      </div>

                      {canManageRankings && selectedListId && selectedList && (
                        <div className="flex flex-shrink-0 items-center justify-center md:justify-end">
                          <div className="flex min-w-[200px] flex-col gap-2 rounded border border-zinc-700 bg-zinc-800/50 p-3">
                            <label
                              htmlFor={`rank-select-${group.movie.id}`}
                              className="text-xs font-medium text-zinc-400"
                            >
                              Rank in{" "}
                              {selectedList.title ?? selectedList.type.name}
                            </label>
                            <div className="flex items-center gap-2">
                              <select
                                id={`rank-select-${group.movie.id}`}
                                value={selectedRank}
                                disabled={busyOperation !== null}
                                onChange={(event) =>
                                  setRankSelections((selections) => ({
                                    ...selections,
                                    [selectionKey]: {
                                      sourceRank: currentRank,
                                      value: event.target.value,
                                    },
                                  }))
                                }
                                className="flex-grow rounded border border-zinc-600 bg-zinc-900 px-2 py-1 text-white focus:outline-none focus:ring-2 focus:ring-primary/50"
                              >
                                <option value="" disabled>
                                  #
                                </option>
                                {Array.from(
                                  { length: selectedList.type.maxItems },
                                  (_, index) => index + 1
                                ).map((rank) => (
                                  <option key={rank} value={rank}>
                                    Rank #{rank}
                                  </option>
                                ))}
                              </select>
                              <Button
                                size="sm"
                                disabled={!validRank || busyOperation !== null}
                                onClick={() =>
                                  void saveRank(group.movie.id, parsedRank)
                                }
                                className="bg-primary hover:bg-primary/80"
                              >
                                {busyOperation === `rank:${group.movie.id}` ? (
                                  <Loader2
                                    className="h-4 w-4 animate-spin"
                                    aria-label="Saving rank"
                                  />
                                ) : currentRank ? (
                                  "Update"
                                ) : (
                                  "Add"
                                )}
                              </Button>
                            </div>
                            {currentRank && (
                              <div className="flex items-center gap-1 text-xs text-green-500">
                                <Check className="h-3 w-3" />
                                Currently #{currentRank}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
