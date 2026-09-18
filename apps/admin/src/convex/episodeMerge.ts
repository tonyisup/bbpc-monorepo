import { api } from "@tonyisup/bbpc-convex-api";
import { documentId } from "@tonyisup/bbpc-convex-api/contracts";
import type { ConvexReactClient } from "convex/react";
import { ConvexError } from "convex/values";
import { z } from "zod";

import { BBPC_CLIENT_API_VERSION, getConvexDomainErrorCode } from "./identity";

const snapshotEpisodeSchema = z.object({
  _id: z.string().min(1),
  number: z.number(),
  title: z.string(),
  date: z.string(),
  slug: z.string().optional(),
});
const relationshipsSchema = z.object({
  archivePosts: z.array(z.unknown()),
  assignments: z.array(z.unknown()),
  extraReviews: z.array(z.unknown()),
  episodeLinks: z.array(z.unknown()),
});
const snapshotSchema = z.object({
  keeper: snapshotEpisodeSchema,
  donor: snapshotEpisodeSchema,
  keeperRelations: relationshipsSchema,
  donorRelations: relationshipsSchema,
  transcript: z.object({ passageCount: z.number().int().nonnegative() }),
  patch: z.record(z.string()),
  slug: z.string().min(1),
});
const previewSchema = z.object({
  fingerprint: z.string().min(1),
  snapshotJson: z.string().min(1),
  slug: z.string().min(1),
});
const resultSchema = z.object({
  keeperId: z.string().min(1),
  removedId: z.string().min(1),
  slug: z.string().min(1),
});

export type EpisodeMergePreview = Awaited<
  ReturnType<typeof previewEpisodeMerge>
>;
export type EpisodeMergeResult = z.infer<typeof resultSchema>;

export async function previewEpisodeMerge(
  client: ConvexReactClient,
  keeperId: string,
  donorId: string
) {
  const preview = previewSchema.parse(
    await client.query(api.episodes.admin.previewDuplicateMerge, {
      keeperId: documentId("episodes", keeperId),
      donorId: documentId("episodes", donorId),
    })
  );
  const snapshot = snapshotSchema.parse(JSON.parse(preview.snapshotJson));
  if (
    snapshot.keeper._id !== keeperId ||
    snapshot.donor._id !== donorId ||
    snapshot.slug !== preview.slug
  ) {
    throw new Error("Merge preview does not match the requested episodes.");
  }
  // Keep the original JSON intact for private export, including all child rows.
  return { ...preview, snapshot };
}

export async function mergeDuplicateEpisode(
  client: ConvexReactClient,
  preview: EpisodeMergePreview,
  backupReceipt: string
): Promise<EpisodeMergeResult> {
  return resultSchema.parse(
    await client.mutation(api.episodes.admin.mergeDuplicateEpisode, {
      keeperId: documentId("episodes", preview.snapshot.keeper._id),
      donorId: documentId("episodes", preview.snapshot.donor._id),
      expectedFingerprint: preview.fingerprint,
      backupReceipt: backupReceipt.trim(),
      confirmation: "MERGE_WITHOUT_REDIRECTS_AND_REBUILD_SLUG",
      clientApiVersion: BBPC_CLIENT_API_VERSION,
    })
  );
}

export function episodeMergeError(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "WRITE_DISABLED":
      return "Episode changes are paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    case "CONFLICT":
    case "VALIDATION_FAILED": {
      const data = z
        .object({ message: z.string() })
        .safeParse(error instanceof ConvexError ? error.data : null);
      if (data.success) return data.data.message;
      break;
    }
    case "FORBIDDEN":
    case "AUTHENTICATION_REQUIRED":
      return "Sign in as an administrator to merge episodes.";
  }
  return "The merge request could not be completed. Check the episode IDs and connection.";
}
