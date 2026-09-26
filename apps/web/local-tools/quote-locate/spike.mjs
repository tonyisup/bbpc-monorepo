import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";

import {
  DEFAULT_LOCATE_MODEL,
  LocateRequestError,
  MEDIA_RESOLUTIONS,
  THINKING_LEVELS,
  fetchVideoDetails,
  locateQuote,
  padLocatedRange,
  quoteCoverage,
} from "../../src/server/quoteLocate.mjs";

/**
 * @typedef {import("../../src/server/quoteLocate.mjs").LocateResult} LocateResult
 * @typedef {import("../../src/server/quoteLocate.mjs").LocateUsage} LocateUsage
 * @typedef {import("../../src/server/quoteLocate.mjs").VideoDetails} VideoDetails
 * @typedef {{
 *   id: string;
 *   quoteText: string;
 *   sourceTitle: string;
 *   sourceType: string;
 *   videoId: string;
 *   truthStart: number;
 *   truthEnd: number | null;
 * }} EvalRow
 * @typedef {{
 *   id: string;
 *   videoId: string;
 *   title: string;
 *   durationSeconds: number;
 *   quoteText: string;
 *   sourceTitle: string;
 *   truthStart: number;
 *   truthEnd: number | null;
 *   status: "found" | "not_found" | "invalid" | "blocked" | "error";
 *   hit: boolean;
 *   reason?: string;
 *   start?: number;
 *   end?: number;
 *   paddedStart?: number;
 *   paddedEnd?: number;
 *   spokenText?: string;
 *   confidence?: string;
 *   answer?: unknown;
 *   startError?: number;
 *   endError?: number | null;
 *   textMatch?: number;
 *   latencyMs: number;
 *   usage?: LocateUsage;
 *   modelVersion?: string;
 * }} SpikeRecord
 */

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
/** A located start this close to the listener's saved start counts as a hit. */
export const HIT_WINDOW_SECONDS = 2;
/** Share of answered rows that must be hits before the assistant is worth building. */
export const SHIP_BAR = 0.7;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
const DEFAULT_MAX_VIDEO_SECONDS = 600;
const DEFAULT_TIMEOUT_SECONDS = 120;
const VIDEO_DETAILS_TIMEOUT_MS = 30_000;
// A planning figure for --dry-run at low media resolution; real runs report usage.
const LOW_RESOLUTION_TOKENS_PER_SECOND = 100;

const USAGE = `Usage: node apps/web/local-tools/quote-locate/spike.mjs --input <quoteSubmissions export> [options]

Asks Gemini where each saved Quotabunga quote is spoken in its own YouTube clip,
and compares the answer with the listener's saved start and end.

  --input <file>              JSON array or JSON Lines from \`convex data quoteSubmissions\`
  --output <file>             New JSON Lines results file (default: next to the input)
  --limit <n>                 Rows to run (default ${String(
    DEFAULT_LIMIT
  )}, max ${String(MAX_LIMIT)})
  --model <id>                Gemini model (default ${DEFAULT_LOCATE_MODEL})
  --media-resolution <level>  ${Object.keys(MEDIA_RESOLUTIONS).join(
    " | "
  )} (default low)
  --thinking <level>          ${THINKING_LEVELS.join(
    " | "
  )} (default: the model's own)
  --max-video-seconds <n>     Skip longer videos (default ${String(
    DEFAULT_MAX_VIDEO_SECONDS
  )})
  --timeout-seconds <n>       Per-request timeout (default ${String(
    DEFAULT_TIMEOUT_SECONDS
  )})
  --input-price <usd>         Price per 1M input tokens, to estimate cost
  --output-price <usd>        Price per 1M output tokens (thinking included)
  --dry-run                   Select rows and check videos without calling Gemini

Needs YOUTUBE_API_KEY (video lengths) and, unless --dry-run, GEMINI_API_KEY.
Input and output must be outside the repository: they hold production quotes.`;

const exportedRowSchema = z.object({
  _id: z.string().optional(),
  quoteText: z.string(),
  sourceTitle: z.string(),
  sourceType: z.string().optional(),
  clipUrl: z.string().nullish(),
  clipStartSeconds: z.number().nullish(),
  clipEndSeconds: z.number().nullish(),
});

/**
 * Refuse paths inside the repository, so exported rows and results can't be
 * committed by accident.
 *
 * @param {string} file
 * @param {string} [root]
 */
export function assertOutsideRepository(file, root = REPOSITORY_ROOT) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  if (
    relative === "" ||
    (relative.split(path.sep)[0] !== ".." && !path.isAbsolute(relative))
  )
    throw new Error(
      `${file} is inside the repository. Keep exported quotes and results outside it.`
    );
}

/**
 * The YouTube video ID in a saved clip link. Mirrors parseYouTubeUrl in
 * src/lib/quoteClip.ts, which is TypeScript this Node tool can't import.
 *
 * @param {string} value
 * @returns {string | null}
 */
export function youtubeVideoId(value) {
  /** @type {URL} */
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (!["https:", "http:"].includes(url.protocol)) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  const id =
    host === "youtu.be"
      ? parts[0]
      : ["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)
      ? parts[0] === "watch"
        ? url.searchParams.get("v")
        : ["embed", "shorts", "live"].includes(parts[0] ?? "")
        ? parts[1]
        : null
      : null;
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

/**
 * Read a JSON array or JSON Lines export.
 *
 * @param {string} text
 * @returns {unknown[]}
 */
export function readRows(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    /** @type {unknown} */
    const rows = JSON.parse(trimmed);
    if (!Array.isArray(rows)) throw new Error("Expected a JSON array of rows.");
    return rows;
  }
  return trimmed
    .split(/\r?\n/)
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trim() !== "")
    .map(({ line, index }) => {
      try {
        return /** @type {unknown} */ (JSON.parse(line));
      } catch {
        throw new Error(`Line ${String(index + 1)} is not JSON.`);
      }
    });
}

/**
 * Keep entries with a YouTube clip and a saved start; count the rest by reason.
 *
 * @param {unknown[]} rows
 */
export function selectEvalRows(rows) {
  /** @type {EvalRow[]} */
  const eligible = [];
  /** @type {Record<string, number>} */
  const skipped = {};
  /** @param {string} reason */
  const skip = (reason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };
  rows.forEach((raw, index) => {
    const parsed = exportedRowSchema.safeParse(raw);
    if (!parsed.success) return skip("unreadable row");
    const row = parsed.data;
    if (!row.quoteText.trim()) return skip("no quote text");
    const videoId = row.clipUrl ? youtubeVideoId(row.clipUrl) : null;
    if (!videoId) return skip("no YouTube link");
    const start = row.clipStartSeconds;
    if (typeof start !== "number" || !Number.isFinite(start) || start < 0)
      return skip("no start time");
    const end = row.clipEndSeconds;
    eligible.push({
      id: row._id ?? `row-${String(index + 1)}`,
      quoteText: row.quoteText.trim(),
      sourceTitle: row.sourceTitle.trim(),
      sourceType: row.sourceType ?? "OTHER",
      videoId,
      truthStart: start,
      truthEnd:
        typeof end === "number" && Number.isFinite(end) && end > start
          ? end
          : null,
    });
  });
  return { eligible, skipped };
}

/**
 * Why a row's video can't be run, or null when it can.
 *
 * @param {EvalRow} row
 * @param {VideoDetails | undefined} video
 * @param {number} maxVideoSeconds
 */
export function videoSkipReason(row, video, maxVideoSeconds) {
  if (!video) return "video unavailable";
  if (!video.isPublic) return "video not public";
  if (video.durationSeconds === null) return "video length unknown";
  if (video.durationSeconds > maxVideoSeconds) return "video too long";
  if (row.truthStart >= video.durationSeconds)
    return "saved start outside video";
  return null;
}

/** @param {number} value */
const round = (value) => Math.round(value * 1000) / 1000;

/**
 * Compare a located line with the listener's saved clip.
 *
 * @param {EvalRow} row
 * @param {LocateResult} result
 * @param {number} durationSeconds
 * @returns {Omit<SpikeRecord, "id" | "videoId" | "title" | "durationSeconds" | "quoteText" | "sourceTitle" | "truthStart" | "truthEnd" | "latencyMs">}
 */
export function scoreResult(row, result, durationSeconds) {
  switch (result.status) {
    case "found": {
      const padded = padLocatedRange(result.start, result.end, durationSeconds);
      return {
        status: "found",
        hit: Math.abs(result.start - row.truthStart) <= HIT_WINDOW_SECONDS,
        start: result.start,
        end: result.end,
        paddedStart: padded.start,
        paddedEnd: padded.end,
        spokenText: result.spokenText,
        confidence: result.confidence,
        startError: round(result.start - row.truthStart),
        endError:
          row.truthEnd === null ? null : round(result.end - row.truthEnd),
        textMatch: round(quoteCoverage(row.quoteText, result.spokenText)),
      };
    }
    case "not_found":
      return { status: "not_found", hit: false, confidence: result.confidence };
    default:
      return {
        status: result.status,
        hit: false,
        reason: result.reason,
        ...(result.answer ? { answer: result.answer } : {}),
      };
  }
}

/**
 * @param {number[]} values
 * @param {number} fraction
 */
function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return (
    sorted[
      Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)
    ] ?? null
  );
}

/**
 * @param {Array<number | null | undefined>} values
 * @returns {number[]}
 */
const numbers = (values) =>
  values.filter(
    /** @returns {value is number} */ (value) => typeof value === "number"
  );

/**
 * Totals and accuracy for a run. Request errors are reported but not scored.
 *
 * @param {SpikeRecord[]} records
 * @param {{ inputPrice?: number; outputPrice?: number }} [prices]
 */
export function summarize(records, prices = {}) {
  const answered = records.filter((record) => record.status !== "error");
  const found = answered.filter((record) => record.status === "found");
  const hits = found.filter((record) => record.hit);
  /** @type {Record<string, number>} */
  const statuses = {};
  // Why answers were refused or rejected; RECITATION changes the design.
  /** @type {Record<string, number>} */
  const unusable = {};
  for (const record of records) {
    statuses[record.status] = (statuses[record.status] ?? 0) + 1;
    if (record.status === "invalid" || record.status === "blocked") {
      const reason = `${record.status} ${record.reason ?? "unknown"}`;
      unusable[reason] = (unusable[reason] ?? 0) + 1;
    }
  }
  /** @type {Record<string, { found: number; hits: number }>} */
  const confidence = {};
  for (const record of found) {
    const level = record.confidence ?? "unknown";
    const entry = (confidence[level] ??= { found: 0, hits: 0 });
    entry.found += 1;
    if (record.hit) entry.hits += 1;
  }
  const startErrors = numbers(found.map((record) => record.startError));
  const endErrors = numbers(found.map((record) => record.endError));
  const usages = answered
    .map((record) => record.usage)
    .filter(
      /** @returns {usage is LocateUsage} */ (usage) => usage !== undefined
    );
  /** @param {(usage: LocateUsage) => number} pick */
  const total = (pick) => usages.reduce((sum, usage) => sum + pick(usage), 0);
  const inputTokens = total((usage) => usage.promptTokens);
  const outputTokens = total(
    (usage) => usage.outputTokens + usage.thoughtsTokens
  );
  const cost =
    prices.inputPrice !== undefined && prices.outputPrice !== undefined
      ? (inputTokens * prices.inputPrice + outputTokens * prices.outputPrice) /
        1e6
      : null;
  const hitRate = answered.length > 0 ? hits.length / answered.length : null;
  return {
    run: records.length,
    answered: answered.length,
    statuses,
    unusable,
    found: found.length,
    hits: hits.length,
    within5: startErrors.filter((error) => Math.abs(error) <= 5).length,
    hitRate,
    passes: hitRate !== null && hitRate >= SHIP_BAR,
    startError: {
      median: percentile(startErrors.map(Math.abs), 0.5),
      p90: percentile(startErrors.map(Math.abs), 0.9),
      bias: percentile(startErrors, 0.5),
    },
    endError: {
      count: endErrors.length,
      median: percentile(endErrors.map(Math.abs), 0.5),
      bias: percentile(endErrors, 0.5),
    },
    textMatch: {
      hits: percentile(numbers(hits.map((record) => record.textMatch)), 0.5),
      misses: percentile(
        numbers(
          found
            .filter((record) => !record.hit)
            .map((record) => record.textMatch)
        ),
        0.5
      ),
    },
    confidence,
    latencyMs: {
      p50: percentile(numbers(answered.map((record) => record.latencyMs)), 0.5),
      p90: percentile(numbers(answered.map((record) => record.latencyMs)), 0.9),
    },
    tokensPerRun:
      usages.length > 0
        ? {
            prompt: Math.round(inputTokens / usages.length),
            video: Math.round(
              total((usage) => usage.videoTokens) / usages.length
            ),
            audio: Math.round(
              total((usage) => usage.audioTokens) / usages.length
            ),
            text: Math.round(
              total((usage) => usage.textTokens) / usages.length
            ),
            output: Math.round(
              total((usage) => usage.outputTokens) / usages.length
            ),
            thoughts: Math.round(
              total((usage) => usage.thoughtsTokens) / usages.length
            ),
          }
        : null,
    cost:
      cost === null
        ? null
        : { total: cost, perRun: cost / Math.max(1, usages.length) },
    modelVersions: [
      ...new Set(
        answered
          .map((record) => record.modelVersion)
          .filter(
            /** @returns {version is string} */ (version) =>
              version !== undefined
          )
      ),
    ],
  };
}

/**
 * @param {number} part
 * @param {number} whole
 */
const share = (part, whole) =>
  `${String(part)}/${String(whole)}${
    whole > 0 ? ` (${String(Math.round((part / whole) * 100))}%)` : ""
  }`;
/** @param {number | null} value */
const secs = (value) => (value === null ? "n/a" : `${value.toFixed(1)} s`);
/** @param {number | null} value */
const signed = (value) =>
  value === null
    ? "n/a"
    : `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(1)} s`;
/** @param {Record<string, number>} counts */
const listCounts = (counts) =>
  Object.entries(counts)
    .sort(([, left], [, right]) => right - left)
    .map(([reason, count]) => `${reason} ${String(count)}`)
    .join(", ");

/**
 * @param {ReturnType<typeof summarize>} summary
 * @param {{ model: string; mediaResolution: string; skipped: Record<string, number>; notRun: number }} context
 */
export function formatSummary(summary, context) {
  const statuses = summary.statuses;
  const lines = [
    `Model ${context.model}${
      summary.modelVersions.length > 0
        ? ` (served ${summary.modelVersions.join(", ")})`
        : ""
    }, ${context.mediaResolution} media resolution`,
    `Rows: ${String(summary.run)} run, ${String(
      statuses.error ?? 0
    )} request errors (not scored)` +
      (Object.keys(context.skipped).length > 0
        ? `; skipped ${listCounts(context.skipped)}`
        : "") +
      (context.notRun > 0
        ? `; ${String(context.notRun)} more eligible over --limit`
        : ""),
    `Found: ${share(summary.found, summary.answered)}; not found ${String(
      statuses.not_found ?? 0
    )}, invalid ${String(statuses.invalid ?? 0)}, blocked ${String(
      statuses.blocked ?? 0
    )}` +
      (Object.keys(summary.unusable).length > 0
        ? ` (${listCounts(summary.unusable)})`
        : ""),
    `Start within ${String(HIT_WINDOW_SECONDS)} s: ${share(
      summary.hits,
      summary.answered
    )}; within 5 s: ${share(summary.within5, summary.answered)}`,
    `Start error (found): median ${secs(summary.startError.median)}, p90 ${secs(
      summary.startError.p90
    )}, median signed ${signed(
      summary.startError.bias
    )} (negative = before the saved start)`,
    `End error (${String(
      summary.endError.count
    )} with a saved end): median ${secs(
      summary.endError.median
    )}, median signed ${signed(summary.endError.bias)}`,
    `Quote match (median): ${
      summary.textMatch.hits?.toFixed(2) ?? "n/a"
    } on hits, ${
      summary.textMatch.misses?.toFixed(2) ?? "n/a"
    } on found misses`,
    `Confidence: ${
      Object.entries(summary.confidence)
        .map(
          ([level, { found, hits }]) =>
            `${level} ${String(hits)}/${String(found)} hits`
        )
        .join(", ") || "n/a"
    }`,
    `Latency: p50 ${secs(
      summary.latencyMs.p50 === null ? null : summary.latencyMs.p50 / 1000
    )}, p90 ${secs(
      summary.latencyMs.p90 === null ? null : summary.latencyMs.p90 / 1000
    )}`,
    summary.tokensPerRun
      ? `Tokens per run: ${summary.tokensPerRun.prompt.toLocaleString(
          "en-US"
        )} input (video ${summary.tokensPerRun.video.toLocaleString(
          "en-US"
        )}, audio ${summary.tokensPerRun.audio.toLocaleString(
          "en-US"
        )}, text ${summary.tokensPerRun.text.toLocaleString(
          "en-US"
        )}), ${summary.tokensPerRun.output.toLocaleString(
          "en-US"
        )} output, ${summary.tokensPerRun.thoughts.toLocaleString(
          "en-US"
        )} thinking`
      : "Tokens per run: n/a",
    summary.cost
      ? `Cost: $${summary.cost.perRun.toFixed(
          4
        )} per run, $${summary.cost.total.toFixed(2)} total`
      : "Cost: pass --input-price and --output-price (USD per 1M tokens) to estimate",
    summary.hitRate === null
      ? "Ship bar: no answered rows"
      : `Ship bar (${String(SHIP_BAR * 100)}% start within ${String(
          HIT_WINDOW_SECONDS
        )} s): ${summary.passes ? "PASS" : "FAIL"} at ${String(
          Math.round(summary.hitRate * 100)
        )}%`,
  ];
  return lines.join("\n");
}

/**
 * @param {string | undefined} value
 * @param {string} name
 * @param {{ min: number; max: number; integer?: boolean; fallback?: number }} rule
 */
function numberOption(value, name, rule) {
  if (value === undefined) {
    if (rule.fallback === undefined) return undefined;
    return rule.fallback;
  }
  const parsed = Number(value);
  if (
    value.trim() === "" ||
    !Number.isFinite(parsed) ||
    parsed < rule.min ||
    parsed > rule.max ||
    (rule.integer && !Number.isInteger(parsed))
  )
    throw new Error(
      `--${name} must be ${
        rule.integer ? "an integer" : "a number"
      } from ${String(rule.min)} to ${String(rule.max)}.`
    );
  return parsed;
}

/**
 * @param {unknown} error
 */
function errorMessage(error) {
  if (error instanceof LocateRequestError) return error.message;
  if (error instanceof Error && error.name === "TimeoutError")
    return "timed out";
  if (error instanceof Error) return error.message.slice(0, 300);
  return "request failed";
}

/**
 * @param {number} index
 * @param {number} count
 * @param {SpikeRecord} record
 */
function progressLine(index, count, record) {
  const position = `[${String(index + 1).padStart(
    String(count).length
  )}/${String(count)}]`;
  const timing = `${(record.latencyMs / 1000).toFixed(1)} s`;
  if (record.status === "found")
    return [
      position,
      record.hit ? "hit      " : "found    ",
      `start ${signed(record.startError ?? null)}`,
      record.endError == null ? "" : `end ${signed(record.endError)}`,
      `match ${record.textMatch?.toFixed(2) ?? "n/a"}`,
      record.confidence ?? "",
      timing,
    ]
      .filter(Boolean)
      .join("  ");
  return [
    position,
    record.status.padEnd(9),
    record.reason ?? record.confidence ?? "",
    timing,
  ]
    .filter(Boolean)
    .join("  ");
}

/**
 * Run the spike from the command line.
 *
 * @param {string[]} [argv]
 * @param {Record<string, string | undefined>} [env]
 */
export async function main(argv = process.argv.slice(2), env = process.env) {
  const { values } = parseArgs({
    args: argv,
    options: {
      input: { type: "string" },
      output: { type: "string" },
      limit: { type: "string" },
      model: { type: "string" },
      "media-resolution": { type: "string" },
      thinking: { type: "string" },
      "max-video-seconds": { type: "string" },
      "timeout-seconds": { type: "string" },
      "input-price": { type: "string" },
      "output-price": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return null;
  }
  if (!values.input)
    throw new Error("--input is required. Run with --help for usage.");
  const model = values.model ?? DEFAULT_LOCATE_MODEL;
  if (!/^[\w.-]+$/.test(model))
    throw new Error("--model must be a Gemini model ID.");
  const mediaResolution = values["media-resolution"] ?? "low";
  if (!MEDIA_RESOLUTIONS[mediaResolution])
    throw new Error(
      `--media-resolution must be one of ${Object.keys(MEDIA_RESOLUTIONS).join(
        ", "
      )}.`
    );
  const thinkingLevel = values.thinking;
  if (thinkingLevel !== undefined && !THINKING_LEVELS.includes(thinkingLevel))
    throw new Error(`--thinking must be one of ${THINKING_LEVELS.join(", ")}.`);
  const limit =
    numberOption(values.limit, "limit", {
      min: 1,
      max: MAX_LIMIT,
      integer: true,
      fallback: DEFAULT_LIMIT,
    }) ?? DEFAULT_LIMIT;
  const maxVideoSeconds =
    numberOption(values["max-video-seconds"], "max-video-seconds", {
      min: 1,
      max: 86_400,
      fallback: DEFAULT_MAX_VIDEO_SECONDS,
    }) ?? DEFAULT_MAX_VIDEO_SECONDS;
  const timeoutSeconds =
    numberOption(values["timeout-seconds"], "timeout-seconds", {
      min: 1,
      max: 600,
      fallback: DEFAULT_TIMEOUT_SECONDS,
    }) ?? DEFAULT_TIMEOUT_SECONDS;
  const inputPrice = numberOption(values["input-price"], "input-price", {
    min: 0,
    max: 1000,
  });
  const outputPrice = numberOption(values["output-price"], "output-price", {
    min: 0,
    max: 1000,
  });
  if ((inputPrice === undefined) !== (outputPrice === undefined))
    throw new Error("Pass both --input-price and --output-price, or neither.");

  const input = path.resolve(values.input);
  assertOutsideRepository(input);
  const output = path.resolve(
    values.output ??
      path.join(
        path.dirname(input),
        `${path.basename(
          input,
          path.extname(input)
        )}.locate-${model}-${new Date()
          .toISOString()
          .replace(/[:.]/g, "-")}.jsonl`
      )
  );
  assertOutsideRepository(output);
  const youtubeKey = env.YOUTUBE_API_KEY;
  if (!youtubeKey)
    throw new Error("Set YOUTUBE_API_KEY to read video lengths.");
  const geminiKey = env.GEMINI_API_KEY;
  if (!values["dry-run"] && !geminiKey)
    throw new Error("Set GEMINI_API_KEY, or use --dry-run.");

  const { eligible, skipped } = selectEvalRows(
    readRows(await readFile(input, "utf8"))
  );
  const videos = await fetchVideoDetails(
    eligible.map((row) => row.videoId),
    youtubeKey,
    AbortSignal.timeout(VIDEO_DETAILS_TIMEOUT_MS)
  );
  /** @type {Array<{ row: EvalRow; video: VideoDetails & { durationSeconds: number } }>} */
  const runnable = [];
  for (const row of eligible) {
    const video = videos.get(row.videoId);
    const reason = videoSkipReason(row, video, maxVideoSeconds);
    const durationSeconds = video?.durationSeconds;
    if (reason === null && video && typeof durationSeconds === "number") {
      runnable.push({ row, video: { ...video, durationSeconds } });
    } else {
      const key = reason ?? "video unavailable";
      skipped[key] = (skipped[key] ?? 0) + 1;
    }
  }
  const selected = runnable.slice(0, limit);
  const notRun = runnable.length - selected.length;
  const videoSeconds = selected.reduce(
    (sum, { video }) => sum + video.durationSeconds,
    0
  );
  console.log(
    `Selected ${String(selected.length)} of ${String(
      runnable.length
    )} runnable rows: ${String(Math.round(videoSeconds / 60))} min of video.` +
      (Object.keys(skipped).length > 0
        ? ` Skipped ${listCounts(skipped)}.`
        : "")
  );
  if (values["dry-run"] || !geminiKey) {
    if (mediaResolution === "low")
      console.log(
        `Roughly ${Math.round(
          videoSeconds * LOW_RESOLUTION_TOKENS_PER_SECOND
        ).toLocaleString(
          "en-US"
        )} video input tokens at low resolution. No Gemini requests were made.`
      );
    else console.log("No Gemini requests were made.");
    return null;
  }
  if (selected.length === 0) throw new Error("No runnable rows in the input.");

  // Exclusive, private creation: never overwrite an earlier run's results.
  await writeFile(output, "", { flag: "wx", mode: 0o600 });
  /** @type {SpikeRecord[]} */
  const records = [];
  for (const [index, { row, video }] of selected.entries()) {
    const base = {
      id: row.id,
      videoId: row.videoId,
      title: video.title,
      durationSeconds: video.durationSeconds,
      quoteText: row.quoteText,
      sourceTitle: row.sourceTitle,
      truthStart: row.truthStart,
      truthEnd: row.truthEnd,
    };
    const started = performance.now();
    /** @type {SpikeRecord} */
    let record;
    try {
      const located = await locateQuote({
        apiKey: geminiKey,
        model,
        videoId: row.videoId,
        durationSeconds: video.durationSeconds,
        quoteText: row.quoteText,
        sourceTitle: row.sourceTitle,
        sourceType: row.sourceType,
        mediaResolution,
        ...(thinkingLevel ? { thinkingLevel } : {}),
        signal: AbortSignal.timeout(timeoutSeconds * 1000),
      });
      record = {
        ...base,
        ...scoreResult(row, located.result, video.durationSeconds),
        latencyMs: Math.round(performance.now() - started),
        usage: located.usage,
        modelVersion: located.modelVersion,
      };
    } catch (error) {
      record = {
        ...base,
        status: "error",
        hit: false,
        reason: errorMessage(error),
        latencyMs: Math.round(performance.now() - started),
      };
    }
    records.push(record);
    await appendFile(output, `${JSON.stringify(record)}\n`);
    console.log(progressLine(index, selected.length, record));
  }
  const summary = summarize(records, {
    ...(inputPrice === undefined ? {} : { inputPrice }),
    ...(outputPrice === undefined ? {} : { outputPrice }),
  });
  console.log(
    `\n${formatSummary(summary, { model, mediaResolution, skipped, notRun })}`
  );
  console.log(`\nPer-row results: ${output}`);
  return summary;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Quote locate spike failed."
    );
    process.exitCode = 1;
  });
}
