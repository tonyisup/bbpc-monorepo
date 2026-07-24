import { domainError } from "../lib/errors.js";
import { env } from "../_generated/server.js";

const TMDB_API_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p";
const IMDB_BASE_URL = "https://www.imdb.com/title";
const TMDB_TIMEOUT_MS = 8_000;
const MAX_TMDB_RESULTS = 20;
const MAX_TMDB_QUERY_LENGTH = 200;
const MAX_TMDB_PAGE = 500;
const MAX_SQL_INT = 2_147_483_647;

type TmdbKind = "movie" | "tv";
type JsonRecord = Record<string, unknown>;

export interface TmdbTitle {
  id: number;
  title: string;
  backdrop_path: string | null;
  poster_path: string | null;
  overview: string;
  release_date: string;
  first_air_date: string | null;
  vote_average: number;
  vote_count: number;
  popularity: number;
  media_type: string;
  imdb_id: string | null;
  imdb_path: string | null;
}

export interface TmdbSearchResponse {
  page: number;
  results: TmdbTitle[];
}

function isRecord(value: unknown): value is JsonRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function stringOrEmpty(
  record: JsonRecord,
  key: string,
): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function nullableString(
  value: unknown,
): string | null {
  return typeof value === "string" && value.length > 0
    ? value
    : null;
}

function finiteNumber(
  record: JsonRecord,
  key: string,
): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : 0;
}

function imageUrl(
  value: unknown,
  size: "w342" | "w1280",
): string | null {
  const path = nullableString(value);
  if (path === null) {
    return null;
  }
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${TMDB_IMAGE_BASE_URL}/${size}${path}`;
}

function extractImdbId(
  record: JsonRecord,
  kind: TmdbKind,
): string | null {
  if (kind === "movie") {
    return nullableString(record.imdb_id);
  }
  const externalIds = record.external_ids;
  return isRecord(externalIds)
    ? nullableString(externalIds.imdb_id)
    : null;
}

function toTmdbTitle(
  value: unknown,
  kind: TmdbKind,
): TmdbTitle {
  if (!isRecord(value)) {
    domainError(
      "SERVICE_UNAVAILABLE",
      "TMDB returned an invalid title record.",
      { retryable: true },
    );
  }
  const id = value.id;
  const rawTitle = kind === "movie" ? value.title : value.name;
  if (
    typeof id !== "number" ||
    !Number.isSafeInteger(id) ||
    id < 1 ||
    typeof rawTitle !== "string" ||
    rawTitle.trim().length === 0
  ) {
    domainError(
      "SERVICE_UNAVAILABLE",
      "TMDB returned an invalid title record.",
      { retryable: true },
    );
  }
  const releaseDate =
    kind === "movie"
      ? stringOrEmpty(value, "release_date")
      : stringOrEmpty(value, "first_air_date");
  const imdbId = extractImdbId(value, kind);
  return {
    id,
    title: rawTitle,
    backdrop_path: imageUrl(value.backdrop_path, "w1280"),
    poster_path: imageUrl(value.poster_path, "w342"),
    overview: stringOrEmpty(value, "overview"),
    release_date: releaseDate,
    first_air_date:
      kind === "tv" ? releaseDate : nullableString(value.first_air_date),
    vote_average: finiteNumber(value, "vote_average"),
    vote_count: finiteNumber(value, "vote_count"),
    popularity: finiteNumber(value, "popularity"),
    media_type:
      nullableString(value.media_type) ?? kind,
    imdb_id: imdbId,
    imdb_path:
      imdbId === null ? null : `${IMDB_BASE_URL}/${imdbId}`,
  };
}

function tmdbApiKey(): string {
  const apiKey = env.TMDB_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) {
    domainError(
      "SERVICE_UNAVAILABLE",
      "TMDB integration is not configured.",
    );
  }
  return apiKey;
}

async function fetchTmdb(url: URL): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(TMDB_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
  } catch {
    domainError(
      "SERVICE_UNAVAILABLE",
      "TMDB request failed.",
      { retryable: true },
    );
  }
  if (response.status === 404) {
    domainError("NOT_FOUND", "The TMDB title is unavailable.");
  }
  if (!response.ok) {
    domainError(
      "SERVICE_UNAVAILABLE",
      "TMDB request failed.",
      {
        retryable:
          response.status === 429 || response.status >= 500,
        details: { upstreamStatus: response.status },
      },
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    domainError(
      "SERVICE_UNAVAILABLE",
      "TMDB returned an invalid response.",
      { retryable: true },
    );
  }
  if (
    isRecord(payload) &&
    (payload.success === false ||
      typeof payload.status_code === "number")
  ) {
    domainError(
      "SERVICE_UNAVAILABLE",
      "TMDB returned an error response.",
      { retryable: false },
    );
  }
  return payload;
}

export function prepareTmdbSearchInput(
  rawQuery: string,
  page: number,
): { query: string | null; page: number } {
  const query = rawQuery.trim().normalize("NFKC");
  if (query.length > MAX_TMDB_QUERY_LENGTH) {
    domainError(
      "VALIDATION_FAILED",
      `TMDB query cannot exceed ${String(MAX_TMDB_QUERY_LENGTH)} characters.`,
    );
  }
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > MAX_TMDB_PAGE
  ) {
    domainError(
      "VALIDATION_FAILED",
      `TMDB page must be an integer from 1 through ${String(MAX_TMDB_PAGE)}.`,
    );
  }
  return {
    query: query.length === 0 ? null : query,
    page,
  };
}

export function validateTmdbTitleId(id: number): number {
  if (
    !Number.isSafeInteger(id) ||
    id < 1 ||
    id > MAX_SQL_INT
  ) {
    domainError(
      "VALIDATION_FAILED",
      "TMDB title ID must be a positive integer in the SQL INT range.",
    );
  }
  return id;
}

export async function searchTmdb(
  kind: TmdbKind,
  rawQuery: string,
  rawPage: number,
): Promise<TmdbSearchResponse> {
  const { query, page } = prepareTmdbSearchInput(
    rawQuery,
    rawPage,
  );
  if (query === null) {
    return { page: 0, results: [] };
  }
  const url = new URL(
    `${TMDB_API_BASE_URL}/search/${kind === "movie" ? "movie" : "tv"}`,
  );
  url.searchParams.set("api_key", tmdbApiKey());
  url.searchParams.set("language", "en-US");
  url.searchParams.set("query", query);
  url.searchParams.set("page", String(page));
  const payload = await fetchTmdb(url);
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    domainError(
      "SERVICE_UNAVAILABLE",
      "TMDB returned an invalid search response.",
      { retryable: true },
    );
  }
  const responsePage = payload.page;
  return {
    page:
      typeof responsePage === "number" &&
      Number.isSafeInteger(responsePage)
        ? responsePage
        : page,
    results: payload.results
      .slice(0, MAX_TMDB_RESULTS)
      .map((result) => toTmdbTitle(result, kind)),
  };
}

export async function getTmdbTitle(
  kind: TmdbKind,
  rawId: number,
): Promise<TmdbTitle> {
  const id = validateTmdbTitleId(rawId);
  const url = new URL(
    `${TMDB_API_BASE_URL}/${kind === "movie" ? "movie" : "tv"}/${String(id)}`,
  );
  url.searchParams.set("api_key", tmdbApiKey());
  url.searchParams.set("language", "en-US");
  if (kind === "tv") {
    url.searchParams.set("append_to_response", "external_ids");
  }
  return toTmdbTitle(await fetchTmdb(url), kind);
}
