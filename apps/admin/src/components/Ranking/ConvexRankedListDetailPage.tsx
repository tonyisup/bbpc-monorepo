import { useConvex } from "convex/react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ExternalLink,
  Loader2,
  MessageSquare,
  Pencil,
  RefreshCw,
  Search,
  Star,
  Trash2,
  Users,
  X,
} from "lucide-react";
import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useBbpcAdminAuth } from "@/components/auth/BbpcAdminAuthContext";
import {
  searchConvexCatalogMovies,
  searchConvexCatalogShows,
} from "@/convex/catalog";
import { searchConvexAdminEpisodes } from "@/convex/episodes";
import { getConvexDomainErrorCode } from "@/convex/identity";
import {
  type ConvexRankedItem,
  type ConvexRankedListDetail,
  type RankingTargetInput,
  changeConvexRankedListOwner,
  loadConvexRankedList,
  moveConvexRankedItem,
  removeConvexRankedItem,
  updateConvexRankedList,
  upsertConvexRankedItem,
} from "@/convex/rankedLists";
import {
  type ConvexAdminUser,
  loadConvexAdminUsersPage,
} from "@/convex/users";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { ConfirmModal } from "../ui/confirm-modal";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Textarea } from "../ui/textarea";

interface TargetSearchResult {
  target: RankingTargetInput;
  title: string;
  subtitle: string;
  poster: string | null;
  url: string | null;
}

function writeFailureMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "FORBIDDEN":
      return "You no longer have access to change this ranked list.";
    case "CONFLICT":
      return "The list changed concurrently or contains incompatible target data.";
    case "NOT_FOUND":
      return "The list, item, owner, or target is no longer available.";
    case "VALIDATION_FAILED":
      return "The title, comment, rank, or target did not pass validation.";
    case "WRITE_DISABLED":
      return "Ranked-list changes are paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    default:
      return "The ranked-list change could not be completed.";
  }
}

function itemTarget(item: ConvexRankedItem): RankingTargetInput {
  switch (item.targetType) {
    case "movie":
      return { kind: "movie", id: item.movieId };
    case "show":
      return { kind: "show", id: item.showId };
    case "episode":
      return { kind: "episode", id: item.episodeId };
  }
}

function itemPresentation(item: ConvexRankedItem) {
  switch (item.targetType) {
    case "movie":
      return {
        title: item.movie.title,
        subtitle: String(item.movie.year || "Unknown year"),
        poster: item.movie.poster,
        url: item.movie.url,
      };
    case "show":
      return {
        title: item.show.title,
        subtitle: String(item.show.year || "Unknown year"),
        poster: item.show.poster,
        url: item.show.url,
      };
    case "episode":
      return {
        title: item.episode.title,
        subtitle: `Episode ${String(item.episode.number)}`,
        poster: null,
        url: null,
      };
  }
}

function RankedTargetSearch({
  disabled,
  onSelect,
  targetType,
}: {
  disabled: boolean;
  onSelect: (result: TargetSearchResult) => void;
  targetType: ConvexRankedListDetail["type"]["targetType"];
}) {
  const convex = useConvex();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TargetSearchResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const search = () => {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 3 || disabled || isSearching) {
      return;
    }
    setIsSearching(true);
    const request =
      targetType === "MOVIE"
        ? searchConvexCatalogMovies(convex, normalizedQuery).then((items) =>
            items.map(
              (item): TargetSearchResult => ({
                target: { kind: "movie", id: item.id },
                title: item.title,
                subtitle: String(item.year || "Unknown year"),
                poster: item.poster,
                url: item.url,
              })
            )
          )
        : targetType === "SHOW"
        ? searchConvexCatalogShows(convex, normalizedQuery).then((items) =>
            items.map(
              (item): TargetSearchResult => ({
                target: { kind: "show", id: item.id },
                title: item.title,
                subtitle: String(item.year || "Unknown year"),
                poster: item.poster,
                url: item.url,
              })
            )
          )
        : searchConvexAdminEpisodes(convex, normalizedQuery).then((items) =>
            items.map(
              (item): TargetSearchResult => ({
                target: { kind: "episode", id: item.id },
                title: item.title,
                subtitle: `Episode ${String(item.number)}`,
                poster: null,
                url: null,
              })
            )
          );
    void request
      .then(setResults)
      .catch(() => {
        setResults(null);
        toast.error("The canonical target catalog could not be searched.");
      })
      .finally(() => setIsSearching(false));
  };

  return (
    <div className="relative w-full">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-10"
            disabled={disabled}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                search();
              }
            }}
            placeholder={`Search canonical ${targetType.toLowerCase()}s...`}
            value={query}
          />
        </div>
        <Button
          disabled={disabled || query.trim().length < 3 || isSearching}
          onClick={search}
          size="sm"
          variant="secondary"
        >
          {isSearching && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Search
        </Button>
      </div>
      {results !== null && (
        <Card className="absolute z-50 mt-2 w-full overflow-hidden shadow-2xl">
          <div className="max-h-72 overflow-y-auto">
            {results.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No canonical targets found. Add the title in its catalog first.
              </div>
            ) : (
              results.map((result) => (
                <button
                  className="flex w-full items-center gap-3 border-b p-3 text-left transition-colors last:border-0 hover:bg-muted"
                  key={`${result.target.kind}:${result.target.id}`}
                  onClick={() => {
                    setQuery("");
                    setResults(null);
                    onSelect(result);
                  }}
                  type="button"
                >
                  <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded bg-muted">
                    {result.poster === null ||
                    result.poster.length === 0 ? (
                      <div className="flex h-full items-center justify-center text-[9px] font-bold text-muted-foreground">
                        N/A
                      </div>
                    ) : (
                      <Image
                        alt=""
                        className="object-cover"
                        fill
                        src={result.poster}
                        unoptimized
                      />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{result.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {result.subtitle}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

export function ConvexRankedListDetailPage() {
  const convex = useConvex();
  const router = useRouter();
  const { accountStatus, status, user } = useBbpcAdminAuth();
  const id = typeof router.query.id === "string" ? router.query.id : null;
  const isReady =
    id !== null &&
    status === "authenticated" &&
    accountStatus === "ready" &&
    user !== null;
  const [list, setList] = useState<ConvexRankedListDetail | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [removingItem, setRemovingItem] =
    useState<ConvexRankedItem | null>(null);
  const [owners, setOwners] = useState<ConvexAdminUser[] | null>(null);
  const [ownerCatalogComplete, setOwnerCatalogComplete] = useState(true);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>("");
  const [ownerTransferOpen, setOwnerTransferOpen] = useState(false);

  useEffect(() => {
    if (!isReady || id === null) {
      return;
    }
    let active = true;
    setLoadFailed(false);
    void loadConvexRankedList(convex, id)
      .then((result) => {
        if (active) {
          setList(result);
          setSelectedOwnerId(result.userId);
        }
      })
      .catch(() => {
        if (active) {
          setLoadFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [convex, id, isReady, revision]);

  useEffect(() => {
    if (!isReady || user?.isAdmin !== true) {
      return;
    }
    let active = true;
    void loadConvexAdminUsersPage(convex, null)
      .then((result) => {
        if (active) {
          setOwners(result.users);
          setOwnerCatalogComplete(result.isDone);
        }
      })
      .catch(() => {
        if (active) {
          setOwners([]);
          setOwnerCatalogComplete(false);
        }
      });
    return () => {
      active = false;
    };
  }, [convex, isReady, user?.isAdmin]);

  const refresh = () => {
    setList(null);
    setRevision((value) => value + 1);
  };

  const runWrite = (
    action: string,
    request: Promise<unknown>,
    successMessage: string
  ) => {
    setPendingAction(action);
    void request
      .then(() => {
        toast.success(successMessage);
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(writeFailureMessage(error));
      })
      .finally(() => setPendingAction(null));
  };

  if (status === "unauthenticated") {
    return (
      <div className="p-12 text-center text-muted-foreground">
        Sign in to view this ranked list.
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-4">
        <p className="text-sm text-muted-foreground">
          This ranked list is unavailable or you do not have access. No legacy
          SQL fallback was attempted.
        </p>
        <Button onClick={refresh} variant="outline">
          <RefreshCw className="mr-2 h-4 w-4" />
          Try again
        </Button>
      </div>
    );
  }

  if (!isReady || list === null) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const canEdit = user.appUserId === list.userId || user.isAdmin;
  const slots = Array.from(
    { length: list.type.maxItems },
    (_, index) => index + 1
  );
  const selectedOwner = owners?.find(
    (candidate) => candidate.id === selectedOwnerId
  );

  return (
    <>
      <Head>
        <title>{list.title ?? list.type.name} | BBPC Admin</title>
      </Head>
      <div className="container mx-auto max-w-5xl space-y-8 p-6">
        <Button asChild size="sm" variant="ghost">
          <Link href="/lists">
            <ChevronLeft className="mr-2 h-4 w-4" />
            Back to Lists
          </Link>
        </Button>

        <Card className="border-none bg-muted/30 shadow-none">
          <CardContent className="p-8">
            <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{list.type.targetType}</Badge>
                  <Badge
                    variant={
                      list.status === "PUBLISHED" ? "default" : "secondary"
                    }
                  >
                    {list.status}
                  </Badge>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="h-3 w-3" />
                    {list.user.name ?? "Unnamed user"}
                  </span>
                </div>

                {editingTitle ? (
                  <div className="flex max-w-2xl items-center gap-2">
                    <Input
                      autoFocus
                      maxLength={1000}
                      onChange={(event) => setTitle(event.target.value)}
                      value={title}
                    />
                    <Button
                      disabled={pendingAction !== null}
                      onClick={() => {
                        runWrite(
                          "title",
                          updateConvexRankedList(convex, list.id, {
                            title: title.trim() || null,
                          }),
                          "List title updated."
                        );
                        setEditingTitle(false);
                      }}
                      size="icon"
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      onClick={() => setEditingTitle(false)}
                      size="icon"
                      variant="ghost"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h1 className="truncate text-4xl font-black tracking-tight">
                      {list.title ?? list.type.name}
                    </h1>
                    {canEdit && (
                      <Button
                        onClick={() => {
                          setTitle(list.title ?? "");
                          setEditingTitle(true);
                        }}
                        size="icon"
                        variant="ghost"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                )}
                <p className="text-muted-foreground">
                  {list.type.description ?? "No description"}
                </p>

                {user.isAdmin && owners !== null && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      onValueChange={setSelectedOwnerId}
                      value={selectedOwnerId}
                    >
                      <SelectTrigger className="w-[260px]">
                        <SelectValue placeholder="Select owner" />
                      </SelectTrigger>
                      <SelectContent>
                        {owners.map((owner) => (
                          <SelectItem key={owner.id} value={owner.id}>
                            {owner.name ?? owner.email ?? "Unnamed user"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      disabled={
                        selectedOwnerId === list.userId ||
                        selectedOwnerId.length === 0 ||
                        pendingAction !== null
                      }
                      onClick={() => setOwnerTransferOpen(true)}
                      size="sm"
                      variant="outline"
                    >
                      Transfer Ownership
                    </Button>
                    {!ownerCatalogComplete && (
                      <span className="text-xs text-amber-600">
                        Showing the first 50 owners.
                      </span>
                    )}
                  </div>
                )}
              </div>

              {canEdit && (
                <Button
                  disabled={pendingAction !== null}
                  onClick={() =>
                    runWrite(
                      "status",
                      updateConvexRankedList(convex, list.id, {
                        status:
                          list.status === "DRAFT" ? "PUBLISHED" : "DRAFT",
                      }),
                      list.status === "DRAFT"
                        ? "List published."
                        : "List returned to draft."
                    )
                  }
                  variant={list.status === "DRAFT" ? "default" : "outline"}
                >
                  {list.status === "DRAFT"
                    ? "Publish Now"
                    : "Revert to Draft"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {slots.map((rank) => {
            const item = list.items.find(
              (candidate) => candidate.rank === rank
            );
            const presentation =
              item === undefined ? null : itemPresentation(item);
            return (
              <div className="flex items-start gap-4" key={rank}>
                <div className="w-10 pt-5 text-center text-xl font-black text-muted-foreground">
                  {rank}
                </div>
                <Card className="flex-1">
                  <CardContent className="p-4">
                    {item === undefined || presentation === null ? (
                      canEdit ? (
                        <div className="space-y-4 py-5">
                          <div className="text-center">
                            <Badge variant="outline">Rank #{rank}</Badge>
                            <p className="mt-2 text-xs text-muted-foreground">
                              Search the canonical catalog to fill this slot.
                            </p>
                          </div>
                          <RankedTargetSearch
                            disabled={pendingAction !== null}
                            onSelect={(result) =>
                              runWrite(
                                `add:${String(rank)}`,
                                upsertConvexRankedItem(convex, {
                                  rankedListId: list.id,
                                  target: result.target,
                                  rank,
                                }),
                                "Item added."
                              )
                            }
                            targetType={list.type.targetType}
                          />
                        </div>
                      ) : (
                        <div className="flex flex-col items-center py-10 text-muted-foreground opacity-40">
                          <Star className="mb-2 h-8 w-8" />
                          <span className="text-xs font-bold uppercase">
                            Slot Open
                          </span>
                        </div>
                      )
                    ) : (
                      <div className="flex flex-col gap-5 sm:flex-row">
                        <div className="relative h-40 w-full shrink-0 overflow-hidden rounded-lg bg-muted sm:w-28">
                          {presentation.poster === null ||
                          presentation.poster.length === 0 ? (
                            <div className="flex h-full items-center justify-center text-xs font-bold text-muted-foreground">
                              No Image
                            </div>
                          ) : (
                            <Image
                              alt={presentation.title}
                              className="object-cover"
                              fill
                              src={presentation.poster}
                              unoptimized
                            />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h3 className="text-xl font-black">
                                {presentation.title}
                              </h3>
                              <p className="text-xs text-muted-foreground">
                                {presentation.subtitle}
                              </p>
                              {presentation.url !== null && (
                                <a
                                  className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                  href={presentation.url}
                                  rel="noopener noreferrer"
                                  target="_blank"
                                >
                                  Open source
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </div>
                            {canEdit && (
                              <div className="flex items-center gap-1">
                                <Button
                                  disabled={
                                    rank === 1 || pendingAction !== null
                                  }
                                  onClick={() =>
                                    runWrite(
                                      `move:${item.id}`,
                                      moveConvexRankedItem(
                                        convex,
                                        item.id,
                                        rank - 1
                                      ),
                                      "Item moved."
                                    )
                                  }
                                  size="icon"
                                  variant="ghost"
                                >
                                  <ChevronUp className="h-4 w-4" />
                                </Button>
                                <Button
                                  disabled={
                                    rank === list.type.maxItems ||
                                    pendingAction !== null
                                  }
                                  onClick={() =>
                                    runWrite(
                                      `move:${item.id}`,
                                      moveConvexRankedItem(
                                        convex,
                                        item.id,
                                        rank + 1
                                      ),
                                      "Item moved."
                                    )
                                  }
                                  size="icon"
                                  variant="ghost"
                                >
                                  <ChevronDown className="h-4 w-4" />
                                </Button>
                                <Button
                                  disabled={pendingAction !== null}
                                  onClick={() => setRemovingItem(item)}
                                  size="icon"
                                  variant="ghost"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            )}
                          </div>

                          <div className="relative mt-4">
                            <MessageSquare className="absolute -left-1 -top-1 h-3 w-3 text-primary/30" />
                            {canEdit ? (
                              <Textarea
                                defaultValue={item.comment ?? ""}
                                maxLength={10000}
                                onBlur={(event) => {
                                  const comment =
                                    event.target.value.trim() || null;
                                  if (comment === item.comment) {
                                    return;
                                  }
                                  runWrite(
                                    `comment:${item.id}`,
                                    upsertConvexRankedItem(convex, {
                                      rankedListId: list.id,
                                      target: itemTarget(item),
                                      rank: item.rank,
                                      comment,
                                    }),
                                    "Comment updated."
                                  );
                                }}
                                placeholder="Add a comment..."
                              />
                            ) : (
                              <p className="border-l-2 border-primary/20 py-2 pl-4 text-sm italic text-muted-foreground">
                                {item.comment ?? "No comment provided."}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>
      </div>

      <ConfirmModal
        description="Remove this item? Remaining ranks stay intact until you move or replace them."
        isOpen={removingItem !== null}
        onClose={() => setRemovingItem(null)}
        onConfirm={() => {
          if (removingItem !== null) {
            const item = removingItem;
            setRemovingItem(null);
            runWrite(
              `remove:${item.id}`,
              removeConvexRankedItem(convex, item.id),
              "Item removed."
            );
          }
        }}
        title="Remove Ranked Item"
      />

      <ConfirmModal
        description={`Transfer this list to ${
          selectedOwner?.name ?? selectedOwner?.email ?? "the selected user"
        }? The new owner receives full edit access.`}
        isOpen={ownerTransferOpen}
        onClose={() => setOwnerTransferOpen(false)}
        onConfirm={() => {
          setOwnerTransferOpen(false);
          runWrite(
            "owner",
            changeConvexRankedListOwner(
              convex,
              list.id,
              selectedOwnerId
            ),
            "List ownership transferred."
          );
        }}
        title="Transfer Ownership"
      />
    </>
  );
}
