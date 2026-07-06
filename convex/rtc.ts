import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { v } from 'convex/values';

const rtcSignalType = v.union(
  v.literal('offer'),
  v.literal('answer'),
  v.literal('ice-candidate'),
  v.literal('leave'),
  v.literal('renegotiate'),
);

const ACTIVE_PRESENCE_MS = 15_000;
const SIGNAL_TTL_MS = 60_000;
const PRESENCE_CLEANUP_MS = 30_000;
const ROOM_CAPACITY = 4;

async function sessionByPublicId(ctx: QueryCtx | MutationCtx, publicId: string) {
  return await ctx.db
    .query('sessions')
    .withIndex('by_public_id', q => q.eq('publicId', publicId))
    .unique();
}

async function participantForAccess(
  ctx: QueryCtx | MutationCtx,
  publicSessionId: string,
  clientId: string,
  accessToken: string,
) {
  return await ctx.db
    .query('participants')
    .withIndex('by_access', q => (
      q
        .eq('publicSessionId', publicSessionId)
        .eq('clientId', clientId)
        .eq('accessToken', accessToken)
    ))
    .unique();
}

async function activePresenceRows(ctx: QueryCtx | MutationCtx, publicSessionId: string, now: number) {
  return await ctx.db
    .query('rtcPresence')
    .withIndex('by_last_seen', q => (
      q
        .eq('publicSessionId', publicSessionId)
        .gte('lastSeenAt', now - ACTIVE_PRESENCE_MS)
    ))
    .collect();
}

export const joinAudio = mutation({
  args: {
    publicSessionId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
    muted: v.boolean(),
    recording: v.boolean(),
  },
  handler: async (ctx, args) => {
    const participant = await participantForAccess(ctx, args.publicSessionId, args.clientId, args.accessToken);
    if (!participant) return { ok: false as const, reason: 'unauthorized' as const };

    const session = await sessionByPublicId(ctx, args.publicSessionId);
    if (!session || session.status !== 'active') {
      return { ok: false as const, reason: 'session-ended' as const };
    }

    const now = Date.now();
    const existing = await ctx.db
      .query('rtcPresence')
      .withIndex('by_participant', q => (
        q.eq('publicSessionId', args.publicSessionId).eq('clientId', args.clientId)
      ))
      .unique();

    if (!existing) {
      const activeRows = await activePresenceRows(ctx, args.publicSessionId, now);
      if (activeRows.length >= ROOM_CAPACITY) {
        return { ok: false as const, reason: 'room-full' as const };
      }
    }

    const row = {
      publicSessionId: args.publicSessionId,
      clientId: args.clientId,
      displayName: participant.displayName,
      role: participant.role,
      joinedAudioAt: existing?.joinedAudioAt ?? now,
      lastSeenAt: now,
      muted: args.muted,
      recording: args.recording,
    };

    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert('rtcPresence', row);

    return { ok: true as const };
  },
});

export const leaveAudio = mutation({
  args: {
    publicSessionId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
  },
  handler: async (ctx, args) => {
    const participant = await participantForAccess(ctx, args.publicSessionId, args.clientId, args.accessToken);
    if (!participant) return null;

    const existing = await ctx.db
      .query('rtcPresence')
      .withIndex('by_participant', q => (
        q.eq('publicSessionId', args.publicSessionId).eq('clientId', args.clientId)
      ))
      .unique();

    if (existing) await ctx.db.delete(existing._id);
    return { ok: true as const };
  },
});

export const heartbeatAudio = mutation({
  args: {
    publicSessionId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
    muted: v.boolean(),
    recording: v.boolean(),
  },
  handler: async (ctx, args) => {
    const participant = await participantForAccess(ctx, args.publicSessionId, args.clientId, args.accessToken);
    if (!participant) return null;

    const existing = await ctx.db
      .query('rtcPresence')
      .withIndex('by_participant', q => (
        q.eq('publicSessionId', args.publicSessionId).eq('clientId', args.clientId)
      ))
      .unique();

    if (!existing) return null;

    await ctx.db.patch(existing._id, {
      displayName: participant.displayName,
      role: participant.role,
      lastSeenAt: Date.now(),
      muted: args.muted,
      recording: args.recording,
    });

    return { ok: true as const };
  },
});

export const listAudioPresence = query({
  args: {
    publicSessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('rtcPresence')
      .withIndex('by_public_session_id', q => q.eq('publicSessionId', args.publicSessionId))
      .collect();

    return rows
      .sort((a, b) => a.joinedAudioAt - b.joinedAudioAt)
      .map(row => ({
        clientId: row.clientId,
        displayName: row.displayName,
        role: row.role as 'owner' | 'participant',
        joinedAudioAt: row.joinedAudioAt,
        lastSeenAt: row.lastSeenAt,
        muted: row.muted,
        recording: row.recording,
      }));
  },
});

export const sendSignal = mutation({
  args: {
    publicSessionId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
    toClientId: v.string(),
    signalId: v.string(),
    type: rtcSignalType,
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const participant = await participantForAccess(ctx, args.publicSessionId, args.clientId, args.accessToken);
    if (!participant) return null;

    const duplicate = await ctx.db
      .query('rtcSignals')
      .withIndex('by_signal_id', q => q.eq('signalId', args.signalId))
      .first();

    if (duplicate) return { ok: true as const };

    await ctx.db.insert('rtcSignals', {
      publicSessionId: args.publicSessionId,
      fromClientId: args.clientId,
      toClientId: args.toClientId,
      signalId: args.signalId,
      createdAt: Date.now(),
      type: args.type,
      payload: args.payload,
    });

    return { ok: true as const };
  },
});

export const listSignalsForParticipant = query({
  args: {
    publicSessionId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
  },
  handler: async (ctx, args) => {
    const participant = await participantForAccess(ctx, args.publicSessionId, args.clientId, args.accessToken);
    if (!participant) return [];

    const cutoff = Date.now() - SIGNAL_TTL_MS;
    const signals = await ctx.db
      .query('rtcSignals')
      .withIndex('by_recipient', q => (
        q.eq('publicSessionId', args.publicSessionId).eq('toClientId', args.clientId)
      ))
      .collect();

    return signals
      .filter(signal => signal.createdAt >= cutoff)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(signal => ({
        fromClientId: signal.fromClientId,
        toClientId: signal.toClientId,
        signalId: signal.signalId,
        createdAt: signal.createdAt,
        type: signal.type,
        payload: signal.payload,
      }));
  },
});

export const cleanupRtcSession = mutation({
  args: {
    publicSessionId: v.string(),
    olderThan: v.number(),
    adminSecret: v.string(),
  },
  handler: async (ctx, args) => {
    if (!process.env.RTC_CLEANUP_ADMIN_SECRET || args.adminSecret !== process.env.RTC_CLEANUP_ADMIN_SECRET) {
      throw new Error('Unauthorized RTC cleanup');
    }

    const signalCutoff = Math.min(args.olderThan, Date.now() - SIGNAL_TTL_MS);
    const presenceCutoff = Math.min(args.olderThan, Date.now() - PRESENCE_CLEANUP_MS);
    const signals = await ctx.db
      .query('rtcSignals')
      .withIndex('by_created_at', q => (
        q.eq('publicSessionId', args.publicSessionId).lt('createdAt', signalCutoff)
      ))
      .collect();
    const presence = await ctx.db
      .query('rtcPresence')
      .withIndex('by_last_seen', q => (
        q.eq('publicSessionId', args.publicSessionId).lt('lastSeenAt', presenceCutoff)
      ))
      .collect();

    for (const signal of signals) await ctx.db.delete(signal._id);
    for (const row of presence) await ctx.db.delete(row._id);

    return {
      deletedPresence: presence.length,
      deletedSignals: signals.length,
    };
  },
});
