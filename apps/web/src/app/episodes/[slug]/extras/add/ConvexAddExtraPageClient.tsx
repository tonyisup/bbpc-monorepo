"use client";

import { useConvex } from "convex/react";
import { ArrowLeft, Loader2, Search } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { useBbpcAuth } from "@/components/auth/BbpcAuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  type ConvexExtraCatalogMovie,
  type ConvexExtraCatalogShow,
  type ConvexExtraTmdbTitle,
  addMyConvexMovieExtra,
  addMyConvexShowExtra,
  searchConvexExtraMovies,
  searchConvexExtraShows,
  searchConvexExtraTmdb,
  upsertConvexExtraMovie,
  upsertConvexExtraShow,
} from "@/convex/extras";
import { getConvexDomainErrorCode } from "@/convex/identity";
import { getPlainDateYear } from "@/lib/dates";
import { getEpisodePath } from "@/lib/routes";

type ExtraKind = "movie" | "show";
type ExtraSearchResult =
  | {
      source: "catalog";
      kind: "movie";
      item: ConvexExtraCatalogMovie;
    }
  | {
      source: "catalog";
      kind: "show";
      item: ConvexExtraCatalogShow;
    }
  | {
      source: "tmdb";
      kind: ExtraKind;
      item: ConvexExtraTmdbTitle;
      year: number;
    };

function saveError(error: unknown) {
  switch (getConvexDomainErrorCode(error)) {
    case "WRITE_DISABLED":
      return "Extra-review changes are paused while this environment is read-only.";
    case "STALE_CLIENT":
      return "This page is out of date. Refresh it before trying again.";
    case "CONFLICT":
      return "That extra conflicts with the latest episode state.";
    case "VALIDATION_FAILED":
      return "That title cannot be added to this episode.";
    case "NOT_FOUND":
      return "The episode or title is no longer available.";
    default:
      return "The extra could not be saved.";
  }
}

function accountErrorMessage(
  issue: ReturnType<typeof useBbpcAuth>["accountIssue"]
) {
  switch (issue) {
    case "account-disabled":
      return "This account is disabled.";
    case "identity-conflict":
      return "This sign-in is already linked to another account.";
    case "linking-disabled":
      return "New account linking is paused in this environment.";
    case "stale-client":
      return "This page is out of date.";
    default:
      return "Your BBPC account could not be resolved.";
  }
}

function resultKey(result: ExtraSearchResult) {
  return result.source === "catalog"
    ? `${result.kind}:catalog:${result.item.id}`
    : `${result.kind}:tmdb:${String(result.item.id)}`;
}

function resultTitle(result: ExtraSearchResult) {
  return result.item.title;
}

function resultYear(result: ExtraSearchResult) {
  return result.source === "catalog" ? result.item.year : result.year;
}

function resultPoster(result: ExtraSearchResult) {
  return result.source === "catalog"
    ? result.item.poster
    : result.item.poster_path;
}

export function ConvexAddExtraPageClient({
  episodeId,
  episodeSlug,
}: {
  episodeId: string;
  episodeSlug: string | null;
}) {
  const convex = useConvex();
  const router = useRouter();
  const {
    accountIssue,
    accountStatus,
    refreshAccount,
    signIn,
    signOut,
    status,
    user,
  } = useBbpcAuth();
  const [kind, setKind] = useState<ExtraKind>("movie");
  const [inputValue, setInputValue] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ExtraSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [externalUnavailable, setExternalUnavailable] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const searchGenerationRef = useRef(0);
  const canAdd =
    status === "authenticated" &&
    accountStatus === "ready" &&
    user?.appUserId !== null &&
    user?.appUserId !== undefined;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setQuery(inputValue.trim());
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [inputValue]);

  useEffect(() => {
    const generation = searchGenerationRef.current + 1;
    searchGenerationRef.current = generation;
    if (!canAdd || query.length < 2) {
      setResults([]);
      setIsSearching(false);
      setExternalUnavailable(false);
      return;
    }

    setIsSearching(true);
    setErrorMessage(null);
    const catalogSearch =
      kind === "movie"
        ? searchConvexExtraMovies(convex, query)
        : searchConvexExtraShows(convex, query);
    void Promise.allSettled([
      catalogSearch,
      searchConvexExtraTmdb(convex, kind, query),
    ]).then(([catalogResult, tmdbResult]) => {
      if (searchGenerationRef.current !== generation) {
        return;
      }
      const catalog =
        catalogResult.status === "fulfilled" ? catalogResult.value : [];
      const external =
        tmdbResult.status === "fulfilled" ? tmdbResult.value : [];
      const catalogMovieTmdbIds = new Set(
        kind === "movie"
          ? (catalog as ConvexExtraCatalogMovie[]).flatMap((movie) =>
              movie.tmdbId === null ? [] : [movie.tmdbId]
            )
          : []
      );
      const catalogUrls = new Set(catalog.map((item) => item.url));
      const catalogResults: ExtraSearchResult[] =
        kind === "movie"
          ? (catalog as ConvexExtraCatalogMovie[]).map((item) => ({
              source: "catalog",
              kind: "movie",
              item,
            }))
          : (catalog as ConvexExtraCatalogShow[]).map((item) => ({
              source: "catalog",
              kind: "show",
              item,
            }));
      const externalResults = external.flatMap((item): ExtraSearchResult[] => {
        const year = getPlainDateYear(item.release_date);
        if (
          item.poster_path === null ||
          year === null ||
          (kind === "movie" && catalogMovieTmdbIds.has(item.id)) ||
          (item.imdb_path !== null && catalogUrls.has(item.imdb_path))
        ) {
          return [];
        }
        return [{ source: "tmdb", kind, item, year }];
      });
      setResults([...catalogResults, ...externalResults]);
      setExternalUnavailable(tmdbResult.status === "rejected");
      setIsSearching(false);
    });
  }, [canAdd, convex, kind, query]);

  const searchStatus = useMemo(() => {
    if (query.length < 2) {
      return "Enter at least two characters.";
    }
    if (isSearching) {
      return "Searching…";
    }
    return `${results.length} ${results.length === 1 ? "result" : "results"}`;
  }, [isSearching, query.length, results.length]);

  const addResult = async (result: ExtraSearchResult) => {
    const key = resultKey(result);
    setSavingKey(key);
    setErrorMessage(null);
    try {
      if (result.kind === "movie") {
        const movie =
          result.source === "catalog"
            ? result.item
            : await upsertConvexExtraMovie(convex, result.item, result.year);
        await addMyConvexMovieExtra(convex, episodeId, movie.id);
      } else {
        const show =
          result.source === "catalog"
            ? result.item
            : await upsertConvexExtraShow(convex, result.item, result.year);
        await addMyConvexShowExtra(convex, episodeId, show.id);
      }
      router.push(getEpisodePath(episodeSlug ?? episodeId));
    } catch (error) {
      setErrorMessage(saveError(error));
    } finally {
      setSavingKey(null);
    }
  };

  if (status === "loading" || accountStatus === "resolving") {
    return (
      <div
        className="container min-h-[50vh] animate-pulse p-4"
        aria-label="Loading extra-review form"
      />
    );
  }

  if (status === "unauthenticated" || user === null) {
    return (
      <div className="container flex min-h-[50vh] flex-col items-center justify-center p-4 text-center">
        <h1 className="text-2xl font-bold">Sign in to add an extra</h1>
        <Button className="mt-6" onClick={signIn}>
          Sign in
        </Button>
      </div>
    );
  }

  if (accountStatus !== "ready" || user.appUserId === null) {
    return (
      <div className="container flex min-h-[50vh] flex-col items-center justify-center p-4 text-center">
        <h1 className="text-2xl font-bold">Extra-review form unavailable</h1>
        <p className="mt-4 max-w-lg text-muted-foreground">
          {accountErrorMessage(accountIssue)}
        </p>
        <div className="mt-8 flex gap-3">
          <Button variant="outline" onClick={refreshAccount}>
            Try again
          </Button>
          <Button variant="ghost" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4">
      <Button variant="ghost" onClick={() => router.back()}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back
      </Button>

      <header>
        <p className="bbpc-kicker">Episode contribution</p>
        <h1 className="text-3xl font-black text-white">Add an extra</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Search the BBPC catalog or TMDB, then add the movie or show you
          discussed.
        </p>
      </header>

      <RadioGroup
        value={kind}
        onValueChange={(value) => {
          if (value === "movie" || value === "show") {
            setKind(value);
            setResults([]);
            setErrorMessage(null);
          }
        }}
        className="flex items-center gap-6 rounded-lg border border-white/10 bg-white/[0.03] p-4"
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem value="movie" id="extra-movie" />
          <Label htmlFor="extra-movie">Movie</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="show" id="extra-show" />
          <Label htmlFor="extra-show">TV show</Label>
        </div>
      </RadioGroup>

      <div>
        <Label htmlFor="extra-search" className="sr-only">
          Search for a {kind}
        </Label>
        <div className="relative">
          <Input
            id="extra-search"
            value={inputValue}
            disabled={savingKey !== null}
            onChange={(event) => setInputValue(event.target.value)}
            placeholder={`Search for a ${kind}…`}
            className="h-11 pl-10"
          />
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        </div>
        <p className="mt-2 text-sm text-zinc-400" aria-live="polite">
          {searchStatus}
        </p>
        {externalUnavailable && (
          <p className="mt-2 text-sm text-amber-200" role="status">
            External title search is unavailable. BBPC catalog results are still
            usable.
          </p>
        )}
      </div>

      {errorMessage && (
        <div
          className="rounded-lg border border-red-500/30 bg-red-500/[0.08] p-4 text-sm text-red-100"
          role="alert"
        >
          {errorMessage}
        </div>
      )}

      {isSearching ? (
        <div className="flex justify-center p-12">
          <Loader2
            className="h-8 w-8 animate-spin text-primary"
            aria-label="Searching titles"
          />
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((result) => {
            const key = resultKey(result);
            const poster = resultPoster(result);
            return (
              <li
                key={key}
                className="flex gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4"
              >
                {poster ? (
                  <Image
                    src={poster}
                    alt=""
                    width={64}
                    height={96}
                    className="h-24 w-16 shrink-0 rounded object-cover"
                  />
                ) : (
                  <div className="flex h-24 w-16 shrink-0 items-center justify-center rounded bg-white/[0.04] text-xs text-zinc-500">
                    No image
                  </div>
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="font-bold text-white">{resultTitle(result)}</p>
                  <p className="text-sm text-zinc-400">{resultYear(result)}</p>
                  <p className="mt-1 text-xs uppercase tracking-wide text-zinc-500">
                    {result.source === "catalog" ? "BBPC catalog" : "TMDB"}
                  </p>
                  <Button
                    size="sm"
                    className="mt-auto self-start"
                    disabled={savingKey !== null}
                    onClick={() => void addResult(result)}
                  >
                    {savingKey === key ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Adding…
                      </>
                    ) : (
                      "Add extra"
                    )}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
