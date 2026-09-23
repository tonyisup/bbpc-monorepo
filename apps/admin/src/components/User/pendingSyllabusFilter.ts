import type { ConvexUserSyllabusEntry } from "@/convex/userDetails";

export interface PendingSyllabusMatch {
  entry: ConvexUserSyllabusEntry;
  queueIndex: number;
}

/**
 * Filters the pending queue by movie title, release year, or notes while
 * keeping each entry's position in the full queue so reorder controls and the
 * "up next" highlight still refer to the real order.
 */
export function filterPendingSyllabus(
  pending: ConvexUserSyllabusEntry[],
  query: string
): PendingSyllabusMatch[] {
  const matches = pending.map((entry, queueIndex) => ({ entry, queueIndex }));
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return matches;
  return matches.filter(({ entry }) => {
    const haystack = [
      entry.movie.title,
      String(entry.movie.year),
      entry.notes ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
