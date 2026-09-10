import { Triggers } from "convex-helpers/server/triggers";
import type { DataModel, Doc } from "../_generated/dataModel.js";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import {
  isPublishedEpisode,
  syncTranscriptVisibility,
} from "./transcriptVisibility.js";

export const dashboardSources = [
  "users",
  "movies",
  "reviews",
  "episodes",
  "guesses",
] as const;
export type DashboardSource = (typeof dashboardSources)[number];

export async function dashboardCount(
  ctx: Pick<QueryCtx, "db">,
  key: string,
): Promise<number> {
  return (
    (
      await ctx.db
        .query("dashboardCounts")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique()
    )?.count ?? 0
  );
}
async function changeCount(ctx: MutationCtx, key: string, delta: number) {
  const existing = await ctx.db
    .query("dashboardCounts")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (existing === null)
    await ctx.db.insert("dashboardCounts", { key, count: delta });
  else
    await ctx.db.patch("dashboardCounts", existing._id, {
      count: existing.count + delta,
    });
}

// Membership makes backfill replay safe and allows normal writes/deletes while it runs.
export async function syncDashboardMember(
  ctx: MutationCtx,
  sourceId: string,
  key: string | null,
): Promise<void> {
  const existing = await ctx.db
    .query("dashboardCountMembers")
    .withIndex("by_sourceId", (q) => q.eq("sourceId", sourceId))
    .unique();
  if (existing?.key === key) return;
  if (existing !== null) {
    await changeCount(ctx, existing.key, -1);
    await ctx.db.delete("dashboardCountMembers", existing._id);
  }
  if (key !== null) {
    await changeCount(ctx, key, 1);
    await ctx.db.insert("dashboardCountMembers", { sourceId, key });
  }
}

export async function syncDashboardEpisode(
  ctx: MutationCtx,
  episodeId: Doc<"episodes">["_id"],
  episode: Doc<"episodes"> | null,
) {
  const existing = await ctx.db
    .query("dashboardEpisodes")
    .withIndex("by_episodeId", (q) => q.eq("episodeId", episodeId))
    .unique();
  if (episode === null) {
    if (existing !== null)
      await ctx.db.delete("dashboardEpisodes", existing._id);
    return;
  }
  const value = {
    episodeId,
    status: episode.status?.toLowerCase() ?? "",
    date: episode.date ?? "",
    number: episode.number,
    hasRecording: episode.recording !== undefined,
    createdAt: episode._creationTime,
  };
  if (existing === null) await ctx.db.insert("dashboardEpisodes", value);
  else await ctx.db.replace("dashboardEpisodes", existing._id, value);
}

export async function backfillDashboardDocument(
  ctx: MutationCtx,
  source: DashboardSource,
  doc: Doc<DashboardSource>,
) {
  const key =
    source === "guesses"
      ? `guesses:${(doc as Doc<"guesses">).assignmentReviewId}`
      : source;
  await syncDashboardMember(ctx, doc._id, key);
  if (source === "episodes")
    await syncDashboardEpisode(
      ctx,
      (doc as Doc<"episodes">)._id,
      doc as Doc<"episodes">,
    );
}

export const dashboardTriggers = new Triggers<DataModel>();
// Publication changes and deletion update transcript eligibility in the same transaction.
dashboardTriggers.register("episodes", async (ctx, change) => {
  if (
    change.newDoc === null ||
    isPublishedEpisode(change.oldDoc) !== isPublishedEpisode(change.newDoc)
  ) {
    await syncTranscriptVisibility(ctx, change.id, change.newDoc);
  }
});
for (const source of dashboardSources) {
  dashboardTriggers.register(source, async (ctx, change) => {
    if (change.newDoc === null) {
      await syncDashboardMember(ctx, change.id, null);
      if (source === "episodes")
        await syncDashboardEpisode(
          ctx,
          (change.oldDoc as Doc<"episodes">)._id,
          null,
        );
    } else {
      await backfillDashboardDocument(ctx, source, change.newDoc);
    }
  });
}
