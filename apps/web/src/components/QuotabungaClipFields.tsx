"use client";

import { useId, useState } from "react";
import { QuoteClipEditor } from "@/components/QuoteClipEditor";
import { YouTubeVideoSearch } from "@/components/YouTubeVideoSearch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseYouTubeUrl } from "@/lib/quoteClip";

type Props = {
  clipUrl: string;
  start: string;
  end: string;
  suggestedQuery: string;
  onClipUrlChange: (url: string) => void;
  onStartChange: (start: string) => void;
  onEndChange: (end: string) => void;
  onQuoteChange: (quote: string) => void;
  onDurationChange?: (duration: number) => void;
};

/** Keep manual entry familiar; only mount the YouTube tools when requested. */
export function QuotabungaClipFields({
  clipUrl,
  start,
  end,
  suggestedQuery,
  onClipUrlChange,
  onStartChange,
  onEndChange,
  onQuoteChange,
  onDurationChange,
}: Props) {
  const [finderOpen, setFinderOpen] = useState(false);
  const finderId = useId();
  const youtube = parseYouTubeUrl(clipUrl);

  const clipField = (
    <div className="min-w-0 space-y-2">
      <label htmlFor="convex-quotabunga-clip" className="text-sm font-semibold">
        {finderOpen ? "Or paste a clip link" : "Clip link"}{" "}
        <span className="font-normal text-gray-500">(optional)</span>
      </label>
      <Input
        id="convex-quotabunga-clip"
        type="url"
        maxLength={2000}
        value={clipUrl}
        onChange={(event) => onClipUrlChange(event.target.value)}
        placeholder="https://youtube.com/..."
      />
    </div>
  );
  const startField = (
    <div className="space-y-2">
      <label
        htmlFor="convex-quotabunga-timestamp"
        className="text-sm font-semibold"
      >
        Start second
      </label>
      <Input
        id="convex-quotabunga-timestamp"
        type="number"
        min={0}
        max={86400}
        step="any"
        value={start}
        onChange={(event) => onStartChange(event.target.value)}
        placeholder="42"
      />
    </div>
  );
  const endField = (
    <div className="space-y-2">
      <label htmlFor="convex-quotabunga-end" className="text-sm font-semibold">
        End second{" "}
        <span className="font-normal text-gray-500">(optional)</span>
      </label>
      <Input
        id="convex-quotabunga-end"
        type="number"
        min={0}
        max={86400}
        step="any"
        value={end}
        onChange={(event) => onEndChange(event.target.value)}
        placeholder="52.5"
      />
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <p className="text-xs text-muted-foreground">
          {finderOpen
            ? "Your quote and clip times stay in the form."
            : "Need help finding the moment?"}
        </p>
        <Button
          type="button"
          variant="link"
          className="px-0"
          aria-expanded={finderOpen}
          aria-controls={finderId}
          onClick={() => setFinderOpen((open) => !open)}
        >
          {finderOpen ? "Back to simple form" : "Use Quote Finder"}
        </Button>
      </div>
      <div id={finderId}>
        {finderOpen ? (
          <section aria-label="Quote Finder" className="space-y-4">
            <YouTubeVideoSearch
              suggestedQuery={suggestedQuery}
              selectedVideoId={youtube?.id}
              onSelect={onClipUrlChange}
            />
            {clipField}
            {youtube && (
              <QuoteClipEditor
                key={youtube.id}
                videoId={youtube.id}
                initialStart={youtube.start}
                start={start.trim() ? Number(start) : null}
                end={end.trim() ? Number(end) : null}
                onRangeChange={(from, to) => {
                  onStartChange(String(from));
                  onEndChange(String(to));
                }}
                onQuoteChange={onQuoteChange}
                onDurationChange={onDurationChange}
              />
            )}
            <div className="grid grid-cols-2 gap-4">
              {startField}
              {endField}
            </div>
          </section>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
              {clipField}
              {startField}
            </div>
            {end.trim() !== "" && endField}
          </div>
        )}
      </div>
    </div>
  );
}
