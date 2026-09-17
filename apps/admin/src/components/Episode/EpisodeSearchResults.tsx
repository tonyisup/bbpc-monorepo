import {
  formatTranscriptTime,
  mergeEpisodeSearchResults,
  useEpisodeMetadataSearch,
  useTranscriptSearch,
  type EpisodeSearchRow,
} from "@bbpc/episode-search";
import { useConvex } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";

import {
  type ConvexAdminEpisode,
  loadConvexAdminEpisodeSearchCatalog,
  searchConvexAdminEpisodeTranscripts,
} from "@/convex/episodes";
import { formatPlainDate } from "@/lib/dates";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { EpisodeId } from "./EpisodeId";

/** Preserve Fuse's matched character ranges, including close spellings. */
function HighlightTitle({
  text,
  query,
  row,
  field,
}: {
  text: string;
  query: string;
  row: EpisodeSearchRow<ConvexAdminEpisode>;
  field: string;
}) {
  const ranges =
    row.fuseMatches
      ?.filter((match) => match.key === field && match.value === text)
      .flatMap((match) => [...match.indices]) ?? [];
  if (ranges.length === 0) {
    const needle = query.trim().toLowerCase();
    if (needle) {
      let start = text.toLowerCase().indexOf(needle);
      while (start !== -1) {
        ranges.push([start, start + needle.length - 1]);
        start = text.toLowerCase().indexOf(needle, start + needle.length);
      }
    }
  }
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
    if (end < cursor) continue;
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark className="bg-yellow-200 text-black" key={`${start}-${end}`}>
        {text.slice(Math.max(start, cursor), end + 1)}
      </mark>
    );
    cursor = end + 1;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}

function HighlightPassage({ text, query }: { text: string; query: string }) {
  const terms: string[] = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const prefix = terms.at(-1);
  return (
    <>
      {text.split(/([\p{L}\p{N}]+)/gu).map((part, index) => {
        const word = part.toLowerCase();
        return terms.includes(word) || (prefix && word.startsWith(prefix)) ? (
          <mark className="bg-yellow-200 text-black" key={index}>
            {part}
          </mark>
        ) : (
          part
        );
      })}
    </>
  );
}

export function EpisodeSearchResults({
  query,
  fuzzy,
  dateFrom,
  dateTo,
}: {
  query: string;
  fuzzy: boolean;
  dateFrom?: string;
  dateTo?: string;
}) {
  const convex = useConvex();
  const [catalog, setCatalog] = useState<ConvexAdminEpisode[]>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    void loadConvexAdminEpisodeSearchCatalog(convex, controller.signal, {
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
    })
      .then((episodes) => {
        if (!controller.signal.aborted) setCatalog(episodes);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [convex, attempt, dateFrom, dateTo]);

  const searchTranscripts = useCallback(
    (text: string) =>
      searchConvexAdminEpisodeTranscripts(convex, text, {
        ...(dateFrom ? { dateFrom } : {}),
        ...(dateTo ? { dateTo } : {}),
      }),
    [convex, dateFrom, dateTo]
  );
  const transcripts = useTranscriptSearch(query, searchTranscripts);
  const metadata = useEpisodeMetadataSearch(catalog, query, fuzzy);
  const rows = useMemo(() => {
    // Exact numbers and canonical IDs are useful additional admin lookup keys.
    const direct =
      catalog?.filter(
        (episode) =>
          episode.id === query.trim() || String(episode.number) === query.trim()
      ) ?? [];
    const directIds = new Set(direct.map((episode) => episode.id));
    return mergeEpisodeSearchResults(
      [
        ...direct.map((episode) => ({ episode })),
        ...metadata.filter((row) => !directIds.has(row.episode.id)),
      ],
      transcripts.data
    );
  }, [catalog, metadata, query, transcripts.data]);
  const loading = (!catalog && !failed) || transcripts.loading;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {rows.length} {rows.length === 1 ? "result" : "results"}
        {!catalog && !failed ? " · Searching episode catalog…" : ""}
        {transcripts.loading ? " · Searching transcripts…" : ""}
      </p>
      {failed && (
        <div role="alert" className="text-sm text-destructive">
          Episode title and movie search is unavailable. Transcript results are
          still shown.
          <Button
            className="ml-2"
            variant="outline"
            size="sm"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry episode search
          </Button>
        </div>
      )}
      {transcripts.error && (
        <div role="alert" className="text-sm text-destructive">
          {transcripts.error}
          {transcripts.enabled && (
            <Button
              className="ml-2"
              variant="outline"
              size="sm"
              onClick={transcripts.retry}
            >
              Retry transcript search
            </Button>
          )}
        </div>
      )}
      {transcripts.data?.limited && (
        <p role="status" className="text-sm text-muted-foreground">
          Showing the top transcript matches. Narrow your search to find more
          specific passages.
        </p>
      )}
      {transcripts.data?.results.length === 0 && (
        <p className="text-xs text-muted-foreground">No transcript matches.</p>
      )}
      {rows.length === 0 && (
        <p className="rounded-md border bg-card p-8 text-center text-muted-foreground">
          {loading
            ? "Searching…"
            : failed || transcripts.error
            ? "Search is incomplete. Retry the unavailable search above."
            : dateFrom || dateTo
            ? "No episodes found matching your search in this date range."
            : "No episodes found matching your search."}
        </p>
      )}
      <ul className="space-y-4">
        {rows.map((row) => {
          const { episode, passages } = row;
          const media = [
            ...episode.assignments.map((assignment) => ({
              id: assignment.id,
              title: assignment.movie.title,
              field: "assignments.movie.title",
            })),
            ...episode.extras.flatMap((extra) =>
              extra.review.movie
                ? [
                    {
                      id: extra.id,
                      title: extra.review.movie.title,
                      field: "extras.review.movie.title",
                    },
                  ]
                : extra.review.show
                ? [
                    {
                      id: extra.id,
                      title: extra.review.show.title,
                      field: "extras.review.show.title",
                    },
                  ]
                : []
            ),
          ];
          return (
            <li
              className="min-w-0 rounded-md border bg-card p-4 sm:p-5"
              key={episode.id}
            >
              <article
                className="space-y-3"
                aria-label={`Episode ${episode.number}: ${episode.title}`}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Episode {episode.number}</span>
                  <Badge variant="outline">{episode.status ?? "unset"}</Badge>
                  {episode.date && <span>{formatPlainDate(episode.date)}</span>}
                </div>
                <h3 className="break-words text-lg font-semibold">
                  {episode.slug ? (
                    <Link
                      className="hover:text-primary"
                      href={`/episode/${episode.slug}`}
                    >
                      <HighlightTitle
                        text={episode.title}
                        query={query}
                        row={row}
                        field="title"
                      />
                    </Link>
                  ) : (
                    <HighlightTitle
                      text={episode.title}
                      query={query}
                      row={row}
                      field="title"
                    />
                  )}
                </h3>
                <EpisodeId id={episode.id} />
                {media.length > 0 && (
                  <ul
                    className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"
                    aria-label="Movies and shows"
                  >
                    {media.map((item) => (
                      <li key={`${item.field}-${item.id}`}>
                        <HighlightTitle
                          text={item.title}
                          query={query}
                          row={row}
                          field={item.field}
                        />
                      </li>
                    ))}
                  </ul>
                )}
                {passages && passages.length > 0 && (
                  <div className="space-y-3 border-l-2 pl-4">
                    <p className="text-xs font-semibold text-muted-foreground">
                      Transcript · Automatically generated
                    </p>
                    {passages.map((passage, index) => (
                      <div key={`${passage.start}-${index}`}>
                        <span
                          className="font-mono text-xs text-muted-foreground"
                          aria-label={`Timestamp ${formatTranscriptTime(
                            passage.start
                          )}`}
                        >
                          {formatTranscriptTime(passage.start)}
                        </span>
                        <p className="break-words text-sm leading-relaxed">
                          <HighlightPassage text={passage.text} query={query} />
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
