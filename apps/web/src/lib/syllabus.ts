export const syllabusInsertPositions = ["TOP", "AFTER_NEXT", "END"] as const;

export type SyllabusInsertPosition = (typeof syllabusInsertPositions)[number];

export const syllabusInsertPositionLabels: Record<SyllabusInsertPosition, string> = {
  TOP: "Add to top",
  AFTER_NEXT: "After next",
  END: "Add to end",
};

interface SyllabusOrderLike {
  id: string;
  order: number;
  assignmentId: string | null;
}

export function normalizeSyllabusOrder<T extends SyllabusOrderLike>(items: readonly T[]): T[] {
  const pending = items
    .filter((item) => item.assignmentId === null)
    .sort((left, right) => right.order - left.order);
  const assigned = items
    .filter((item) => item.assignmentId !== null)
    .sort((left, right) => right.order - left.order);

  return [...pending, ...assigned];
}

export function getPendingInsertionIndex(pendingLength: number, position: SyllabusInsertPosition): number {
  if (position === "TOP") {
    return 0;
  }

  if (position === "AFTER_NEXT") {
    return Math.min(1, pendingLength);
  }

  return pendingLength;
}

export function insertIntoCanonicalSyllabus<T extends SyllabusOrderLike>(
  items: readonly T[],
  newItem: T,
  position: SyllabusInsertPosition,
): T[] {
  const normalized = normalizeSyllabusOrder(items);
  const pending = normalized.filter((item) => item.assignmentId === null);
  const assigned = normalized.filter((item) => item.assignmentId !== null);
  const insertionIndex = getPendingInsertionIndex(pending.length, position);

  pending.splice(insertionIndex, 0, newItem);

  return [...pending, ...assigned];
}

export function buildDenseDescendingOrder<T extends { id: string }>(items: readonly T[]) {
  return items.map((item, index) => ({
    id: item.id,
    order: items.length - index,
  }));
}
