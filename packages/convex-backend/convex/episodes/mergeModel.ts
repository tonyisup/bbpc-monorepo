import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import { isPublishedEpisode } from "../lib/transcriptVisibility.js";
import {
  MAX_TRANSCRIPT_PASSAGES,
  TRANSCRIPT_VERSION,
  transcriptFingerprintInput,
  validatePassages,
} from "../lib/transcriptModel.js";
import { slugifyEpisode, validatePlainDate } from "./adminWriteModel.js";
import { MAX_EPISODE_RELATIONSHIPS } from "./limits.js";

const contentFields = [
  "recording",
  "description",
  "notes",
  "seoTitle",
  "seoDescription",
  "seoKeywords",
] as const;
const hash = (text: string) =>
  bytesToHex(sha256(new TextEncoder().encode(text)));
const populated = (value: string | undefined) => Boolean(value?.trim());
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    return (
      "{" +
      entries
        .map(([key, val]) => `${JSON.stringify(key)}:${canonicalJson(val)}`)
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}
function titleKey(episode: Doc<"episodes">) {
  return episode.title
    .replace(
      new RegExp(
        `^(?:Episode\\s+)?${String(episode.number)}\\s*[-–—:.]\\s*`,
        "i"
      ),
      ""
    )
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
function conflict(message: string): never {
  return domainError("CONFLICT", message);
}

async function relations(ctx: Pick<QueryCtx, "db">, episodeId: Id<"episodes">) {
  const bound = MAX_EPISODE_RELATIONSHIPS + 1;
  const [archivePosts, assignments, extraReviews, episodeLinks] =
    await Promise.all([
      ctx.db
        .query("archivePosts")
        .withIndex("by_episodeId_and_postedAt", (q) =>
          q.eq("episodeId", episodeId)
        )
        .take(bound),
      ctx.db
        .query("assignments")
        .withIndex("by_episodeId", (q) => q.eq("episodeId", episodeId))
        .take(bound),
      ctx.db
        .query("extraReviews")
        .withIndex("by_episodeId", (q) => q.eq("episodeId", episodeId))
        .take(bound),
      ctx.db
        .query("episodeLinks")
        .withIndex("by_episodeId", (q) => q.eq("episodeId", episodeId))
        .take(bound),
    ]);
  // This deliberately narrow workflow does not handle other content types.
  for (const table of [
    "bangers",
    "episodeAudioMessages",
    "quoteSubmissions",
    "rankedItems",
    "recordingSessions",
  ] as const) {
    const rows = await ctx.db
      .query(table)
      .withIndex("by_episodeId", (q) => q.eq("episodeId", episodeId))
      .take(1);
    if (rows.length)
      conflict(
        `Unsupported ${table} relationship; review this pair separately.`
      );
  }
  return { archivePosts, assignments, extraReviews, episodeLinks };
}

/** Bounded, read-only preview. The commit re-runs this exact inspection atomically. */
export async function buildMergePreview(
  ctx: Pick<QueryCtx, "db">,
  keeperId: Id<"episodes">,
  donorId: Id<"episodes">
) {
  if (keeperId === donorId) conflict("Keeper and donor must differ.");
  const [keeper, donor] = await Promise.all([
    ctx.db.get("episodes", keeperId),
    ctx.db.get("episodes", donorId),
  ]);
  if (!keeper || !donor)
    conflict(
      "Both episodes must still exist; do not replay a completed merge."
    );
  if (
    !Number.isSafeInteger(keeper.number) ||
    keeper.number <= 0 ||
    keeper.number !== donor.number ||
    !titleKey(keeper) ||
    titleKey(keeper) !== titleKey(donor)
  )
    conflict("Only matching-title, non-zero episode pairs can merge.");
  const siblings = await ctx.db
    .query("episodes")
    .withIndex("by_number", (q) => q.eq("number", keeper.number))
    .take(3);
  if (siblings.length !== 2)
    conflict("This number must have exactly two episode entries.");
  if (keeper.status !== donor.status || !isPublishedEpisode(keeper))
    conflict("Both episodes must share published status.");
  validatePlainDate(keeper.date ?? null);
  validatePlainDate(donor.date ?? null);
  if (
    !keeper.date ||
    !donor.date ||
    Math.abs(Date.parse(keeper.date) - Date.parse(donor.date)) > 7 * 86400000
  )
    conflict(
      "Dates need separate review (missing or more than seven days apart)."
    );
  const patch: Partial<Pick<Doc<"episodes">, (typeof contentFields)[number]>> =
    {};
  for (const field of contentFields) {
    if (
      populated(keeper[field]) &&
      populated(donor[field]) &&
      keeper[field] !== donor[field]
    )
      conflict(`Conflicting ${field}; review separately.`);
    const donorValue = donor[field];
    if (
      !populated(keeper[field]) &&
      donorValue !== undefined &&
      populated(donorValue)
    )
      patch[field] = donorValue;
  }
  const [
    keeperRelations,
    donorRelations,
    transcript,
    donorTranscript,
    passages,
    donorPassages,
  ] = await Promise.all([
    relations(ctx, keeperId),
    relations(ctx, donorId),
    ctx.db
      .query("episodeTranscripts")
      .withIndex("by_episodeId", (q) => q.eq("episodeId", keeperId))
      .unique(),
    ctx.db
      .query("episodeTranscripts")
      .withIndex("by_episodeId", (q) => q.eq("episodeId", donorId))
      .unique(),
    ctx.db
      .query("transcriptPassages")
      .withIndex("by_episodeId_and_sequence", (q) =>
        q.eq("episodeId", keeperId)
      )
      .take(MAX_TRANSCRIPT_PASSAGES + 1),
    ctx.db
      .query("transcriptPassages")
      .withIndex("by_episodeId_and_sequence", (q) => q.eq("episodeId", donorId))
      .take(1),
  ]);
  if (!transcript || donorTranscript || donorPassages.length)
    conflict(
      "Keeper must have the only transcript; donor must have no metadata or passages."
    );
  const verified = validatePassages(passages);
  if (
    transcript.version !== TRANSCRIPT_VERSION ||
    transcript.passageCount !== passages.length ||
    hash(transcriptFingerprintInput(verified)) !== transcript.hash ||
    passages.some(
      (p, i) => p.sequence !== i || p.hash !== transcript.hash || !p.isPublic
    )
  )
    conflict("Keeper transcript integrity check failed.");
  for (const table of [
    "archivePosts",
    "assignments",
    "extraReviews",
    "episodeLinks",
  ] as const) {
    if (
      keeperRelations[table].length + donorRelations[table].length >
      MAX_EPISODE_RELATIONSHIPS
    )
      conflict(`Combined ${table} exceeds the supported bound.`);
  }
  const assignments = [
    ...keeperRelations.assignments,
    ...donorRelations.assignments,
  ];
  if (
    new Set(assignments.map((r) => `${r.userId}/${r.movieId}`)).size !==
    assignments.length
  )
    conflict("Duplicate assignment identities require review.");
  const reviews = [
    ...keeperRelations.extraReviews,
    ...donorRelations.extraReviews,
  ];
  if (new Set(reviews.map((r) => r.reviewId)).size !== reviews.length)
    conflict("Duplicate extra-review identities require review.");
  const links = [
    ...keeperRelations.episodeLinks,
    ...donorRelations.episodeLinks,
  ];
  if (new Set(links.map((r) => r.url)).size !== links.length)
    conflict("Duplicate link URLs require review.");
  const slug = slugifyEpisode(
    `episode-${String(keeper.number)}-${keeper.title || "episode"}`
  );
  const collisions = await ctx.db
    .query("episodes")
    .withIndex("by_normalizedSlug", (q) => q.eq("normalizedSlug", slug))
    .take(3);
  if (collisions.some((r) => r._id !== keeperId && r._id !== donorId))
    conflict("Unsuffixed slug is occupied by an unrelated episode.");
  const snapshotJson = canonicalJson({
    policy: "merge-v1-no-redirects-regenerate-slug",
    keeper,
    donor,
    keeperRelations,
    donorRelations,
    transcript,
    passages,
    patch,
    slug,
  });
  if (new TextEncoder().encode(snapshotJson).length > 750_000)
    conflict("Backup preview exceeds the supported byte bound.");
  return {
    keeper,
    donor,
    keeperRelations,
    donorRelations,
    transcript,
    patch,
    slug,
    snapshotJson,
    fingerprint: hash(snapshotJson),
  };
}
