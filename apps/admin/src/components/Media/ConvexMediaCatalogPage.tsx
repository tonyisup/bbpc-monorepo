import { useConvex } from "convex/react";
import {
  ExternalLink,
  Film,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Tv,
} from "lucide-react";
import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  type ConvexAdminMovie,
  type ConvexAdminShow,
  type ConvexTmdbTitle,
  deleteConvexAdminMovie,
  deleteConvexAdminShow,
  loadConvexAdminMoviesPage,
  loadConvexAdminShowsPage,
  searchConvexTmdbMovies,
  searchConvexTmdbShows,
  upsertConvexAdminMovie,
  upsertConvexAdminShow,
} from "@/convex/catalog";
import { getConvexDomainErrorCode } from "@/convex/identity";

import { Button } from "../ui/button";
import { ConfirmModal } from "../ui/confirm-modal";
import { Input } from "../ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

type MediaKind = "movie" | "show";
type CatalogItem = ConvexAdminMovie | ConvexAdminShow;

function mediaLabels(kind: MediaKind) {
  return kind === "movie"
    ? {
        plural: "Movies",
        singular: "Movie",
        description: "Manage the canonical movie catalog.",
      }
    : {
        plural: "Shows",
        singular: "Show",
        description: "Manage the canonical TV-show catalog.",
      };
}

function releaseYear(title: ConvexTmdbTitle): string {
  const value = title.first_air_date ?? title.release_date;
  const match = /^(\d{4})-\d{2}-\d{2}$/u.exec(value);
  return match?.[1] ?? "N/A";
}

function mutationFailureMessage(error: unknown, kind: MediaKind): string {
  switch (getConvexDomainErrorCode(error)) {
    case "CONFLICT":
      return `This ${kind} is still referenced and cannot be deleted.`;
    case "NOT_FOUND":
      return `This ${kind} no longer exists.`;
    case "VALIDATION_FAILED":
      return `The ${kind} metadata did not pass catalog validation.`;
    case "WRITE_DISABLED":
      return "Catalog changes are paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    default:
      return `The ${kind} catalog change could not be completed.`;
  }
}

function searchFailureMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "AUTHENTICATION_REQUIRED":
      return "Sign in again before searching TMDB.";
    case "VALIDATION_FAILED":
      return "Enter at least three useful search characters.";
    default:
      return "TMDB search is unavailable in this Convex deployment.";
  }
}

export function ConvexMediaCatalogPage({ kind }: { kind: MediaKind }) {
  const convex = useConvex();
  const labels = mediaLabels(kind);
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [continueCursor, setContinueCursor] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<
    ConvexTmdbTitle[] | null
  >(null);
  const [isSearching, setIsSearching] = useState(false);
  const [pendingAddId, setPendingAddId] = useState<number | null>(null);
  const [deletingItem, setDeletingItem] = useState<CatalogItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    const load =
      kind === "movie"
        ? loadConvexAdminMoviesPage(convex, null)
        : loadConvexAdminShowsPage(convex, null);
    void load
      .then((result) => {
        if (active) {
          setItems(result.items);
          setContinueCursor(result.continueCursor);
          setIsDone(result.isDone);
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
  }, [convex, kind, revision]);

  const visibleItems = useMemo(() => {
    const normalizedFilter = filter.trim().toLocaleLowerCase();
    if (normalizedFilter.length === 0) {
      return items ?? [];
    }
    return (items ?? []).filter((item) =>
      item.title.toLocaleLowerCase().includes(normalizedFilter)
    );
  }, [filter, items]);

  const refresh = () => {
    setItems(null);
    setContinueCursor(null);
    setIsDone(true);
    setRevision((value) => value + 1);
  };

  const loadMore = () => {
    if (isDone || continueCursor === null || isLoadingMore) {
      return;
    }
    setIsLoadingMore(true);
    const load =
      kind === "movie"
        ? loadConvexAdminMoviesPage(convex, continueCursor)
        : loadConvexAdminShowsPage(convex, continueCursor);
    void load
      .then((result) => {
        setItems((current) => [...(current ?? []), ...result.items]);
        setContinueCursor(result.continueCursor);
        setIsDone(result.isDone);
      })
      .catch(() => {
        toast.error(`The next ${kind} page could not be loaded.`);
      })
      .finally(() => setIsLoadingMore(false));
  };

  const searchTmdb = () => {
    const query = searchTerm.trim();
    if (query.length < 3 || isSearching) {
      return;
    }
    setIsSearching(true);
    void (kind === "movie"
      ? searchConvexTmdbMovies(convex, query)
      : searchConvexTmdbShows(convex, query))
      .then(setSearchResults)
      .catch((error: unknown) => {
        setSearchResults(null);
        toast.error(searchFailureMessage(error));
      })
      .finally(() => setIsSearching(false));
  };

  const addTitle = (title: ConvexTmdbTitle) => {
    setPendingAddId(title.id);
    void (kind === "movie"
      ? upsertConvexAdminMovie(convex, title)
      : upsertConvexAdminShow(convex, title))
      .then(() => {
        toast.success(`${labels.singular} saved to the Convex catalog.`);
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(mutationFailureMessage(error, kind));
      })
      .finally(() => setPendingAddId(null));
  };

  const deleteItem = () => {
    if (deletingItem === null || isDeleting) {
      return;
    }
    setIsDeleting(true);
    void (kind === "movie"
      ? deleteConvexAdminMovie(convex, deletingItem.id)
      : deleteConvexAdminShow(convex, deletingItem.id))
      .then(() => {
        toast.success(`${labels.singular} deleted.`);
        setDeletingItem(null);
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(mutationFailureMessage(error, kind));
      })
      .finally(() => setIsDeleting(false));
  };

  const EmptyIcon = kind === "movie" ? Film : Tv;

  return (
    <>
      <Head>
        <title>{labels.plural} - BBPC Admin</title>
      </Head>

      <div className="flex flex-col gap-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">
            {labels.plural}
          </h2>
          <p className="text-muted-foreground">{labels.description}</p>
        </div>

        <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
          Detail pages expose at most 100 runtime-validated reviews and their
          bounded episode relationships. Deletion still succeeds only when
          the backend proves this item is unreferenced.
        </div>

        <section className="flex flex-col gap-4 rounded-lg border bg-card p-6 shadow-sm">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <Search className="h-4 w-4" />
              Search &amp; Add from TMDB
            </h3>
            <p className="text-sm text-muted-foreground">
              Saving the same TMDB URL refreshes its existing catalog row.
            </p>
          </div>
          <div className="flex max-w-2xl gap-2">
            <Input
              aria-label={`Search TMDB for a ${kind}`}
              onChange={(event) => setSearchTerm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  searchTmdb();
                }
              }}
              placeholder={`Search for a ${kind}...`}
              value={searchTerm}
            />
            <Button
              disabled={searchTerm.trim().length < 3 || isSearching}
              onClick={searchTmdb}
              variant="secondary"
            >
              {isSearching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              Search
            </Button>
          </div>

          {searchResults?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No matching TMDB titles were found.
            </p>
          )}

          {searchResults !== null && searchResults.length > 0 && (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
              {searchResults.map((result) => (
                <div
                  className="flex flex-col gap-2 rounded-md border p-2"
                  key={result.id}
                >
                  <a
                    href={`https://www.themoviedb.org/${
                      kind === "movie" ? "movie" : "tv"
                    }/${String(result.id)}`}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <div className="relative aspect-[2/3] overflow-hidden rounded-md bg-secondary">
                      {result.poster_path === null ? (
                        <div className="flex h-full items-center justify-center">
                          <EmptyIcon className="h-8 w-8 text-muted-foreground" />
                        </div>
                      ) : (
                        <Image
                          alt={result.title}
                          className="object-cover"
                          fill
                          src={`https://image.tmdb.org/t/p/w500${result.poster_path}`}
                          unoptimized
                        />
                      )}
                    </div>
                  </a>
                  <div className="min-h-[42px] text-center">
                    <p className="line-clamp-1 text-sm font-bold">
                      {result.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {releaseYear(result)}
                    </p>
                  </div>
                  <Button
                    disabled={pendingAddId !== null}
                    onClick={() => addTitle(result)}
                    size="sm"
                  >
                    {pendingAddId === result.id ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="mr-2 h-4 w-4" />
                    )}
                    Save
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h3 className="text-xl font-bold">
                Existing {labels.plural}
              </h3>
              <p className="text-xs text-muted-foreground">
                The filter applies to rows loaded on this page.
              </p>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter loaded titles..."
                value={filter}
              />
            </div>
          </div>

          {loadFailed ? (
            <div className="rounded-md border bg-card p-8 text-center">
              <p className="mb-4 text-sm text-muted-foreground">
                {labels.plural} could not be loaded. No legacy SQL fallback was
                attempted.
              </p>
              <Button onClick={refresh} variant="outline">
                <RefreshCw className="mr-2 h-4 w-4" />
                Try again
              </Button>
            </div>
          ) : (
            <>
              <div className="rounded-md border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[80px]">Poster</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Year</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items === null && (
                      <TableRow>
                        <TableCell className="h-24 text-center" colSpan={4}>
                          <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    )}
                    {items !== null && visibleItems.length === 0 && (
                      <TableRow>
                        <TableCell className="h-24 text-center" colSpan={4}>
                          {filter.trim().length > 0
                            ? "No loaded titles match this filter."
                            : `No ${kind}s found.`}
                        </TableCell>
                      </TableRow>
                    )}
                    {visibleItems.map((item) => (
                      <TableRow className="group" key={item.id}>
                        <TableCell>
                          {item.poster !== null && item.poster.length > 0 ? (
                            <a
                              href={item.url}
                              rel="noopener noreferrer"
                              target="_blank"
                            >
                              <div className="relative aspect-[2/3] w-12 overflow-hidden rounded shadow-sm">
                                <Image
                                  alt={item.title}
                                  className="object-cover"
                                  fill
                                  src={item.poster}
                                  unoptimized
                                />
                              </div>
                            </a>
                          ) : (
                            <div className="flex aspect-[2/3] w-12 items-center justify-center rounded bg-secondary">
                              <EmptyIcon className="h-5 w-5 text-muted-foreground" />
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          <Link
                            className="hover:underline"
                            href={`/${kind}/${item.id}`}
                          >
                            {item.title}
                          </Link>
                          <a
                            aria-label={`Open external details for ${item.title}`}
                            className="ml-2 inline-flex align-middle text-muted-foreground hover:text-foreground"
                            href={item.url}
                            rel="noopener noreferrer"
                            target="_blank"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </TableCell>
                        <TableCell>{item.year || "Unknown"}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            aria-label={`Delete ${item.title}`}
                            className="text-destructive opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                            onClick={() => setDeletingItem(item)}
                            size="icon"
                            variant="ghost"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {!isDone && (
                <div className="flex justify-center">
                  <Button
                    disabled={isLoadingMore}
                    onClick={loadMore}
                    variant="outline"
                  >
                    {isLoadingMore && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Load More
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <ConfirmModal
        description={`Delete “${deletingItem?.title ?? ""}”? Convex will refuse if any migrated relationship still references it.`}
        isOpen={deletingItem !== null}
        onClose={() => {
          if (!isDeleting) {
            setDeletingItem(null);
          }
        }}
        onConfirm={deleteItem}
        title={`Delete ${labels.singular}`}
      />
    </>
  );
}
