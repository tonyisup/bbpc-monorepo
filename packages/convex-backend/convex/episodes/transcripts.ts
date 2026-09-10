import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { v } from "convex/values";
import {
  anonymousQuery,
  pipelineMutation,
  pipelineQuery,
} from "../functions.js";
import { requireServicePermission } from "../lib/actors.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  TRANSCRIPT_VERSION,
  transcriptFingerprintInput,
  validatePassages,
  validateTranscriptQuery,
  transcriptTerms,
} from "../lib/transcriptModel.js";
import type { MutationCtx } from "../_generated/server.js";
import type { Id } from "../_generated/dataModel.js";
import { hydrateEpisode } from "./readModel.js";
import { episodeDetailValidator } from "./validators.js";
import {
  episodePassages,
  isPublishedEpisode,
} from "../lib/transcriptVisibility.js";

const passageValidator = v.object({
  start: v.number(),
  end: v.number(),
  text: v.string(),
});

export const inspect = pipelineQuery({
  args: { episodeId: v.id("episodes") },
  returns: v.object({
    hash: v.union(v.string(), v.null()),
    number: v.number(),
    title: v.string(),
  }),
  handler: async (ctx, { episodeId }) => {
    requireServicePermission(ctx.actor, "pipeline:publish");
    const episode = await ctx.db.get("episodes", episodeId);
    if (!episode)
      domainError("NOT_FOUND", "The transcript episode does not exist.");
    const current = await ctx.db
      .query("episodeTranscripts")
      .withIndex("by_episodeId", (q) => q.eq("episodeId", episodeId))
      .unique();
    return {
      hash: current?.hash ?? null,
      number: episode.number,
      title: episode.title,
    };
  },
});

async function clearPassages(ctx: MutationCtx, episodeId: Id<"episodes">) {
  const old = await episodePassages(ctx, episodeId);
  for (const passage of old)
    await ctx.db.delete("transcriptPassages", passage._id);
}

export const replace = pipelineMutation({
  args: {
    episodeId: v.id("episodes"),
    expectedHash: v.union(v.string(), v.null()),
    complete: v.literal(true),
    passages: v.array(passageValidator),
  },
  returns: v.object({
    hash: v.string(),
    passageCount: v.number(),
    changed: v.boolean(),
  }),
  handler: async (ctx, args) => {
    requireServicePermission(ctx.actor, "pipeline:publish");
    const episode = await ctx.db.get("episodes", args.episodeId);
    if (!episode)
      domainError("NOT_FOUND", "The transcript episode does not exist.");
    let passages;
    try {
      passages = validatePassages(args.passages);
    } catch (error) {
      domainError(
        "VALIDATION_FAILED",
        error instanceof Error ? error.message : "Invalid transcript."
      );
    }
    const hash = bytesToHex(
      sha256(new TextEncoder().encode(transcriptFingerprintInput(passages)))
    );
    const current = await ctx.db
      .query("episodeTranscripts")
      .withIndex("by_episodeId", (q) => q.eq("episodeId", args.episodeId))
      .unique();
    if (current?.hash === hash)
      return { hash, passageCount: passages.length, changed: false };
    if ((current?.hash ?? null) !== args.expectedHash)
      domainError(
        "CONFLICT",
        "Transcript changed since inspection. Inspect before retrying."
      );
    // One bounded transaction: <=400 deletes + 400 inserts + metadata + audit.
    // <=512 KiB of passage text per generation. No staged or stale search rows.
    await clearPassages(ctx, args.episodeId);
    for (const [sequence, passage] of passages.entries()) {
      await ctx.db.insert("transcriptPassages", {
        episodeId: args.episodeId,
        isPublic: isPublishedEpisode(episode),
        hash,
        sequence,
        ...passage,
      });
    }
    const metadata = {
      episodeId: args.episodeId,
      hash,
      version: TRANSCRIPT_VERSION,
      passageCount: passages.length,
      updatedAt: Date.now(),
    };
    if (current)
      await ctx.db.replace("episodeTranscripts", current._id, metadata);
    else await ctx.db.insert("episodeTranscripts", metadata);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "pipeline.transcriptReplaced",
      targetType: "episode",
      targetId: args.episodeId,
      metadata: { hash, passageCount: passages.length },
    });
    return { hash, passageCount: passages.length, changed: true };
  },
});

export const remove = pipelineMutation({
  args: { episodeId: v.id("episodes"), expectedHash: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServicePermission(ctx.actor, "pipeline:publish");
    const current = await ctx.db
      .query("episodeTranscripts")
      .withIndex("by_episodeId", (q) => q.eq("episodeId", args.episodeId))
      .unique();
    if (!current) return null;
    if (current.hash !== args.expectedHash)
      domainError("CONFLICT", "Transcript changed since inspection.");
    await clearPassages(ctx, args.episodeId);
    await ctx.db.delete("episodeTranscripts", current._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "pipeline.transcriptRemoved",
      targetType: "episode",
      targetId: args.episodeId,
    });
    return null;
  },
});

export const search = anonymousQuery({
  args: { query: v.string() },
  returns: v.object({
    results: v.array(
      v.object({
        episode: episodeDetailValidator,
        passages: v.array(passageValidator),
      })
    ),
    limited: v.boolean(),
  }),
  handler: async (ctx, args) => {
    let query;
    try {
      query = validateTranscriptQuery(args.query);
    } catch (error) {
      domainError(
        "VALIDATION_FAILED",
        error instanceof Error ? error.message : "Invalid query."
      );
    }
    if (query.length < 2 || !transcriptTerms(query).length)
      return { results: [], limited: false };
    const matches = await ctx.db
      .query("transcriptPassages")
      .withSearchIndex("search_text", (q) =>
        q.search("text", query).eq("isPublic", true)
      )
      .take(100);
    const groups = new Map<Id<"episodes">, typeof matches>();
    for (const match of matches) {
      const group = groups.get(match.episodeId) ?? [];
      group.push(match);
      groups.set(match.episodeId, group);
    }
    let limited = matches.length === 100;
    const results = [];
    for (const [episodeId, passages] of groups) {
      const episode = await ctx.db.get("episodes", episodeId);
      // Read canonical visibility on every request, including after unpublish/delete.
      if (
        !episode ||
        !["published", "Published"].includes(episode.status ?? "")
      )
        continue;
      if (results.length === 20) {
        limited = true;
        break;
      }
      const selected: typeof passages = [];
      for (const passage of passages) {
        // Keep the most relevant passage for overlapping source intervals.
        if (
          selected.some((p) => p.start <= passage.end && passage.start <= p.end)
        )
          continue;
        selected.push(passage);
        if (selected.length === 3) break;
      }
      results.push({
        episode: await hydrateEpisode(ctx, episode),
        passages: selected.map(({ start, end, text }) => ({
          start,
          end,
          text,
        })),
      });
    }
    return { results, limited: limited || results.length === 20 };
  },
});
