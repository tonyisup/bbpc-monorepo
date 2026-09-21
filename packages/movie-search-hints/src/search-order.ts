/** Promote exact titles without disturbing provider relevance or source tie order. */
export function prioritizeExactMovieMatches<T>(
  results: readonly T[],
  query: string,
  titleOf: (result: T) => string
): T[] {
  const title = query
    .trim()
    .normalize("NFKC")
    .replace(/(?:^|\s)y:\d{4}(?=\s|$)/giu, " ")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
  const exact: T[] = [];
  const other: T[] = [];
  for (const result of results) {
    const normalizedTitle = titleOf(result)
      .trim()
      .normalize("NFKC")
      .toLowerCase();
    (title.length > 0 && normalizedTitle === title ? exact : other).push(
      result
    );
  }
  return [...exact, ...other];
}
