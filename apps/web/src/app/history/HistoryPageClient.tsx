"use client";

import React, { useState, useMemo, useEffect } from "react";
import { Episode, type CompleteEpisode } from "@/components/Episode";
import SearchFilter from "@/components/common/SearchFilter";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import Fuse, { type FuseResultMatch } from "fuse.js";
import { debounce } from "lodash";

const FUZZY_SEARCH_STORAGE_KEY = "bbpc-history-fuzzy-search";

type HistoryEpisode = CompleteEpisode;

type HistorySearchRow = {
  episode: HistoryEpisode;
  fuseMatches?: ReadonlyArray<FuseResultMatch>;
};

function episodeMatchesSubstring(
  episode: HistoryEpisode,
  needleLower: string
): boolean {
  if (episode.title.toLowerCase().includes(needleLower)) {
    return true;
  }
  for (const a of episode.assignments) {
    const t = a.movie?.title;
    if (
      t !== undefined &&
      t !== null &&
      t.toLowerCase().includes(needleLower)
    ) {
      return true;
    }
  }
  for (const e of episode.extras) {
    const movieTitle = e.review.movie?.title;
    if (
      movieTitle !== undefined &&
      movieTitle !== null &&
      movieTitle.toLowerCase().includes(needleLower)
    ) {
      return true;
    }
    const showTitle = e.review.show?.title;
    if (
      showTitle !== undefined &&
      showTitle !== null &&
      showTitle.toLowerCase().includes(needleLower)
    ) {
      return true;
    }
  }
  return false;
}

function SearchResults({
  rows,
  query,
  isLoading,
}: {
  rows: HistorySearchRow[];
  query: string;
  isLoading: boolean;
}) {
  if (!query) {
    return (
      <div className="bbpc-panel flex flex-col items-center gap-3 p-8 text-center">
        <h2 className="text-xl font-bold text-white">
          Find a movie, title, or episode
        </h2>
        <p className="max-w-lg text-sm text-zinc-300">
          Search the archive, or browse every episode in reverse chronological
          order.
        </p>
        <Link
          href="/episodes"
          className="font-semibold text-red-300 underline underline-offset-4"
        >
          Browse all episodes
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return <div className="text-center text-zinc-300">Searching...</div>;
  }

  if (rows.length === 0) {
    return (
      <div className="text-center text-zinc-400">
        No episodes found matching your search.
      </div>
    );
  }

  return (
    <ul>
      {rows.map(({ episode, fuseMatches }) => (
        <li className="mb-8" key={episode.id}>
          <Episode
            episode={episode}
            showMovieTitles={true}
            searchQuery={query}
            fuseMatches={fuseMatches}
          />
        </li>
      ))}
    </ul>
  );
}

export function HistoryPageClient({
  allEpisodes,
  isLoading = false,
}: {
  allEpisodes: HistoryEpisode[] | undefined;
  isLoading?: boolean;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Initialize local query state from URL to allow immediate UI updates
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [fuzzySearch, setFuzzySearch] = useState(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(FUZZY_SEARCH_STORAGE_KEY);
      if (stored === "true") setFuzzySearch(true);
      else if (stored === "false") setFuzzySearch(false);
    } catch {
      // ignore
    }
  }, []);

  const handleFuzzySearchChange = (enabled: boolean) => {
    setFuzzySearch(enabled);
    try {
      localStorage.setItem(
        FUZZY_SEARCH_STORAGE_KEY,
        enabled ? "true" : "false"
      );
    } catch {
      // ignore
    }
  };

  // Initialize Fuse instance when data is available
  const fuse = useMemo(() => {
    if (!allEpisodes) return null;
    return new Fuse(allEpisodes, {
      keys: [
        "title",
        "assignments.movie.title",
        "extras.review.movie.title",
        "extras.review.show.title",
      ],
      threshold: 0.4,
      ignoreLocation: true,
      includeMatches: true,
    });
  }, [allEpisodes]);

  // Compute filtered episodes based on local query
  const filteredRows = useMemo((): HistorySearchRow[] => {
    if (!allEpisodes) return [];
    const trimmed = query.trim();
    if (!trimmed) return [];

    if (fuzzySearch) {
      if (!fuse) return [];
      return fuse.search(trimmed).map((result) => ({
        episode: result.item,
        fuseMatches: result.matches,
      }));
    }

    const needle = trimmed.toLowerCase();
    return allEpisodes
      .filter((ep) => episodeMatchesSubstring(ep, needle))
      .map((episode) => ({ episode }));
  }, [allEpisodes, query, fuse, fuzzySearch]);

  // Debounced URL updater to prevent browser history spam
  const debouncedUpdateUrl = useMemo(
    () =>
      debounce((newQuery: string, currentParamsString: string) => {
        const params = new URLSearchParams(currentParamsString);
        if (newQuery) {
          params.set("q", newQuery);
        } else {
          params.delete("q");
        }
        router.push(`/history?${params.toString()}`, { scroll: false });
      }, 500),
    [router]
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      debouncedUpdateUrl.cancel();
    };
  }, [debouncedUpdateUrl]);

  const handleSearch = (newQuery: string) => {
    setQuery(newQuery);
    // Pass the current params string to preserve other potential params
    debouncedUpdateUrl(newQuery, searchParams.toString());
  };

  const trimmedQuery = query.trim();

  return (
    <div className="bbpc-page flex max-w-5xl flex-col items-center gap-8">
      <div className="flex w-full max-w-4xl flex-col items-start justify-between gap-3 sm:flex-row sm:items-end sm:gap-4">
        <div>
          <p className="bbpc-kicker">Archive</p>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
            Search episodes
          </h1>
        </div>
        <Link
          href="/episodes"
          className="whitespace-nowrap font-semibold text-red-300 hover:text-red-200"
        >
          Browse all episodes
        </Link>
      </div>
      <div className="w-full max-w-4xl">
        <label className="mb-3 flex cursor-pointer items-start gap-3 text-sm text-zinc-200">
          <input
            type="checkbox"
            checked={fuzzySearch}
            onChange={(e) => handleFuzzySearchChange(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
          />
          <span>
            <span className="block font-semibold">Match close spellings</span>
            <span className="block text-xs text-zinc-400">
              Useful for names and movie titles you only half remember.
            </span>
          </span>
        </label>
        <div className="mb-6 space-y-2">
          <SearchFilter onSearch={handleSearch} initialValue={query} />
          <p className="text-sm text-zinc-400" aria-live="polite">
            {trimmedQuery
              ? isLoading
                ? "Searching..."
                : `${filteredRows.length} ${
                    filteredRows.length === 1 ? "result" : "results"
                  }`
              : "Search by episode title or movie name."}
          </p>
        </div>
      </div>
      <div className="w-full max-w-4xl">
        <SearchResults
          rows={filteredRows}
          query={trimmedQuery}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}
