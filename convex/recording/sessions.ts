import { type Infer, v } from "convex/values";

import type { Doc } from "../_generated/dataModel.js";
import type {
  MutationCtx,
  QueryCtx,
} from "../_generated/server.js";
import {
  adminMutation,
  authenticatedMutation,
  recordingMutation,
  recordingQuery,
} from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  digestRecordingCapability,
  requireRecordingOwner,
  requireRecordingParticipant,
} from "./access.js";
import { recordingSessionEventPayload } from "./sessionEvent.js";
import {
  recordingParticipantValidator,
  recordingSessionValidator,
  requireBoundedPayload,
  requireCapabilityToken,
  requireDisplayName,
  requireEpisodeLabel,
  requirePortableId,
  requireRecordingTimestamp,
} from "./validators.js";

const MAX_SESSION_PARTICIPANTS = 12;
const MAX_SESSION_EVENTS = 2_000;
const MAX_SESSION_CHILDREN_PER_TABLE = 2_000;
const MAX_CLEANUP_BATCH = 100;

const participantInputValidator = v.object({
  clientId: v.string(),
  accessToken: v.string(),
  displayName: v.string(),
  joinedAt: v.number(),
});

const sessionLifecycleValidator = v.object({
  id: v.string(),
  episodeId: v.union(v.id("episodes"), v.null()),
  episode: v.string(),
  status: v.union(v.literal("active"), v.literal("ended")),
  createdAt: v.string(),
  endedAt: v.union(v.string(), v.null()),
});

const sessionEventResultValidator = v.object({
  eventId: v.string(),
  actorId: v.string(),
  createdAt: v.number(),
  payload: recordingSessionEventPayload,
});

const deletionResultValidator = v.object({
  sessions: v.number(),
  invites: v.number(),
  participants: v.number(),
  rtcPresence: v.number(),
  rtcSignals: v.number(),
  events: v.number(),
  manifests: v.number(),
  favorites: v.number(),
  recordings: v.number(),
});

type RecordingContext = Pick<QueryCtx | MutationCtx, "db">;

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

function toIso(value: number): string {
  return new Date(value).toISOString();
}

async function sessionByPublicId(
  ctx: RecordingContext,
  publicId: string,
): Promise<Doc<"recordingSessions"> | null> {
  const sessions = await ctx.db
    .query("recordingSessions")
    .withIndex("by_publicId", (query) =>
      query.eq("publicId", publicId),
    )
    .take(2);
  if (sessions.length > 1) {
    domainError(
      "CONFLICT",
      "Multiple recording sessions share the same public ID.",
    );
  }
  return sessions.at(0) ?? null;
}

async function participantsForSession(
  ctx: RecordingContext,
  publicSessionId: string,
): Promise<Array<Doc<"recordingParticipants">>> {
  const participants = await ctx.db
    .query("recordingParticipants")
    .withIndex("by_publicSessionId", (query) =>
      query.eq("publicSessionId", publicSessionId),
    )
    .take(MAX_SESSION_PARTICIPANTS + 1);
  if (participants.length > MAX_SESSION_PARTICIPANTS) {
    domainError(
      "CONFLICT",
      "The recording session exceeds its participant limit.",
      { details: { limit: MAX_SESSION_PARTICIPANTS } },
    );
  }
  return participants;
}

function toParticipant(
  participant: Doc<"recordingParticipants">,
) {
  return {
    clientId: participant.clientId,
    displayName: participant.displayName,
    role: participant.role,
    joinedAt: toIso(participant.joinedAt),
  };
}

async function toSession(
  ctx: RecordingContext,
  session: Doc<"recordingSessions">,
) {
  const participants = await participantsForSession(
    ctx,
    session.publicId,
  );
  return {
    id: session.publicId,
    episodeId: nullable(session.episodeId),
    episode: session.episodeLabel,
    createdAt: toIso(session.createdAt),
    endedAt:
      session.endedAt === undefined
        ? null
        : toIso(session.endedAt),
    status: session.status,
    participants: participants.map(toParticipant),
  };
}

async function requireSessionForParticipant(
  ctx: RecordingContext,
  participant: Doc<"recordingParticipants">,
): Promise<Doc<"recordingSessions">> {
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
  return session;
}

async function validateEpisodeId(
  ctx: RecordingContext,
  episodeId: Doc<"episodes">["_id"] | null | undefined,
): Promise<Doc<"episodes">["_id"] | undefined> {
  if (episodeId === null || episodeId === undefined) {
    return undefined;
  }
  const episode = await ctx.db.get("episodes", episodeId);
  if (episode === null) {
    domainError(
      "NOT_FOUND",
      "The selected canonical episode is unavailable.",
    );
  }
  return episode._id;
}

export const createSession = authenticatedMutation({
  args: {
    publicId: v.string(),
    inviteToken: v.string(),
    episodeId: v.optional(v.id("episodes")),
    episode: v.string(),
    createdAt: v.number(),
    participant: participantInputValidator,
  },
  returns: recordingSessionValidator,
  handler: async (ctx, args) => {
    if (!ctx.actor.isHost && !ctx.actor.isAdmin) {
      domainError(
        "FORBIDDEN",
        "Host or administrator access is required to create a recording session.",
      );
    }
    const publicId = requirePortableId(
      args.publicId,
      "Recording session ID",
    );
    const inviteToken = requireCapabilityToken(
      args.inviteToken,
      "Recording invite token",
    );
    const episodeLabel = requireEpisodeLabel(args.episode);
    const createdAt = requireRecordingTimestamp(
      args.createdAt,
      "Recording session creation time",
    );
    const clientId = requirePortableId(
      args.participant.clientId,
      "Recording client ID",
    );
    const accessToken = requireCapabilityToken(
      args.participant.accessToken,
      "Recording access token",
    );
    const displayName = requireDisplayName(
      args.participant.displayName,
    );
    const joinedAt = requireRecordingTimestamp(
      args.participant.joinedAt,
      "Recording participant join time",
    );
    const episodeId = await validateEpisodeId(
      ctx,
      args.episodeId,
    );
    if ((await sessionByPublicId(ctx, publicId)) !== null) {
      domainError(
        "CONFLICT",
        "The recording session ID is already in use.",
      );
    }
    const inviteDigest =
      digestRecordingCapability(inviteToken);
    const inviteMatches = await ctx.db
      .query("recordingSessionInvites")
      .withIndex("by_tokenDigest", (query) =>
        query.eq("tokenDigest", inviteDigest),
      )
      .take(1);
    if (inviteMatches.length > 0) {
      domainError(
        "CONFLICT",
        "The recording invite token is already in use.",
      );
    }
    const sessionId = await ctx.db.insert(
      "recordingSessions",
      {
        publicId,
        episodeLabel,
        ownerUserId: ctx.actor.user._id,
        status: "active",
        createdAt,
        ...(episodeId === undefined ? {} : { episodeId }),
      },
    );
    await ctx.db.insert("recordingSessionInvites", {
      tokenDigest: inviteDigest,
      sessionId,
      publicSessionId: publicId,
      createdAt,
    });
    await ctx.db.insert("recordingParticipants", {
      sessionId,
      publicSessionId: publicId,
      userId: ctx.actor.user._id,
      clientId,
      accessTokenDigest:
        digestRecordingCapability(accessToken),
      displayName,
      role: "owner",
      joinedAt,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "recording.session.created",
      targetType: "recordingSession",
      targetId: sessionId,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: {
        hasCanonicalEpisode: episodeId !== undefined,
      },
    });
    const session = await ctx.db.get(
      "recordingSessions",
      sessionId,
    );
    if (session === null) {
      domainError(
        "CONFLICT",
        "The recording session was not persisted.",
      );
    }
    return await toSession(ctx, session);
  },
});

export const joinSessionByInviteToken = recordingMutation({
  args: {
    inviteToken: v.string(),
    participant: participantInputValidator,
  },
  returns: v.union(recordingSessionValidator, v.null()),
  handler: async (ctx, args) => {
    const inviteToken = requireCapabilityToken(
      args.inviteToken,
      "Recording invite token",
    );
    const clientId = requirePortableId(
      args.participant.clientId,
      "Recording client ID",
    );
    const accessToken = requireCapabilityToken(
      args.participant.accessToken,
      "Recording access token",
    );
    const displayName = requireDisplayName(
      args.participant.displayName,
    );
    const joinedAt = requireRecordingTimestamp(
      args.participant.joinedAt,
      "Recording participant join time",
    );
    const invites = await ctx.db
      .query("recordingSessionInvites")
      .withIndex("by_tokenDigest", (query) =>
        query.eq(
          "tokenDigest",
          digestRecordingCapability(inviteToken),
        ),
      )
      .take(2);
    if (invites.length > 1) {
      domainError(
        "CONFLICT",
        "The recording invite token is ambiguous.",
      );
    }
    const invite = invites.at(0);
    if (invite === undefined) {
      return null;
    }
    const session = await ctx.db.get(
      "recordingSessions",
      invite.sessionId,
    );
    if (
      session?.publicId !== invite.publicSessionId ||
      session.status !== "active"
    ) {
      return null;
    }
    const participants = await participantsForSession(
      ctx,
      session.publicId,
    );
    const existing = participants.find(
      (participant) => participant.clientId === clientId,
    );
    const accessTokenDigest =
      digestRecordingCapability(accessToken);
    if (existing !== undefined) {
      if (
        existing.accessTokenDigest !== accessTokenDigest ||
        existing.displayName !== displayName
      ) {
        domainError(
          "CONFLICT",
          "The recording client ID is already in use.",
        );
      }
      return await toSession(ctx, session);
    }
    if (participants.length >= MAX_SESSION_PARTICIPANTS) {
      domainError(
        "CONFLICT",
        "The recording session has reached its participant limit.",
        { details: { limit: MAX_SESSION_PARTICIPANTS } },
      );
    }
    await ctx.db.insert("recordingParticipants", {
      sessionId: session._id,
      publicSessionId: session.publicId,
      clientId,
      accessTokenDigest,
      displayName,
      role: "participant",
      joinedAt,
    });
    return await toSession(ctx, session);
  },
});

export const getSession = recordingQuery({
  args: {
    publicId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
  },
  returns: v.union(recordingSessionValidator, v.null()),
  handler: async (ctx, args) => {
    const participant = await requireRecordingParticipant(
      ctx,
      {
        publicSessionId: args.publicId,
        clientId: args.clientId,
        accessToken: args.accessToken,
      },
    );
    const session = await requireSessionForParticipant(
      ctx,
      participant,
    );
    return await toSession(ctx, session);
  },
});

export const getSessionLifecycle = recordingQuery({
  args: {
    publicId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
  },
  returns: v.union(sessionLifecycleValidator, v.null()),
  handler: async (ctx, args) => {
    const participant = await requireRecordingParticipant(
      ctx,
      {
        publicSessionId: args.publicId,
        clientId: args.clientId,
        accessToken: args.accessToken,
      },
    );
    const session = await requireSessionForParticipant(
      ctx,
      participant,
    );
    return {
      id: session.publicId,
      episodeId: nullable(session.episodeId),
      episode: session.episodeLabel,
      status: session.status,
      createdAt: toIso(session.createdAt),
      endedAt:
        session.endedAt === undefined
          ? null
          : toIso(session.endedAt),
    };
  },
});

export const getParticipantForGrant = recordingQuery({
  args: {
    publicId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
  },
  returns: v.union(recordingParticipantValidator, v.null()),
  handler: async (ctx, args) => {
    const participant = await requireRecordingParticipant(
      ctx,
      {
        publicSessionId: args.publicId,
        clientId: args.clientId,
        accessToken: args.accessToken,
      },
    );
    await requireSessionForParticipant(ctx, participant);
    return toParticipant(participant);
  },
});

export const updateParticipantDisplayName =
  recordingMutation({
    args: {
      publicId: v.string(),
      clientId: v.string(),
      accessToken: v.string(),
      displayName: v.string(),
    },
    returns: recordingParticipantValidator,
    handler: async (ctx, args) => {
      const participant =
        await requireRecordingParticipant(ctx, {
          publicSessionId: args.publicId,
          clientId: args.clientId,
          accessToken: args.accessToken,
        });
      await requireSessionForParticipant(ctx, participant);
      const displayName = requireDisplayName(
        args.displayName,
      );
      await ctx.db.patch(
        "recordingParticipants",
        participant._id,
        { displayName },
      );
      return toParticipant({
        ...participant,
        displayName,
      });
    },
  });

export const updateSessionEpisode = recordingMutation({
  args: {
    publicId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
    episodeId: v.optional(
      v.union(v.id("episodes"), v.null()),
    ),
    episode: v.string(),
  },
  returns: sessionLifecycleValidator,
  handler: async (ctx, args) => {
    const participant = await requireRecordingOwner(ctx, {
      publicSessionId: args.publicId,
      clientId: args.clientId,
      accessToken: args.accessToken,
    });
    const session = await requireSessionForParticipant(
      ctx,
      participant,
    );
    if (session.status !== "active") {
      domainError(
        "CONFLICT",
        "The recording session has ended.",
      );
    }
    const episodeLabel = requireEpisodeLabel(args.episode);
    const episodeId = await validateEpisodeId(
      ctx,
      args.episodeId,
    );
    await ctx.db.patch("recordingSessions", session._id, {
      episodeLabel,
      episodeId,
    });
    return {
      id: session.publicId,
      episodeId: nullable(episodeId),
      episode: episodeLabel,
      status: session.status,
      createdAt: toIso(session.createdAt),
      endedAt: null,
    };
  },
});

export const endSession = recordingMutation({
  args: {
    publicId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
  },
  returns: sessionLifecycleValidator,
  handler: async (ctx, args) => {
    const participant = await requireRecordingOwner(ctx, {
      publicSessionId: args.publicId,
      clientId: args.clientId,
      accessToken: args.accessToken,
    });
    const session = await requireSessionForParticipant(
      ctx,
      participant,
    );
    if (session.status === "ended") {
      return {
        id: session.publicId,
        episodeId: nullable(session.episodeId),
        episode: session.episodeLabel,
        status: "ended" as const,
        createdAt: toIso(session.createdAt),
        endedAt:
          session.endedAt === undefined
            ? null
            : toIso(session.endedAt),
      };
    }
    const endedAt = Date.now();
    await ctx.db.patch("recordingSessions", session._id, {
      status: "ended" as const,
      endedAt,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "recording.session.ended",
      targetType: "recordingSession",
      targetId: session._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return {
      id: session.publicId,
      episodeId: nullable(session.episodeId),
      episode: session.episodeLabel,
      status: "ended" as const,
      createdAt: toIso(session.createdAt),
      endedAt: toIso(endedAt),
    };
  },
});

export const listParticipants = recordingQuery({
  args: {
    publicId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
  },
  returns: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const participant = await requireRecordingParticipant(
      ctx,
      {
        publicSessionId: args.publicId,
        clientId: args.clientId,
        accessToken: args.accessToken,
      },
    );
    const session = await requireSessionForParticipant(
      ctx,
      participant,
    );
    const participants = await participantsForSession(
      ctx,
      session.publicId,
    );
    return participants.map((candidate) => ({
      id: candidate.clientId,
      name: candidate.displayName,
    }));
  },
});

export const appendSessionEvent = recordingMutation({
  args: {
    publicId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
    eventId: v.string(),
    createdAt: v.number(),
    payload: recordingSessionEventPayload,
  },
  returns: v.id("recordingSessionEvents"),
  handler: async (ctx, args) => {
    const participant = await requireRecordingParticipant(
      ctx,
      {
        publicSessionId: args.publicId,
        clientId: args.clientId,
        accessToken: args.accessToken,
      },
    );
    const session = await requireSessionForParticipant(
      ctx,
      participant,
    );
    const eventId = requirePortableId(
      args.eventId,
      "Recording event ID",
      160,
    );
    const createdAt = requireRecordingTimestamp(
      args.createdAt,
      "Recording event time",
    );
    requireBoundedPayload(
      args.payload,
      "Recording event payload",
      32_768,
    );
    const payload = args.payload;
    const isTerminalRecordingEvent =
      payload.kind === "recording-left" ||
      payload.kind === "recording-stopped";
    const isOwnerEvent =
      payload.kind === "recording-started" ||
      payload.kind === "recording-stopped" ||
      payload.kind === "episode-update";
    if (isOwnerEvent && participant.role !== "owner") {
      domainError(
        "FORBIDDEN",
        "Only the recording session owner can publish this event.",
      );
    }
    if (
      (payload.kind === "recording-started" &&
        payload.participant?.clientId !== undefined &&
        payload.participant.clientId !==
          participant.clientId) ||
      (payload.kind === "recording-stopped" &&
        payload.participant?.clientId !== undefined &&
        payload.participant.clientId !==
          participant.clientId) ||
      (payload.kind === "recording-joined" &&
        payload.participant.clientId !==
          participant.clientId) ||
      (payload.kind === "recording-left" &&
        payload.participant.clientId !==
          participant.clientId) ||
      (payload.kind === "audio-joined" &&
        payload.participant.clientId !==
          participant.clientId) ||
      (payload.kind === "audio-left" &&
        payload.participant.clientId !==
          participant.clientId) ||
      (payload.kind === "audio-disconnect-started" &&
        payload.disconnect.clientId !==
          participant.clientId) ||
      (payload.kind === "audio-disconnect-ended" &&
        payload.disconnect.clientId !==
          participant.clientId)
    ) {
      domainError(
        "FORBIDDEN",
        "The recording event participant does not match the caller.",
      );
    }
    if (
      (payload.kind === "recording-joined" ||
        payload.kind === "audio-joined") &&
      payload.participant.role !== participant.role
    ) {
      domainError(
        "FORBIDDEN",
        "The recording event role does not match the caller.",
      );
    }
    if (
      session.status !== "active" &&
      !isTerminalRecordingEvent
    ) {
      domainError(
        "CONFLICT",
        "The recording session has ended.",
      );
    }
    const existing = await ctx.db
      .query("recordingSessionEvents")
      .withIndex("by_eventId", (query) =>
        query.eq("eventId", eventId),
      )
      .take(2);
    if (existing.length > 1) {
      domainError(
        "CONFLICT",
        "The recording event ID is ambiguous.",
      );
    }
    const duplicate = existing.at(0);
    if (duplicate !== undefined) {
      if (
        duplicate.publicSessionId !== session.publicId ||
        duplicate.actorId !== participant.clientId
      ) {
        domainError(
          "CONFLICT",
          "The recording event ID is already in use.",
        );
      }
      return duplicate._id;
    }
    const capacity = await ctx.db
      .query("recordingSessionEvents")
      .withIndex("by_publicSessionId", (query) =>
        query.eq("publicSessionId", session.publicId),
      )
      .take(MAX_SESSION_EVENTS);
    if (capacity.length >= MAX_SESSION_EVENTS) {
      domainError(
        "CONFLICT",
        "The recording session has reached its event limit.",
        { details: { limit: MAX_SESSION_EVENTS } },
      );
    }
    return await ctx.db.insert(
      "recordingSessionEvents",
      {
        publicSessionId: session.publicId,
        eventId,
        actorId: participant.clientId,
        createdAt,
        payload,
      },
    );
  },
});

export const listSessionEvents = recordingQuery({
  args: {
    publicId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
  },
  returns: v.array(sessionEventResultValidator),
  handler: async (ctx, args) => {
    const participant = await requireRecordingParticipant(
      ctx,
      {
        publicSessionId: args.publicId,
        clientId: args.clientId,
        accessToken: args.accessToken,
      },
    );
    const session = await requireSessionForParticipant(
      ctx,
      participant,
    );
    const events = await ctx.db
      .query("recordingSessionEvents")
      .withIndex("by_publicSessionId", (query) =>
        query.eq("publicSessionId", session.publicId),
      )
      .take(MAX_SESSION_EVENTS + 1);
    if (events.length > MAX_SESSION_EVENTS) {
      domainError(
        "CONFLICT",
        "The recording session exceeds its event limit.",
        { details: { limit: MAX_SESSION_EVENTS } },
      );
    }
    return events
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt ||
          left.eventId.localeCompare(right.eventId),
      )
      .map((event) => {
        const payload = event.payload as Infer<
          typeof recordingSessionEventPayload
        >;
        return {
          eventId: event.eventId,
          actorId: event.actorId,
          createdAt: event.createdAt,
          payload,
        };
      });
  },
});

type SessionChildTable =
  | "recordingSessionInvites"
  | "recordingParticipants"
  | "recordingSessionEvents"
  | "recordingSessionManifests"
  | "recordingSessionFavorites"
  | "recordingUploads";

async function deleteByPublicSessionId(
  ctx: MutationCtx,
  table: SessionChildTable,
  publicSessionId: string,
): Promise<number> {
  const documents = await ctx.db
    .query(table)
    .withIndex("by_publicSessionId", (query) =>
      query.eq("publicSessionId", publicSessionId),
    )
    .take(MAX_SESSION_CHILDREN_PER_TABLE + 1);
  if (
    documents.length > MAX_SESSION_CHILDREN_PER_TABLE
  ) {
    domainError(
      "CONFLICT",
      "Recording cleanup exceeded its per-table safety limit.",
      {
        details: {
          limit: MAX_SESSION_CHILDREN_PER_TABLE,
        },
      },
    );
  }
  for (const document of documents) {
    await ctx.db.delete(table, document._id);
  }
  return documents.length;
}

async function deleteRtcByPublicSessionId(
  ctx: MutationCtx,
  publicSessionId: string,
): Promise<{ rtcPresence: number; rtcSignals: number }> {
  const [presence, signals] = await Promise.all([
    ctx.db
      .query("recordingRtcPresence")
      .withIndex("by_publicSessionId", (query) =>
        query.eq("publicSessionId", publicSessionId),
      )
      .take(MAX_SESSION_CHILDREN_PER_TABLE + 1),
    ctx.db
      .query("recordingRtcSignals")
      .withIndex("by_createdAt", (query) =>
        query.eq("publicSessionId", publicSessionId),
      )
      .take(MAX_SESSION_CHILDREN_PER_TABLE + 1),
  ]);
  if (
    presence.length > MAX_SESSION_CHILDREN_PER_TABLE ||
    signals.length > MAX_SESSION_CHILDREN_PER_TABLE
  ) {
    domainError(
      "CONFLICT",
      "Recording RTC cleanup exceeded its per-table safety limit.",
      {
        details: {
          limit: MAX_SESSION_CHILDREN_PER_TABLE,
        },
      },
    );
  }
  for (const document of presence) {
    await ctx.db.delete(
      "recordingRtcPresence",
      document._id,
    );
  }
  for (const document of signals) {
    await ctx.db.delete(
      "recordingRtcSignals",
      document._id,
    );
  }
  return {
    rtcPresence: presence.length,
    rtcSignals: signals.length,
  };
}

async function deleteRecordingSession(
  ctx: MutationCtx,
  session: Doc<"recordingSessions">,
) {
  const deleted = {
    sessions: 0,
    invites: await deleteByPublicSessionId(
      ctx,
      "recordingSessionInvites",
      session.publicId,
    ),
    participants: await deleteByPublicSessionId(
      ctx,
      "recordingParticipants",
      session.publicId,
    ),
    events: await deleteByPublicSessionId(
      ctx,
      "recordingSessionEvents",
      session.publicId,
    ),
    manifests: await deleteByPublicSessionId(
      ctx,
      "recordingSessionManifests",
      session.publicId,
    ),
    favorites: await deleteByPublicSessionId(
      ctx,
      "recordingSessionFavorites",
      session.publicId,
    ),
    recordings: await deleteByPublicSessionId(
      ctx,
      "recordingUploads",
      session.publicId,
    ),
    ...(await deleteRtcByPublicSessionId(
      ctx,
      session.publicId,
    )),
  };
  await ctx.db.delete("recordingSessions", session._id);
  deleted.sessions = 1;
  return deleted;
}

export const cleanupEndedSessions = adminMutation({
  args: {
    olderThan: v.number(),
    limit: v.optional(v.number()),
    confirmation: v.literal("delete-ended-sessions"),
  },
  returns: deletionResultValidator,
  handler: async (ctx, args) => {
    const olderThan = requireRecordingTimestamp(
      args.olderThan,
      "Recording retention cutoff",
    );
    const limit = args.limit ?? 10;
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > MAX_CLEANUP_BATCH
    ) {
      domainError(
        "VALIDATION_FAILED",
        `Recording cleanup batches must contain 1 through ${String(MAX_CLEANUP_BATCH)} sessions.`,
      );
    }
    const sessions = await ctx.db
      .query("recordingSessions")
      .withIndex("by_status_and_endedAt", (query) =>
        query
          .eq("status", "ended")
          .lt("endedAt", olderThan),
      )
      .take(limit);
    const deleted = {
      sessions: 0,
      invites: 0,
      participants: 0,
      rtcPresence: 0,
      rtcSignals: 0,
      events: 0,
      manifests: 0,
      favorites: 0,
      recordings: 0,
    };
    for (const session of sessions) {
      const sessionDeleted = await deleteRecordingSession(
        ctx,
        session,
      );
      for (const key of Object.keys(
        deleted,
      ) as Array<keyof typeof deleted>) {
        deleted[key] += sessionDeleted[key];
      }
    }
    if (deleted.sessions > 0) {
      await writeAuditEvent(ctx, {
        actor: ctx.actor,
        action: "recording.sessions.retentionDeleted",
        targetType: "recordingSessionBatch",
        targetId: `count:${String(deleted.sessions)}`,
        cutoverRunId: ctx.systemState.cutoverRunId,
        metadata: deleted,
      });
    }
    return deleted;
  },
});

export const deleteSessionData = adminMutation({
  args: {
    publicId: v.string(),
    confirmation: v.literal("delete-session-data"),
  },
  returns: v.union(deletionResultValidator, v.null()),
  handler: async (ctx, args) => {
    const publicId = requirePortableId(
      args.publicId,
      "Recording session ID",
    );
    const session = await sessionByPublicId(ctx, publicId);
    if (session === null) {
      return null;
    }
    const deleted = await deleteRecordingSession(ctx, session);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "recording.session.deleted",
      targetType: "recordingSession",
      targetId: session._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: deleted,
    });
    return deleted;
  },
});
