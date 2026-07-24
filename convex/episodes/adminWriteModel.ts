import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import { normalizeLookupKey } from "../lib/normalize.js";
import {
  MAX_EPISODE_RELATIONSHIPS,
  MAX_EPISODE_SLUG_ATTEMPTS,
  MAX_GAMBLING_ENTRIES_PER_EPISODE_UPDATE,
} from "./limits.js";

const MAX_SLUG_LENGTH = 255;
const SLUG_SUFFIX_RESERVE = 16;
const MAX_EPISODE_TITLE_LENGTH = 1000;
const MAX_EPISODE_TEXT_LENGTH = 10_000;
const MAX_EPISODE_SHORT_TEXT_LENGTH = 1000;
const MAX_URL_LENGTH = 2048;
const MAX_LINK_TEXT_LENGTH = 500;
const MAX_FILE_KEY_LENGTH = 1024;
const MAX_AUDIO_NOTES_LENGTH = 5000;
const MIN_SQL_SMALLINT = -32_768;
const MAX_SQL_SMALLINT = 32_767;
const WRITABLE_STATUSES = new Set([
  "pending",
  "next",
  "recording",
  "published",
]);

export function validateEpisodeNumber(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_SQL_SMALLINT ||
    value > MAX_SQL_SMALLINT
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Episode number must be an integer in the SQL SMALLINT range.",
    );
  }
  return value;
}

export function validateEpisodeTitle(value: string): string {
  const title = value.trim().normalize("NFKC");
  if (
    title.length < 1 ||
    title.length > MAX_EPISODE_TITLE_LENGTH
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Episode title must contain 1 through ${String(MAX_EPISODE_TITLE_LENGTH)} characters.`,
    );
  }
  return title;
}

export function validateOptionalEpisodeText(
  value: string | null,
  label: string,
  maxLength = MAX_EPISODE_TEXT_LENGTH,
): string | undefined {
  if (value === null) {
    return undefined;
  }
  const normalized = value.trim().normalize("NFKC");
  if (normalized.length > maxLength) {
    domainError(
      "VALIDATION_FAILED",
      `${label} cannot exceed ${String(maxLength)} characters.`,
    );
  }
  return normalized.length === 0 ? undefined : normalized;
}

export function validatePlainDate(
  value: string | null,
): string | undefined {
  if (value === null) {
    return undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    domainError(
      "VALIDATION_FAILED",
      "Episode date must use YYYY-MM-DD format.",
    );
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Episode date must be a real calendar date.",
    );
  }
  return value;
}

export function validateEpisodeStatus(value: string): string {
  const status = value.trim().normalize("NFKC").toLowerCase();
  if (!WRITABLE_STATUSES.has(status)) {
    domainError(
      "VALIDATION_FAILED",
      "Episode status must be pending, next, recording, or published.",
    );
  }
  return status;
}

export function validateHttpUrl(
  value: string,
  label: string,
): string {
  const url = value.trim();
  if (url.length < 1 || url.length > MAX_URL_LENGTH) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must contain 1 through ${String(MAX_URL_LENGTH)} characters.`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    domainError(
      "VALIDATION_FAILED",
      `${label} must be a valid HTTP or HTTPS URL.`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    domainError(
      "VALIDATION_FAILED",
      `${label} must be a valid HTTP or HTTPS URL.`,
    );
  }
  return url;
}

export function validateLinkText(value: string): string {
  const text = value.trim().normalize("NFKC");
  if (text.length < 1 || text.length > MAX_LINK_TEXT_LENGTH) {
    domainError(
      "VALIDATION_FAILED",
      `Link text must contain 1 through ${String(MAX_LINK_TEXT_LENGTH)} characters.`,
    );
  }
  return text;
}

export function validateFileKey(
  value: string | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const fileKey = value.trim();
  if (
    fileKey.length < 1 ||
    fileKey.length > MAX_FILE_KEY_LENGTH
  ) {
    domainError(
      "VALIDATION_FAILED",
      `File key must contain 1 through ${String(MAX_FILE_KEY_LENGTH)} characters.`,
    );
  }
  return fileKey;
}

export function validateAudioNotes(
  value: string | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const notes = value.trim().normalize("NFKC");
  if (notes.length > MAX_AUDIO_NOTES_LENGTH) {
    domainError(
      "VALIDATION_FAILED",
      `Audio notes cannot exceed ${String(MAX_AUDIO_NOTES_LENGTH)} characters.`,
    );
  }
  return notes.length === 0 ? undefined : notes;
}

export async function requireEpisode(
  ctx: MutationCtx,
  id: Id<"episodes">,
): Promise<Doc<"episodes">> {
  const episode = await ctx.db.get("episodes", id);
  if (episode === null) {
    domainError("NOT_FOUND", "The episode is unavailable.");
  }
  return episode;
}

export function slugifyEpisode(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, MAX_SLUG_LENGTH - SLUG_SUFFIX_RESERVE)
    .replace(/-+$/gu, "");
}

export async function allocateEpisodeSlug(
  ctx: MutationCtx,
  input: {
    number: number;
    title: string;
    requestedSlug?: string;
    excludeId?: Id<"episodes">;
  },
): Promise<{
  slug: string;
  normalizedSlug: string;
}> {
  const requestedBase =
    input.requestedSlug ??
    `episode-${String(input.number)}-${input.title || "episode"}`;
  const base = slugifyEpisode(requestedBase);
  if (base.length === 0) {
    domainError(
      "VALIDATION_FAILED",
      "Episode slug must contain at least one ASCII letter or number.",
    );
  }

  for (
    let suffix = 1;
    suffix <= MAX_EPISODE_SLUG_ATTEMPTS;
    suffix += 1
  ) {
    const suffixText = suffix === 1 ? "" : `-${String(suffix)}`;
    const candidate = `${base.slice(
      0,
      MAX_SLUG_LENGTH - suffixText.length,
    )}${suffixText}`;
    const normalizedSlug = normalizeLookupKey(
      candidate,
      "Episode slug",
    );
    const collision = await ctx.db
      .query("episodes")
      .withIndex("by_normalizedSlug", (index) =>
        index.eq("normalizedSlug", normalizedSlug),
      )
      .unique();
    if (
      collision === null ||
      collision._id === input.excludeId
    ) {
      return { slug: candidate, normalizedSlug };
    }
  }
  domainError(
    "CONFLICT",
    "Unable to allocate a unique episode slug within the supported attempt limit.",
    { details: { limit: MAX_EPISODE_SLUG_ATTEMPTS } },
  );
}

export async function assertEpisodeLinkCapacity(
  ctx: MutationCtx,
  episodeId: Id<"episodes">,
): Promise<void> {
  const links = await ctx.db
    .query("episodeLinks")
    .withIndex("by_episodeId", (index) =>
      index.eq("episodeId", episodeId),
    )
    .take(MAX_EPISODE_RELATIONSHIPS);
  if (links.length >= MAX_EPISODE_RELATIONSHIPS) {
    domainError(
      "CONFLICT",
      "The episode has reached the supported link limit.",
      { details: { limit: MAX_EPISODE_RELATIONSHIPS } },
    );
  }
}

export async function lockPendingGamblingForEpisode(
  ctx: MutationCtx,
  episodeId: Id<"episodes">,
): Promise<number> {
  const assignments = await ctx.db
    .query("assignments")
    .withIndex("by_episodeId", (index) =>
      index.eq("episodeId", episodeId),
    )
    .take(MAX_EPISODE_RELATIONSHIPS + 1);
  if (assignments.length > MAX_EPISODE_RELATIONSHIPS) {
    domainError(
      "CONFLICT",
      "Episode assignments exceed the supported status-update limit.",
      { details: { limit: MAX_EPISODE_RELATIONSHIPS } },
    );
  }

  let inspectedCount = 0;
  let lockedCount = 0;
  for (const assignment of assignments) {
    const remaining =
      MAX_GAMBLING_ENTRIES_PER_EPISODE_UPDATE - inspectedCount;
    const entries = await ctx.db
      .query("gamblingEntries")
      .withIndex("by_assignmentId", (index) =>
        index.eq("assignmentId", assignment._id),
      )
      .take(remaining + 1);
    if (entries.length > remaining) {
      domainError(
        "CONFLICT",
        "Episode gambling entries exceed the supported status-update limit.",
        {
          details: {
            limit: MAX_GAMBLING_ENTRIES_PER_EPISODE_UPDATE,
          },
        },
      );
    }
    inspectedCount += entries.length;
    for (const entry of entries) {
      if (entry.status === "pending") {
        await ctx.db.patch("gamblingEntries", entry._id, {
          status: "locked",
        });
        lockedCount += 1;
      }
    }
  }
  return lockedCount;
}

export const episodeShortTextLimit =
  MAX_EPISODE_SHORT_TEXT_LENGTH;
