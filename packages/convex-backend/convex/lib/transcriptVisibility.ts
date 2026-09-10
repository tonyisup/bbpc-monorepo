import type { MutationCtx } from "../_generated/server.js";
import type { Doc, Id } from "../_generated/dataModel.js";
import { MAX_TRANSCRIPT_PASSAGES } from "./transcriptModel.js";
import { domainError } from "./errors.js";

export function isPublishedEpisode(episode: Doc<"episodes"> | null): boolean {
  return (
    episode !== null &&
    ["published", "Published"].includes(episode.status ?? "")
  );
}

export async function episodePassages(
  ctx: MutationCtx,
  episodeId: Id<"episodes">
) {
  const passages = await ctx.db
    .query("transcriptPassages")
    .withIndex("by_episodeId_and_sequence", (q) => q.eq("episodeId", episodeId))
    .take(MAX_TRANSCRIPT_PASSAGES + 1);
  if (passages.length > MAX_TRANSCRIPT_PASSAGES)
    domainError("CONFLICT", "Transcript exceeds the atomic replacement limit.");
  return passages;
}

export async function syncTranscriptVisibility(
  ctx: MutationCtx,
  episodeId: Id<"episodes">,
  episode: Doc<"episodes"> | null
) {
  const passages = await episodePassages(ctx, episodeId);
  for (const passage of passages) {
    if (episode === null)
      await ctx.db.delete("transcriptPassages", passage._id);
    else
      await ctx.db.patch("transcriptPassages", passage._id, {
        isPublic: isPublishedEpisode(episode),
      });
  }
  if (episode === null) {
    const transcript = await ctx.db
      .query("episodeTranscripts")
      .withIndex("by_episodeId", (q) => q.eq("episodeId", episodeId))
      .unique();
    if (transcript) await ctx.db.delete("episodeTranscripts", transcript._id);
  }
}
