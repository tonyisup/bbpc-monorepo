"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MAX_VIDEO_SEARCH_LENGTH,
  normalizeVideoQuery,
  youtubeSearchResponseSchema,
  type YouTubeSearchVideo,
} from "@/lib/youtubeSearch";

type SearchState = {
  query: string;
  videos: YouTubeSearchVideo[];
  nextPageToken: string | null;
  loading: boolean;
  error: string | null;
};

export function YouTubeVideoSearch({
  suggestedQuery = "",
  selectedVideoId,
  onSelect,
}: {
  suggestedQuery?: string;
  selectedVideoId?: string;
  onSelect: (url: string) => void;
}) {
  const [input, setInput] = useState<string | null>(null);
  const query = input ?? suggestedQuery.slice(0, MAX_VIDEO_SEARCH_LENGTH);
  const normalized = normalizeVideoQuery(query);
  const [resultsOpen, setResultsOpen] = useState(true);
  const [selectionNotice, setSelectionNotice] = useState("");
  const selectionRef = useRef<HTMLParagraphElement>(null);
  const [state, setState] = useState<SearchState | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const visible = state?.query === normalized ? state : null;
  const valid =
    normalized.length >= 2 && normalized.length <= MAX_VIDEO_SEARCH_LENGTH;

  useEffect(() => {
    if (selectionNotice) selectionRef.current?.focus();
  }, [selectionNotice]);

  useEffect(() => {
    generation.current += 1;
    request.current?.abort();
    setState(null);
    setSelectionNotice("");
    return () => {
      generation.current += 1;
      request.current?.abort();
    };
  }, [normalized]);

  async function search(more = false) {
    if (!valid || visible?.loading) return;
    setResultsOpen(true);
    setSelectionNotice("");
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const current = ++generation.current;
    const prior = more ? visible?.videos ?? [] : [];
    const pageToken = more ? visible?.nextPageToken ?? null : null;
    setState({
      query: normalized,
      videos: prior,
      nextPageToken: pageToken,
      loading: true,
      error: null,
    });
    try {
      const params = new URLSearchParams({ q: normalized });
      if (pageToken) params.set("pageToken", pageToken);
      const response = await fetch(`/api/youtube/search?${params}`, {
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? "Sign in to search for videos."
            : "Video search is unavailable right now. Try again or paste a clip link below."
        );
      const result = youtubeSearchResponseSchema.parse(await response.json());
      if (controller.signal.aborted || generation.current !== current) return;
      const unique = new Map(
        [...prior, ...result.videos].map((video) => [video.id, video])
      );
      setState({
        query: normalized,
        videos: [...unique.values()].slice(0, 24),
        nextPageToken: result.nextPageToken,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (controller.signal.aborted || generation.current !== current) return;
      setState({
        query: normalized,
        videos: prior,
        nextPageToken: pageToken,
        loading: false,
        error:
          error instanceof Error &&
          error.message === "Sign in to search for videos."
            ? error.message
            : "Video search is unavailable right now. Try again or paste a clip link below.",
      });
    }
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
      <div className="flex gap-2">
        <Input
          aria-label="Search YouTube videos"
          type="search"
          maxLength={MAX_VIDEO_SEARCH_LENGTH}
          value={query}
          placeholder="Movie, scene, or a line you remember…"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              void search();
            }
          }}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={!valid || visible?.loading}
          onClick={() => void search()}
        >
          Search
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Choose a video to load it into the quote player below.
      </p>
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
      {selectionNotice && (
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
          onClick={() => setResultsOpen(true)}
        >
          Show search results
        </Button>
      )}
      {!!visible?.videos.length && resultsOpen && (
        <>
          <p role="status" className="sr-only">
            {visible.videos.length} videos found.
          </p>
          <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-background">
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
                    href={`https://www.youtube.com/watch?v=${video.id}`}
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
                    onSelect(`https://www.youtube.com/watch?v=${video.id}`);
                    setResultsOpen(false);
                    setSelectionNotice(
                      `Loaded “${video.title}” into the quote player.`
                    );
                  }}
                >
                  {selectedVideoId === video.id ? "Selected" : "Use video"}
                </Button>
              </li>
            ))}
          </ul>
          {visible.nextPageToken && visible.videos.length < 24 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={visible.loading}
              onClick={() => void search(true)}
            >
              More results
            </Button>
          )}
          {visible.nextPageToken && visible.videos.length >= 24 && (
            <p className="text-xs text-muted-foreground">
              Try a more specific search to narrow these results.
            </p>
          )}
        </>
      )}
    </section>
  );
}
