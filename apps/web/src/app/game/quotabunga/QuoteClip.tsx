"use client";

import { PlayIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import {
  clipDurationLabel,
  clipEmbedUrl,
  sourceLabel,
} from "@/lib/quotabungaArchive";
import { cn } from "@/lib/utils";
import type { QuotabungaEntry } from "@/types/quotabunga";

/** Plays an entry's clip in place, or says the listener sent none. */
export function ClipButton({
  entry,
  playing,
  onToggle,
}: {
  entry: QuotabungaEntry;
  playing: boolean;
  onToggle: () => void;
}) {
  if (clipEmbedUrl(entry) === null) {
    return <span className="text-[13px] text-zinc-400">No clip</span>;
  }
  const Icon = playing ? SquareIcon : PlayIcon;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-white/[0.12] bg-white/[0.06] pl-3 pr-3.5 text-[13px] font-semibold text-zinc-200 transition-colors hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 md:h-9"
    >
      <Icon aria-hidden="true" className="size-3 fill-current" />
      {playing ? "Stop" : clipDurationLabel(entry) ?? "Play clip"}
      <span className="sr-only">
        {playing ? " the clip" : " clip"} from {sourceLabel(entry)}
      </span>
    </button>
  );
}

/**
 * The playing clip. A closed <details> hides its contents but would leave
 * the video running, so closing any section around the player stops it.
 */
export function ClipPlayer({
  entry,
  onStop,
  className,
}: {
  entry: QuotabungaEntry;
  onStop: () => void;
  className?: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sections: HTMLDetailsElement[] = [];
    for (
      let section = frame.current?.parentElement?.closest("details");
      section;
      section = section.parentElement?.closest("details")
    ) {
      sections.push(section);
    }
    const stopWhenClosed = (event: Event) => {
      if (!(event.currentTarget as HTMLDetailsElement).open) {
        onStop();
      }
    };
    for (const section of sections) {
      section.addEventListener("toggle", stopWhenClosed);
    }
    return () => {
      for (const section of sections) {
        section.removeEventListener("toggle", stopWhenClosed);
      }
    };
  }, [onStop]);

  const src = clipEmbedUrl(entry);
  if (src === null) {
    return null;
  }
  return (
    <div
      ref={frame}
      className={cn(
        "aspect-video w-full max-w-xl overflow-hidden rounded-lg border border-white/[0.12] bg-black",
        className
      )}
    >
      <iframe
        src={src}
        title={`Clip from ${sourceLabel(entry)}`}
        allow="autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        className="h-full w-full"
      />
    </div>
  );
}
