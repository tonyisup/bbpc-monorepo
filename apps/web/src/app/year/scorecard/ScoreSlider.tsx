"use client";

import { useRef, useState } from "react";

import {
  SCORECARD_MAX_SCORE,
  SCORECARD_MIN_SCORE,
  scoreFromTrackPosition,
} from "@/lib/scorecard";

const TICKS = Array.from(
  { length: SCORECARD_MAX_SCORE - SCORECARD_MIN_SCORE + 1 },
  (_, index) => SCORECARD_MIN_SCORE + index
);

function percent(value: number) {
  return (
    ((value - SCORECARD_MIN_SCORE) /
      (SCORECARD_MAX_SCORE - SCORECARD_MIN_SCORE)) *
    100
  );
}

/**
 * A 1-10 slider with no handle until it has a value. Dragging previews the
 * value; it is committed (saved) on release or on a keyboard change.
 */
export function ScoreSlider({
  label,
  value,
  disabled = false,
  onCommit,
  onPreview,
}: {
  label: string;
  value: number | undefined;
  disabled?: boolean;
  onCommit: (value: number) => void;
  /** Called with the value under the pointer while dragging, then null. */
  onPreview?: (value: number | null) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [preview, setPreviewState] = useState<number | null>(null);
  const shown = preview ?? value;

  const setPreview = (next: number | null) => {
    setPreviewState(next);
    onPreview?.(next);
  };

  const valueAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    return rect
      ? scoreFromTrackPosition(clientX - rect.left, rect.width)
      : SCORECARD_MIN_SCORE;
  };

  const commit = (next: number) => {
    setPreview(null);
    if (next !== value) onCommit(next);
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={SCORECARD_MIN_SCORE}
      aria-valuemax={SCORECARD_MAX_SCORE}
      aria-valuenow={shown}
      aria-valuetext={shown === undefined ? "Not scored" : String(shown)}
      aria-disabled={disabled}
      className="relative h-11 w-full cursor-pointer touch-none select-none outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-amber-400 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      onPointerDown={(event) => {
        if (disabled) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setPreview(valueAt(event.clientX));
      }}
      onPointerMove={(event) => {
        if (preview === null) return;
        setPreview(valueAt(event.clientX));
      }}
      onPointerUp={(event) => {
        if (preview === null) return;
        commit(valueAt(event.clientX));
      }}
      onPointerCancel={() => setPreview(null)}
      onKeyDown={(event) => {
        if (disabled) return;
        const current = value ?? null;
        let next: number | null = null;
        if (event.key === "ArrowRight" || event.key === "ArrowUp") {
          next =
            current === null ? 5 : Math.min(SCORECARD_MAX_SCORE, current + 1);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
          next =
            current === null ? 5 : Math.max(SCORECARD_MIN_SCORE, current - 1);
        } else if (event.key === "Home") {
          next = SCORECARD_MIN_SCORE;
        } else if (event.key === "End") {
          next = SCORECARD_MAX_SCORE;
        } else if (/^[1-9]$/u.test(event.key)) {
          next = Number(event.key);
        } else if (event.key === "0") {
          next = 10;
        }
        if (next !== null) {
          event.preventDefault();
          commit(next);
        }
      }}
    >
      <div
        className={`absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full ${
          shown === undefined
            ? "border border-dashed border-zinc-600"
            : "bg-zinc-800"
        }`}
      >
        {shown !== undefined && (
          <div
            className="h-full rounded-full bg-amber-400"
            style={{ width: `${String(percent(shown))}%` }}
          />
        )}
      </div>
      {TICKS.map((tick) => (
        <span
          key={tick}
          aria-hidden
          className="absolute top-[calc(50%+7px)] h-1.5 w-px bg-zinc-600"
          style={{ left: `${String(percent(tick))}%` }}
        />
      ))}
      {shown !== undefined && (
        <span
          aria-hidden
          className={`absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-zinc-950 bg-amber-400 shadow ${
            preview !== null ? "scale-125" : ""
          }`}
          style={{ left: `${String(percent(shown))}%` }}
        />
      )}
    </div>
  );
}
