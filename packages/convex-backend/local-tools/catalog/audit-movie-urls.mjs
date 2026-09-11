import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { parseArgs } from "node:util";
import { pathToFileURL, URL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import {
  canonicalImdbUrl,
  imdbUrlForId,
  tmdbIdFromMovieUrl,
} from "../../convex/catalog/movieUrls.ts";

const stagingDeployment = "merry-shepherd-928";
const rowLimit = 10_000;
const root = path.resolve(import.meta.dirname, "../..");

function normalizedTitle(title) {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** Read-only planning: no mutation client or apply mode exists in this tool. */
export async function auditMovieUrls(movies, lookup) {
  const rows = [];
  for (const movie of movies) {
    if (
      typeof movie._id !== "string" ||
      typeof movie.url !== "string" ||
      typeof movie.title !== "string" ||
      !Number.isInteger(movie.year)
    ) {
      throw new Error(
        "Invalid movie inventory; refusing an incomplete report."
      );
    }
    const urlId = tmdbIdFromMovieUrl(movie.url);
    const storedId = movie.tmdbId;
    const validStoredId =
      Number.isSafeInteger(storedId) &&
      storedId > 0 &&
      storedId <= 2_147_483_647;
    const tmdbId = validStoredId ? storedId : urlId;
    const imdbUrl = canonicalImdbUrl(movie.url);
    const row = {
      id: movie._id,
      title: movie.title,
      year: movie.year,
      oldUrl: movie.url,
      storedTmdbId: storedId ?? null,
      tmdbId: tmdbId ?? null,
      recoveredTmdbId: storedId == null && urlId !== undefined,
      proposedUrl: null,
      imdbUrl,
      status: imdbUrl ? "already_imdb" : "unresolved",
      reasons: [],
    };
    if (storedId != null && !validStoredId) row.reasons.push("invalid_tmdb_id");
    if (validStoredId && urlId !== undefined && storedId !== urlId)
      row.reasons.push("conflicting_tmdb_id");
    if (imdbUrl === null && row.reasons.length === 0) {
      if (tmdbId === undefined) {
        row.reasons.push("missing_tmdb_id");
      } else {
        try {
          const details = await lookup(tmdbId);
          if (details === null) {
            row.reasons.push("tmdb_not_found");
          } else if (details.id !== tmdbId) {
            row.reasons.push("conflicting_tmdb_response");
          } else {
            row.imdbUrl = imdbUrlForId(details.imdb_id);
            if (row.imdbUrl === null)
              row.reasons.push("missing_or_invalid_imdb_id");
            else {
              row.proposedUrl = row.imdbUrl;
              row.status = "ready";
              const titles = [details.title, details.original_title].filter(
                (value) => typeof value === "string"
              );
              if (
                !titles.some(
                  (title) =>
                    normalizedTitle(title) === normalizedTitle(movie.title)
                ) ||
                Number(String(details.release_date).slice(0, 4)) !== movie.year
              ) {
                row.reasons.push("title_or_year_mismatch");
              }
            }
          }
        } catch {
          row.reasons.push("tmdb_lookup_failed");
        }
      }
    }
    rows.push(row);
  }
  const duplicates = [];
  for (const field of ["tmdbId", "imdbUrl", "oldUrl"]) {
    const groups = new Map();
    for (const row of rows) {
      const key = row[field];
      if (key === null) continue;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    for (const [value, group] of groups) {
      if (group.length < 2) continue;
      duplicates.push({ field, value, movieIds: group.map((row) => row.id) });
      for (const row of group) row.reasons.push(`duplicate_${field}`);
    }
  }
  const counts = { already_imdb: 0, ready: 0, unresolved: 0, review: 0 };
  for (const row of rows) {
    if (
      row.reasons.some(
        (reason) =>
          reason.startsWith("duplicate_") ||
          [
            "invalid_tmdb_id",
            "conflicting_tmdb_id",
            "conflicting_tmdb_response",
            "title_or_year_mismatch",
          ].includes(reason)
      )
    ) {
      row.status = "review";
    }
    counts[row.status] += 1;
  }
  return { total: rows.length, counts, duplicates, rows };
}

export async function lookupTmdbMovie(id, apiKey, fetcher = globalThis.fetch) {
  const url = new URL(`https://api.themoviedb.org/3/movie/${String(id)}`);
  url.searchParams.set("api_key", apiKey);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetcher(url, {
      signal: globalThis.AbortSignal.timeout(10_000),
    });
    if (response.status === 404) return null;
    if (response.ok) return await response.json();
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      const retrySeconds = Number(response.headers.get("retry-after"));
      await delay(
        Math.min(
          30_000,
          Math.max(1000, retrySeconds * 1000 || 1000 * 2 ** attempt)
        )
      );
      continue;
    }
    throw new Error("TMDB lookup failed.");
  }
  throw new Error("TMDB lookup failed.");
}

function runConvex(args) {
  try {
    return execFileSync(
      path.join(root, "node_modules/.bin/convex"),
      [...args, "--deployment", stagingDeployment],
      {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      }
    ).trim();
  } catch {
    throw new Error(
      "Staging CLI read failed. Check Convex login and deployment access."
    );
  }
}

function writePrivate(file, data) {
  fs.writeFileSync(file, data, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export async function main() {
  const { values } = parseArgs({ options: { deployment: { type: "string" } } });
  if (values.deployment !== stagingDeployment)
    throw new Error(
      `Pass --deployment ${stagingDeployment}. This read-only tool is staging-only.`
    );
  if (runConvex(["env", "get", "BBPC_ENVIRONMENT"]) !== "staging")
    throw new Error("Expected the staging environment.");
  const movies = JSON.parse(
    runConvex([
      "data",
      "movies",
      "--format",
      "jsonArray",
      "--limit",
      String(rowLimit),
    ])
  );
  if (!Array.isArray(movies) || movies.length >= rowLimit)
    throw new Error("Inventory limit reached; refusing an incomplete report.");
  const apiKey = runConvex(["env", "get", "TMDB_API_KEY"]);
  if (!apiKey) throw new Error("Staging TMDB API key is missing.");
  const cache = new Map();
  const report = await auditMovieUrls(movies, (id) => {
    if (!cache.has(id)) cache.set(id, lookupTmdbMovie(id, apiKey));
    return cache.get(id);
  });
  const directory = path.join(root, ".local-migration/movie-url-audit");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const result = {
    deployment: stagingDeployment,
    createdAt: new Date().toISOString(),
    dryRun: true,
    ...report,
  };
  writePrivate(
    path.join(directory, "report.json"),
    JSON.stringify(result, null, 2) + "\n"
  );
  const escape = (value) =>
    String(value)
      .replace(/[|\r\n]/g, " ")
      .replace(/</g, "&lt;");
  const markdown = [
    "# Staging movie URL audit",
    "",
    `Deployment: ${stagingDeployment}. No database writes performed.`,
    "",
    `Movies: ${report.total}. Already IMDb: ${report.counts.already_imdb}. Ready: ${report.counts.ready}. Review: ${report.counts.review}. Unresolved: ${report.counts.unresolved}.`,
    "",
    "Existing IMDb URLs are retained; their TMDB mappings were not re-fetched. Duplicate checks cover the entire inventory, including proposed IMDb destinations. Only ready rows are candidates for a later update; proposed URLs on review rows are not approved changes.",
    "",
    "| Movie | Year | Status | Current URL | Proposed URL | Reasons |",
    "|---|---|---|---|---|---|",
    ...report.rows
      .filter((row) => row.status !== "already_imdb")
      .map(
        (row) =>
          `| ${[
            row.title,
            row.year,
            row.status,
            row.oldUrl,
            row.proposedUrl ?? "",
            row.reasons.join(", "),
          ]
            .map(escape)
            .join(" | ")} |`
      ),
    "",
  ].join("\n");
  writePrivate(path.join(directory, "report.md"), markdown);
  console.log(
    JSON.stringify({
      deployment: stagingDeployment,
      total: report.total,
      counts: report.counts,
      report: path.join(directory, "report.md"),
    })
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch(() => {
    console.error(
      "Movie URL audit failed. Check staging access, target, and TMDB configuration; no database writes were performed."
    );
    process.exitCode = 1;
  });
}
