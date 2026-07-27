import { v } from "convex/values";

import {
  recordingMutation,
  recordingQuery,
} from "../functions.js";
import { domainError } from "../lib/errors.js";
import { requireRecordingParticipant } from "./access.js";
import {
  requireEpisodeLabel,
  requireRecordingTimestamp,
} from "./validators.js";

const MAX_RECORDINGS_PER_SESSION = 100;
const MAX_RECORDING_BYTES = 100 * 1024 * 1024;
const MAX_BLOB_NAME_LENGTH = 1_024;
const MAX_CONTENT_TYPE_LENGTH = 100;

const recordingUploadValidator = v.object({
  id: v.id("recordingUploads"),
  publicSessionId: v.union(v.string(), v.null()),
  episode: v.string(),
  hostName: v.string(),
  trackType: v.union(v.literal("mic"), v.literal("sounders")),
  startedAt: v.number(),
  blobName: v.string(),
  url: v.string(),
  size: v.number(),
  contentType: v.string(),
  uploadedAt: v.number(),
});

function requireBoundedText(
  value: string,
  label: string,
  maximumLength: number,
): string {
  const normalized = value.trim().normalize("NFKC");
  if (
    normalized.length < 1 ||
    normalized.length > maximumLength
  ) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must contain 1 through ${String(maximumLength)} characters.`,
    );
  }
  return normalized;
}

function requireHttpsUrl(value: string): string {
  const normalized = requireBoundedText(
    value,
    "Recording URL",
    2_048,
  );
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    domainError(
      "VALIDATION_FAILED",
      "Recording URLs must use HTTPS.",
    );
  }
  if (parsed.protocol !== "https:") {
    domainError(
      "VALIDATION_FAILED",
      "Recording URLs must use HTTPS.",
    );
  }
  return parsed.toString();
}

function requireRecordingSize(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_RECORDING_BYTES
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Recording uploads must contain 1 through ${String(MAX_RECORDING_BYTES)} bytes.`,
    );
  }
  return value;
}

export const saveUpload = recordingMutation({
  args: {
    publicSessionId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
    episode: v.string(),
    hostName: v.string(),
    trackType: v.union(
      v.literal("mic"),
      v.literal("sounders"),
    ),
    startedAt: v.number(),
    blobName: v.string(),
    url: v.string(),
    size: v.number(),
    contentType: v.string(),
    uploadedAt: v.number(),
  },
  returns: v.id("recordingUploads"),
  handler: async (ctx, args) => {
    const participant = await requireRecordingParticipant(
      ctx,
      args,
    );
    const session = await ctx.db.get(
      "recordingSessions",
      participant.sessionId,
    );
    if (
      session?.publicId !== participant.publicSessionId
    ) {
      domainError(
        "CONFLICT",
        "The recording participant has an invalid session relationship.",
      );
    }
    const episode = requireEpisodeLabel(args.episode);
    if (episode !== session.episodeLabel) {
      domainError(
        "CONFLICT",
        "The recording upload episode does not match the session.",
      );
    }
    const hostName = participant.displayName;
    if (requireBoundedText(args.hostName, "Host name", 80) !== hostName) {
      domainError(
        "CONFLICT",
        "The recording upload host does not match the participant.",
      );
    }
    const blobName = requireBoundedText(
      args.blobName,
      "Recording blob name",
      MAX_BLOB_NAME_LENGTH,
    );
    const upload = {
      publicSessionId: session.publicId,
      episode,
      hostName,
      trackType: args.trackType,
      startedAt: requireRecordingTimestamp(
        args.startedAt,
        "Recording start time",
      ),
      blobName,
      url: requireHttpsUrl(args.url),
      size: requireRecordingSize(args.size),
      contentType: requireBoundedText(
        args.contentType,
        "Recording content type",
        MAX_CONTENT_TYPE_LENGTH,
      ),
      uploadedAt: requireRecordingTimestamp(
        args.uploadedAt,
        "Recording upload time",
      ),
    };
    const existing = await ctx.db
      .query("recordingUploads")
      .withIndex("by_blobName", (query) =>
        query.eq("blobName", blobName),
      )
      .take(2);
    if (existing.length > 1) {
      domainError(
        "CONFLICT",
        "The recording blob name is ambiguous.",
      );
    }
    const current = existing.at(0);
    if (current !== undefined) {
      if (current.publicSessionId !== session.publicId) {
        domainError(
          "CONFLICT",
          "The recording upload belongs to a different session.",
        );
      }
      await ctx.db.patch(
        "recordingUploads",
        current._id,
        upload,
      );
      return current._id;
    }
    const capacity = await ctx.db
      .query("recordingUploads")
      .withIndex("by_publicSessionId", (query) =>
        query.eq("publicSessionId", session.publicId),
      )
      .take(MAX_RECORDINGS_PER_SESSION);
    if (capacity.length >= MAX_RECORDINGS_PER_SESSION) {
      domainError(
        "CONFLICT",
        "The recording session has reached its upload limit.",
        {
          details: {
            limit: MAX_RECORDINGS_PER_SESSION,
          },
        },
      );
    }
    return await ctx.db.insert("recordingUploads", upload);
  },
});

export const listBySession = recordingQuery({
  args: {
    publicSessionId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
  },
  returns: v.array(recordingUploadValidator),
  handler: async (ctx, args) => {
    const participant = await requireRecordingParticipant(
      ctx,
      args,
    );
    const uploads = await ctx.db
      .query("recordingUploads")
      .withIndex("by_publicSessionId", (query) =>
        query.eq(
          "publicSessionId",
          participant.publicSessionId,
        ),
      )
      .take(MAX_RECORDINGS_PER_SESSION + 1);
    if (uploads.length > MAX_RECORDINGS_PER_SESSION) {
      domainError(
        "CONFLICT",
        "The recording session exceeds its upload limit.",
        {
          details: {
            limit: MAX_RECORDINGS_PER_SESSION,
          },
        },
      );
    }
    return uploads
      .sort(
        (left, right) =>
          left.startedAt - right.startedAt ||
          left.hostName.localeCompare(right.hostName),
      )
      .map((upload) => ({
        id: upload._id,
        publicSessionId:
          upload.publicSessionId ?? null,
        episode: upload.episode,
        hostName: upload.hostName,
        trackType: upload.trackType,
        startedAt: upload.startedAt,
        blobName: upload.blobName,
        url: upload.url,
        size: upload.size,
        contentType: upload.contentType,
        uploadedAt: upload.uploadedAt,
      }));
  },
});
