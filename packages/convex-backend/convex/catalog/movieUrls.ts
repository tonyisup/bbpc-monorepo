/** Parse provider URLs without following redirects or trusting lookalike hosts. */
function providerUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.port
      ? url
      : null;
  } catch {
    return null;
  }
}

export function imdbUrlForId(id: unknown): string | null {
  return typeof id === "string" && /^tt\d{7,}$/.test(id)
    ? `https://www.imdb.com/title/${id}/`
    : null;
}

export function canonicalImdbUrl(value: string): string | null {
  const url = providerUrl(value);
  if (
    !url ||
    !["imdb.com", "www.imdb.com", "m.imdb.com"].includes(url.hostname)
  ) {
    return null;
  }
  const id = /^\/title\/(tt\d{7,})(?:\/|$)/.exec(url.pathname)?.[1];
  return imdbUrlForId(id);
}

export function tmdbIdFromMovieUrl(value: string): number | undefined {
  const url = providerUrl(value);
  if (
    !url ||
    !["themoviedb.org", "www.themoviedb.org"].includes(url.hostname)
  ) {
    return undefined;
  }
  const match = /^\/movie\/([1-9]\d*)(?:-[^/]*)?\/?$/.exec(url.pathname);
  const id = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(id) && id <= 2_147_483_647 ? id : undefined;
}

export function movieUrlAliases(url: string, tmdbId?: number): string[] {
  const aliases = new Set([url]);
  const imdb = canonicalImdbUrl(url);
  const canonicalUrls = [
    imdb,
    tmdbId === undefined
      ? null
      : `https://www.themoviedb.org/movie/${String(tmdbId)}/`,
  ];
  for (const canonical of canonicalUrls) {
    if (canonical === null) continue;
    for (const protocol of ["https:", "http:"]) {
      for (const prefix of canonical === imdb ? ["www.", "", "m."] : ["www.", ""]) {
        const variant = canonical
          .replace("https:", protocol)
          .replace("www.", prefix);
        aliases.add(variant);
        aliases.add(variant.slice(0, -1));
      }
    }
  }
  return [...aliases];
}
