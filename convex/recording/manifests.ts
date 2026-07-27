import { v } from "convex/values";

import {
  recordingMutation,
  recordingQuery,
} from "../functions.js";
import { domainError } from "../lib/errors.js";
import {
  requireRecordingOwner,
  requireRecordingParticipant,
} from "./access.js";
import {
  requireBoundedPayload,
  requireDisplayName,
  requireEpisodeLabel,
  requireRecordingTimestamp,
} from "./validators.js";

const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_MANIFEST_HOSTS = 12;

const manifestValidator = v.object({
  publicSessionId: v.string(),
  episode: v.string(),
  date: v.string(),
  hosts: v.array(v.string()),
  manifestVersion: v.string(),
  manifest: v.any(),
  updatedAt: v.number(),
});

function requirePlainDate(value: string): string {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    domainError(
      "VALIDATION_FAILED",
      "Recording manifest dates must use YYYY-MM-DD.",
    );
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Recording manifest dates must be real calendar dates.",
    );
  }
  return normalized;
}

function requireManifestVersion(value: string): string {
  const normalized = value.trim().normalize("NFKC");
  if (
    normalized.length < 1 ||
    normalized.length > 40 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(normalized)
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Recording manifest versions must be bounded portable identifiers.",
    );
  }
  return normalized;
}

export const save = recordingMutation({
  args: {
    publicSessionId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
    episode: v.string(),
    date: v.string(),
    hosts: v.array(v.string()),
    manifestVersion: v.string(),
    manifest: v.any(),
    updatedAt: v.number(),
  },
  returns: v.id("recordingSessionManifests"),
  handler: async (ctx, args) => {
    const participant = await requireRecordingOwner(ctx, args);
    const session = await ctx.db.get(
      "recordingSessions",
      participant.sessionId,
    );
    if (session === null) {
      domainError(
        "CONFLICT",
        "The recording session is unavailable.",
      );
    }
    const episode = requireEpisodeLabel(args.episode);
    if (episode !== session.episodeLabel) {
      domainError(
        "CONFLICT",
        "The recording manifest episode does not match the session.",
      );
    }
    if (
      args.hosts.length < 1 ||
      args.hosts.length > MAX_MANIFEST_HOSTS
    ) {
      domainError(
        "VALIDATION_FAILED",
        `Recording manifests must contain 1 through ${String(MAX_MANIFEST_HOSTS)} hosts.`,
      );
    }
    const hosts = args.hosts.map(requireDisplayName);
    if (new Set(hosts).size !== hosts.length) {
      domainError(
        "VALIDATION_FAILED",
        "Recording manifest hosts cannot contain duplicates.",
      );
    }
    requireBoundedPayload(
      args.manifest,
      "Recording manifest",
      MAX_MANIFEST_BYTES,
    );
    const manifest: unknown = args.manifest;
    const document = {
      publicSessionId: session.publicId,
      episode,
      date: requirePlainDate(args.date),
      hosts,
      manifestVersion: requireManifestVersion(
        args.manifestVersion,
      ),
      manifest,
      updatedAt: requireRecordingTimestamp(
        args.updatedAt,
        "Recording manifest update time",
      ),
    };
    const existing = await ctx.db
      .query("recordingSessionManifests")
      .withIndex("by_publicSessionId", (query) =>
        query.eq("publicSessionId", session.publicId),
      )
      .take(2);
    if (existing.length > 1) {
      domainError(
        "CONFLICT",
        "The recording session has multiple manifests.",
      );
    }
    const current = existing.at(0);
    if (current !== undefined) {
      await ctx.db.patch(
        "recordingSessionManifests",
        current._id,
        document,
      );
      return current._id;
    }
    return await ctx.db.insert(
      "recordingSessionManifests",
      document,
    );
  },
});

export const getBySession = recordingQuery({
  args: {
    publicSessionId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
  },
  returns: v.union(manifestValidator, v.null()),
  handler: async (ctx, args) => {
    const participant = await requireRecordingParticipant(
      ctx,
      args,
    );
    const manifests = await ctx.db
      .query("recordingSessionManifests")
      .withIndex("by_publicSessionId", (query) =>
        query.eq(
          "publicSessionId",
          participant.publicSessionId,
        ),
      )
      .take(2);
    if (manifests.length > 1) {
      domainError(
        "CONFLICT",
        "The recording session has multiple manifests.",
      );
    }
    const saved = manifests.at(0);
    if (saved === undefined) {
      return null;
    }
    requireBoundedPayload(
      saved.manifest,
      "Stored recording manifest",
      MAX_MANIFEST_BYTES,
    );
    const manifest: unknown = saved.manifest;
    return {
      publicSessionId: saved.publicSessionId,
      episode: saved.episode,
      date: saved.date,
      hosts: saved.hosts,
      manifestVersion: saved.manifestVersion,
      manifest,
      updatedAt: saved.updatedAt,
    };
  },
});
