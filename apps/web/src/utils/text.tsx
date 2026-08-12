import React, { type ReactElement } from "react";
import type { FuseResultMatch } from "fuse.js";

/** Escape a string for safe use as a literal segment inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function mergeInclusiveRanges(
  ranges: readonly (readonly [number, number])[]
): [number, number][] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges]
    .map((range) => [range[0], range[1]] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const first = sorted[0];
  if (!first) return [];

  const out: [number, number][] = [[first[0], first[1]]];
  for (const [start, end] of sorted.slice(1)) {
    const last = out[out.length - 1];
    if (!last) {
      out.push([start, end]);
      continue;
    }
    if (start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      out.push([start, end]);
    }
  }
  return out;
}

/** Character ranges from Fuse `includeMatches` (inclusive start and end). */
export function highlightTextByIndices(
  text: string | undefined,
  indices: ReadonlyArray<readonly [number, number]>
): ReactElement {
  if (!text) return <></>;
  if (indices.length === 0) return <>{text}</>;

  const merged = mergeInclusiveRanges(indices);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  merged.forEach(([start, end], i) => {
    if (start > cursor) {
      parts.push(text.slice(cursor, start));
    }
    parts.push(
      <mark key={`m-${i}-${start}-${end}`} className="bg-yellow-200">
        {text.slice(start, end + 1)}
      </mark>
    );
    cursor = end + 1;
  });
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return <>{parts}</>;
}

export function fuseIndicesForField(
  fuseMatches: ReadonlyArray<FuseResultMatch> | undefined,
  key: string,
  refIndex?: number
): [number, number][] {
  if (!fuseMatches?.length) return [];
  const ranges: [number, number][] = [];
  for (const m of fuseMatches) {
    if (m.key !== key) continue;
    if (refIndex === undefined) {
      if (m.refIndex !== undefined) continue;
    } else if (m.refIndex !== refIndex) continue;
    for (const pair of m.indices) {
      ranges.push([pair[0], pair[1]]);
    }
  }
  return ranges;
}

export function highlightText(
  text: string | undefined,
  query: string
): ReactElement {
  if (!text) return <></>;
  if (!query) return <>{text}</>;

  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, "gi"));

  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-yellow-200">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}

export function highlightWithFuseOrQuery(
  text: string | undefined,
  query: string,
  fuseMatches: ReadonlyArray<FuseResultMatch> | undefined,
  fuseKey: string,
  fuseRefIndex?: number
): ReactElement {
  const idx = fuseIndicesForField(fuseMatches, fuseKey, fuseRefIndex);
  if (idx.length > 0) {
    return highlightTextByIndices(text, idx);
  }
  return highlightText(text, query);
}
