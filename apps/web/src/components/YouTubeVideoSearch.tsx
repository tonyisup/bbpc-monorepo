"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { YouTubeSearch } from "@/hooks/useYouTubeSearch";
import {
  MAX_VIDEO_RESULTS,
  MAX_VIDEO_SEARCH_LENGTH,
} from "@/lib/youtubeSearch";
import { youtubeWatchUrl } from "@/lib/quoteClip";
import { cn } from "@/lib/utils";

export function YouTubeVideoSearch({
  search,
  selectedVideoId,
  onSelect,
  action,
  children,
}: {
  search: YouTubeSearch;
  selectedVideoId?: string;
  onSelect: (url: string) => void;
  /** Another button for the search row, after Search. */
  action?: ReactNode;
  /** Shown under the search row, above the results. */
  children?: ReactNode;
}) {
  const {
    query,
    valid,
    results: visible,
    resultsOpen,
    setResultsOpen,
  } = search;
  const [selectionNotice, setSelectionNotice] = useState("");
  // The notice names one video; it's stale once another one is loaded.
  const [noticeVideoId, setNoticeVideoId] = useState<string | null>(null);
  // Counts picks, so picking the same video again still moves focus.
  const [picks, setPicks] = useState(0);
  const selectionRef = useRef<HTMLParagraphElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const focusList = useRef(false);

  useEffect(() => {
    if (picks > 0) selectionRef.current?.focus();
  }, [picks]);

  // "Show search results" disappears when pressed; the list takes focus.
  useEffect(() => {
    if (!resultsOpen || !focusList.current) return;
    focusList.current = false;
    listRef.current?.focus();
  }, [resultsOpen]);

  useEffect(() => {
    setSelectionNotice("");
  }, [search.normalized]);

  function runSearch(more = false) {
    setSelectionNotice("");
    void search.search(more);
  }

  return (
    <section
      aria-label="Find a YouTube video"
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Find a video</h3>
        <a
          href="https://www.youtube.com/"
          target="_blank"
          rel="noreferrer noopener"
          className="text-xs text-muted-foreground underline"
        >
          YouTube
        </a>
      </div>
      {/* With a second button, a phone gives the search box its own row. */}
      <div
        className={cn(
          "flex gap-2",
          action != null && "max-sm:grid max-sm:grid-cols-2"
        )}
      >
        <Input
          className="min-w-0 max-sm:col-span-2"
          aria-label="Search YouTube videos"
          type="search"
          maxLength={MAX_VIDEO_SEARCH_LENGTH}
          value={query}
          placeholder="Movie, scene, or a line you remember…"
          onChange={(event) => search.setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              runSearch();
            }
          }}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={!valid || visible?.loading}
          onClick={() => runSearch()}
        >
          Search
        </Button>
        {action}
      </div>
      {children}
      {visible?.loading && (
        <p role="status" className="text-sm text-muted-foreground">
          Searching YouTube…
        </p>
      )}
      {visible?.error && (
        <p role="alert" className="text-sm text-amber-200">
          {visible.error}
        </p>
      )}
      {visible &&
        !visible.loading &&
        !visible.error &&
        visible.videos.length === 0 && (
          <p role="status" className="text-sm text-muted-foreground">
            No videos found. Try the movie title or a shorter part of the quote.
          </p>
        )}
      {selectionNotice && noticeVideoId === selectedVideoId && (
        <p
          ref={selectionRef}
          role="status"
          tabIndex={-1}
          className="rounded text-sm text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {selectionNotice}
        </p>
      )}
      {!!visible?.videos.length && !resultsOpen && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            focusList.current = true;
            setResultsOpen(true);
          }}
        >
          Show search results
        </Button>
      )}
      {!!visible?.videos.length && resultsOpen && (
        <>
          <p role="status" className="sr-only">
            {visible.videos.length} videos found.
          </p>
          <p className="text-xs text-muted-foreground">
            Choose a video to load it into the quote player below.
          </p>
          <ul
            ref={listRef}
            tabIndex={-1}
            aria-label="Search results"
            className="divide-y divide-border overflow-hidden rounded-md border border-border bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {visible.videos.map((video) => (
              <li
                key={video.id}
                className="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 p-2 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-center"
              >
                <Image
                  src={`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`}
                  width={320}
                  height={180}
                  alt=""
                  unoptimized
                  className="row-span-2 aspect-video w-full rounded object-cover sm:row-span-1"
                />
                <div className="min-w-0 space-y-1">
                  <a
                    href={youtubeWatchUrl(video.id)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="line-clamp-2 text-sm font-medium hover:underline"
                  >
                    {video.title}
                  </a>
                  <p className="truncate text-xs text-muted-foreground">
                    {video.channel}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={
                    selectedVideoId === video.id ? "secondary" : "outline"
                  }
                  className="justify-self-start"
                  aria-label={`Use video: ${video.title}`}
                  aria-pressed={selectedVideoId === video.id}
                  onClick={() => {
                    onSelect(youtubeWatchUrl(video.id));
                    setResultsOpen(false);
                    setNoticeVideoId(video.id);
                    setPicks((count) => count + 1);
                    setSelectionNotice(
                      `Loaded into the quote player: ${video.title}`
                    );
                  }}
                >
                  {selectedVideoId === video.id ? "Selected" : "Use video"}
                </Button>
              </li>
            ))}
          </ul>
          {visible.nextPageToken &&
            visible.videos.length < MAX_VIDEO_RESULTS && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={visible.loading}
                onClick={() => runSearch(true)}
              >
                More results
              </Button>
            )}
          {visible.nextPageToken &&
            visible.videos.length >= MAX_VIDEO_RESULTS && (
              <p className="text-xs text-muted-foreground">
                Try a more specific search to narrow these results.
              </p>
            )}
        </>
      )}
    </section>
  );
}
