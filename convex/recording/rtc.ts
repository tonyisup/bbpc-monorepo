import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel.js";
import type {
  MutationCtx,
  QueryCtx,
} from "../_generated/server.js";
import {
  adminMutation,
  recordingMutation,
  recordingQuery,
} from "../functions.js";
import { domainError } from "../lib/errors.js";
import { requireRecordingParticipant } from "./access.js";
import {
  requireBoundedPayload,
  requirePortableId,
  requireRecordingTimestamp,
} from "./validators.js";

const rtcSignalType = v.union(
  v.literal("offer"),
  v.literal("answer"),
  v.literal("ice-candidate"),
  v.literal("leave"),
  v.literal("renegotiate"),
);
const ACTIVE_PRESENCE_MS = 15_000;
const SIGNAL_TTL_MS = 60_000;
const PRESENCE_CLEANUP_MS = 30_000;
const ROOM_CAPACITY = 4;
const MAX_STALE_PRESENCE_ROWS = 100;
const MAX_PENDING_SIGNALS = 200;
const MAX_SIGNAL_PAYLOAD_BYTES = 64 * 1024;
const MAX_RTC_CLEANUP_ROWS = 500;

const presenceValidator = v.object({
  clientId: v.string(),
  displayName: v.string(),
  role: v.union(
    v.literal("owner"),
    v.literal("participant"),
  ),
  joinedAudioAt: v.number(),
  lastSeenAt: v.number(),
  muted: v.boolean(),
  recording: v.boolean(),
});
const signalValidator = v.object({
  fromClientId: v.string(),
  toClientId: v.string(),
  signalId: v.string(),
  createdAt: v.number(),
  type: rtcSignalType,
  payload: v.any(),
});

type RecordingContext = Pick<QueryCtx | MutationCtx, "db">;

async function requireActiveSession(
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
  if (session.status !== "active") {
    domainError(
      "CONFLICT",
      "The recording session has ended.",
    );
  }
  return session;
}

async function presenceForParticipant(
  ctx: RecordingContext,
  publicSessionId: string,
  clientId: string,
): Promise<Doc<"recordingRtcPresence"> | null> {
  const rows = await ctx.db
    .query("recordingRtcPresence")
    .withIndex("by_participant", (query) =>
      query
        .eq("publicSessionId", publicSessionId)
        .eq("clientId", clientId),
    )
    .take(2);
  if (rows.length > 1) {
    domainError(
      "CONFLICT",
      "The recording participant has duplicate RTC presence.",
    );
  }
  return rows.at(0) ?? null;
}

async function activePresenceRows(
  ctx: RecordingContext,
  publicSessionId: string,
  now: number,
) {
  return await ctx.db
    .query("recordingRtcPresence")
    .withIndex("by_lastSeenAt", (query) =>
      query
        .eq("publicSessionId", publicSessionId)
        .gte("lastSeenAt", now - ACTIVE_PRESENCE_MS),
    )
    .take(ROOM_CAPACITY + 1);
}

export const joinAudio = recordingMutation({
  args: {
    publicSessionId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
    muted: v.boolean(),
    recording: v.boolean(),
  },
  returns: v.union(
    v.object({ ok: v.literal(true) }),
    v.object({
      ok: v.literal(false),
      reason: v.literal("room-full"),
    }),
  ),
  handler: async (ctx, args) => {
    const participant = await requireRecordingParticipant(
      ctx,
      args,
    );
    const session = await requireActiveSession(
      ctx,
      participant,
    );
    const now = Date.now();
    const existing = await presenceForParticipant(
      ctx,
      session.publicId,
      participant.clientId,
    );
    if (existing === null) {
      const activeRows = await activePresenceRows(
        ctx,
        session.publicId,
        now,
      );
      if (activeRows.length >= ROOM_CAPACITY) {
        return {
          ok: false as const,
          reason: "room-full" as const,
        };
      }
    }
    const row = {
      publicSessionId: session.publicId,
      clientId: participant.clientId,
      displayName: participant.displayName,
      role: participant.role,
      joinedAudioAt: existing?.joinedAudioAt ?? now,
      lastSeenAt: now,
      muted: args.muted,
      recording: args.recording,
    };
    if (existing === null) {
      await ctx.db.insert("recordingRtcPresence", row);
    } else {
      await ctx.db.patch(
        "recordingRtcPresence",
        existing._id,
        row,
      );
    }
    return { ok: true as const };
  },
});

export const leaveAudio = recordingMutation({
  args: {
    publicSessionId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
  },
  returns: v.object({ ok: v.literal(true) }),
  handler: async (ctx, args) => {
    const participant = await requireRecordingParticipant(
      ctx,
      args,
    );
    const existing = await presenceForParticipant(
      ctx,
      participant.publicSessionId,
      participant.clientId,
    );
    if (existing !== null) {
      await ctx.db.delete(
        "recordingRtcPresence",
        existing._id,
      );
    }
    return { ok: true as const };
  },
});

export const heartbeatAudio = recordingMutation({
  args: {
    publicSessionId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
    muted: v.boolean(),
    recording: v.boolean(),
  },
  returns: v.union(
    v.object({ ok: v.literal(true) }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const participant = await requireRecordingParticipant(
      ctx,
      args,
    );
    await requireActiveSession(ctx, participant);
    const existing = await presenceForParticipant(
      ctx,
      participant.publicSessionId,
      participant.clientId,
    );
    if (existing === null) {
      return null;
    }
    await ctx.db.patch(
      "recordingRtcPresence",
      existing._id,
      {
        displayName: participant.displayName,
        role: participant.role,
        lastSeenAt: Date.now(),
        muted: args.muted,
        recording: args.recording,
      },
    );
    return { ok: true as const };
  },
});

export const listAudioPresence = recordingQuery({
  args: {
    publicSessionId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
  },
  returns: v.array(presenceValidator),
  handler: async (ctx, args) => {
    const participant = await requireRecordingParticipant(
      ctx,
      args,
    );
    const rows = await ctx.db
      .query("recordingRtcPresence")
      .withIndex("by_publicSessionId", (query) =>
        query.eq(
          "publicSessionId",
          participant.publicSessionId,
        ),
      )
      .take(MAX_STALE_PRESENCE_ROWS + 1);
    if (rows.length > MAX_STALE_PRESENCE_ROWS) {
      domainError(
        "CONFLICT",
        "The recording session exceeds its RTC presence safety limit.",
        {
          details: {
            limit: MAX_STALE_PRESENCE_ROWS,
          },
        },
      );
    }
    return rows
      .sort(
        (left, right) =>
          left.joinedAudioAt - right.joinedAudioAt,
      )
      .map((row) => ({
        clientId: row.clientId,
        displayName: row.displayName,
        role: row.role,
        joinedAudioAt: row.joinedAudioAt,
        lastSeenAt: row.lastSeenAt,
        muted: row.muted,
        recording: row.recording,
      }));
  },
});

export const sendSignal = recordingMutation({
  args: {
    publicSessionId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
    toClientId: v.string(),
    signalId: v.string(),
    type: rtcSignalType,
    payload: v.any(),
  },
  returns: v.union(
    v.object({ ok: v.literal(true) }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const participant = await requireRecordingParticipant(
      ctx,
      args,
    );
    const session = await requireActiveSession(
      ctx,
      participant,
    );
    const toClientId = requirePortableId(
      args.toClientId,
      "RTC recipient client ID",
    );
    const signalId = requirePortableId(
      args.signalId,
      "RTC signal ID",
      160,
    );
    requireBoundedPayload(
      args.payload,
      "RTC signal payload",
      MAX_SIGNAL_PAYLOAD_BYTES,
    );
    const recipients = await ctx.db
      .query("recordingParticipants")
      .withIndex(
        "by_publicSessionId_and_clientId",
        (query) =>
          query
            .eq("publicSessionId", session.publicId)
            .eq("clientId", toClientId),
      )
      .take(2);
    if (recipients.length > 1) {
      domainError(
        "CONFLICT",
        "The RTC signal recipient is ambiguous.",
      );
    }
    if (recipients.length === 0) {
      return null;
    }
    const duplicates = await ctx.db
      .query("recordingRtcSignals")
      .withIndex("by_signalId", (query) =>
        query.eq("signalId", signalId),
      )
      .take(2);
    if (duplicates.length > 1) {
      domainError(
        "CONFLICT",
        "The RTC signal ID is ambiguous.",
      );
    }
    const duplicate = duplicates.at(0);
    if (duplicate !== undefined) {
      if (
        duplicate.publicSessionId !== session.publicId ||
        duplicate.fromClientId !== participant.clientId ||
        duplicate.toClientId !== toClientId ||
        duplicate.type !== args.type
      ) {
        domainError(
          "CONFLICT",
          "The RTC signal ID is already in use.",
        );
      }
      return { ok: true as const };
    }
    const now = Date.now();
    const pending = await ctx.db
      .query("recordingRtcSignals")
      .withIndex(
        "by_recipient_and_createdAt",
        (query) =>
          query
            .eq("publicSessionId", session.publicId)
            .eq("toClientId", toClientId)
            .gte("createdAt", now - SIGNAL_TTL_MS),
      )
      .take(MAX_PENDING_SIGNALS);
    if (pending.length >= MAX_PENDING_SIGNALS) {
      domainError(
        "CONFLICT",
        "The RTC recipient has reached its pending-signal limit.",
        { details: { limit: MAX_PENDING_SIGNALS } },
      );
    }
    const payload: unknown = args.payload;
    await ctx.db.insert("recordingRtcSignals", {
      publicSessionId: session.publicId,
      fromClientId: participant.clientId,
      toClientId,
      signalId,
      createdAt: now,
      type: args.type,
      payload,
    });
    return { ok: true as const };
  },
});

export const listSignalsForParticipant = recordingQuery({
  args: {
    publicSessionId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
    now: v.number(),
  },
  returns: v.array(signalValidator),
  handler: async (ctx, args) => {
    const participant = await requireRecordingParticipant(
      ctx,
      args,
    );
    const now = requireRecordingTimestamp(
      args.now,
      "RTC signal read time",
    );
    const signals = await ctx.db
      .query("recordingRtcSignals")
      .withIndex(
        "by_recipient_and_createdAt",
        (query) =>
          query
            .eq(
              "publicSessionId",
              participant.publicSessionId,
            )
            .eq("toClientId", participant.clientId)
            .gte("createdAt", now - SIGNAL_TTL_MS),
      )
      .take(MAX_PENDING_SIGNALS + 1);
    if (signals.length > MAX_PENDING_SIGNALS) {
      domainError(
        "CONFLICT",
        "The RTC recipient exceeds its pending-signal limit.",
        { details: { limit: MAX_PENDING_SIGNALS } },
      );
    }
    return signals
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt ||
          left.signalId.localeCompare(right.signalId),
      )
      .map((signal) => {
        const payload: unknown = signal.payload;
        return {
          fromClientId: signal.fromClientId,
          toClientId: signal.toClientId,
          signalId: signal.signalId,
          createdAt: signal.createdAt,
          type: signal.type,
          payload,
        };
      });
  },
});

export const cleanupRtcSession = adminMutation({
  args: {
    publicSessionId: v.string(),
    olderThan: v.number(),
  },
  returns: v.object({
    deletedPresence: v.number(),
    deletedSignals: v.number(),
  }),
  handler: async (ctx, args) => {
    const publicSessionId = requirePortableId(
      args.publicSessionId,
      "Recording session ID",
    );
    const olderThan = requireRecordingTimestamp(
      args.olderThan,
      "RTC cleanup cutoff",
    );
    const now = Date.now();
    const signalCutoff = Math.min(
      olderThan,
      now - SIGNAL_TTL_MS,
    );
    const presenceCutoff = Math.min(
      olderThan,
      now - PRESENCE_CLEANUP_MS,
    );
    const [signals, presence] = await Promise.all([
      ctx.db
        .query("recordingRtcSignals")
        .withIndex("by_createdAt", (query) =>
          query
            .eq("publicSessionId", publicSessionId)
            .lt("createdAt", signalCutoff),
        )
        .take(MAX_RTC_CLEANUP_ROWS + 1),
      ctx.db
        .query("recordingRtcPresence")
        .withIndex("by_lastSeenAt", (query) =>
          query
            .eq("publicSessionId", publicSessionId)
            .lt("lastSeenAt", presenceCutoff),
        )
        .take(MAX_RTC_CLEANUP_ROWS + 1),
    ]);
    if (
      signals.length > MAX_RTC_CLEANUP_ROWS ||
      presence.length > MAX_RTC_CLEANUP_ROWS
    ) {
      domainError(
        "CONFLICT",
        "RTC cleanup exceeded its safety limit.",
        { details: { limit: MAX_RTC_CLEANUP_ROWS } },
      );
    }
    for (const signal of signals) {
      await ctx.db.delete(
        "recordingRtcSignals",
        signal._id,
      );
    }
    for (const row of presence) {
      await ctx.db.delete(
        "recordingRtcPresence",
        row._id,
      );
    }
    return {
      deletedPresence: presence.length,
      deletedSignals: signals.length,
    };
  },
});
