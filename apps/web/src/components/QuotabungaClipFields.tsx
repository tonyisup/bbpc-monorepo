"use client";

import { useState } from "react";
import { FullScreenDialog } from "@/components/FullScreenDialog";
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

/** Keep manual entry familiar; open the YouTube tools full screen on request. */
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
  const youtube = parseYouTubeUrl(clipUrl);

  // The form stays mounted under the dialog, so each copy needs its own ids.
  const clipField = (idPrefix: string, label: string) => (
    <div className="min-w-0 space-y-2">
      <label htmlFor={`${idPrefix}-clip`} className="text-sm font-semibold">
        {label} <span className="font-normal text-gray-500">(optional)</span>
      </label>
      <Input
        id={`${idPrefix}-clip`}
        type="url"
        maxLength={2000}
        value={clipUrl}
        onChange={(event) => onClipUrlChange(event.target.value)}
        placeholder="https://youtube.com/..."
      />
    </div>
  );
  const startField = (idPrefix: string) => (
    <div className="space-y-2">
      <label
        htmlFor={`${idPrefix}-timestamp`}
        className="text-sm font-semibold"
      >
        Start second
      </label>
      <Input
        id={`${idPrefix}-timestamp`}
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
  const endField = (idPrefix: string, markOptional = true) => (
    <div className="space-y-2">
      <label htmlFor={`${idPrefix}-end`} className="text-sm font-semibold">
        End second{" "}
        {markOptional && (
          <span className="font-normal text-gray-500">(optional)</span>
        )}
      </label>
      <Input
        id={`${idPrefix}-end`}
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
          Need help finding the moment?
        </p>
        <Button
          type="button"
          variant="link"
          className="px-0"
          aria-haspopup="dialog"
          onClick={() => setFinderOpen(true)}
        >
          Use Quote Finder
        </Button>
      </div>
      {end.trim() === "" ? (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
          {clipField("convex-quotabunga", "Clip link")}
          {startField("convex-quotabunga")}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-[minmax(0,1fr)_8rem_8rem]">
          <div className="col-span-2 min-w-0 sm:col-span-1">
            {clipField("convex-quotabunga", "Clip link")}
          </div>
          {startField("convex-quotabunga")}
          {endField("convex-quotabunga", false)}
        </div>
      )}

      <FullScreenDialog
        open={finderOpen}
        onOpenChange={setFinderOpen}
        title="Quote Finder"
        description="Your quote and clip times stay in the form."
      >
        <section aria-label="Quote Finder" className="space-y-4">
          <YouTubeVideoSearch
            suggestedQuery={suggestedQuery}
            selectedVideoId={youtube?.id}
            onSelect={onClipUrlChange}
          />
          {clipField("quote-finder", "Or paste a clip link")}
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
            {startField("quote-finder")}
            {endField("quote-finder")}
          </div>
        </section>
      </FullScreenDialog>
    </div>
  );
}
