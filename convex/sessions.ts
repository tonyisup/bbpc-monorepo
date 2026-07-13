import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { v } from 'convex/values';
import {
  participantForAccess,
  requireAdminSecret,
  requireOwner,
  requireParticipant,
} from './access';
import { sessionEventPayload } from './sessionEvent';

async function sessionByPublicId(ctx: QueryCtx | MutationCtx, publicId: string) {
  return await ctx.db
    .query('sessions')
    .withIndex('by_public_id', q => q.eq('publicId', publicId))
    .unique();
}

export const createSession = mutation({
  args: {
    adminSecret: v.string(),
    publicId: v.string(),
    inviteToken: v.string(),
    episode: v.string(),
    createdAt: v.number(),
    participant: v.object({
      clientId: v.string(),
      accessToken: v.string(),
      displayName: v.string(),
      joinedAt: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    requireAdminSecret(args.adminSecret);
    const existing = await sessionByPublicId(ctx, args.publicId);
    if (existing) {
      throw new Error('Session publicId already exists');
    }

    const sessionId = await ctx.db.insert('sessions', {
      publicId: args.publicId,
      episode: args.episode,
      status: 'active',
      createdAt: args.createdAt,
    });

    await ctx.db.insert('sessionInvites', {
      token: args.inviteToken,
      sessionId,
      publicSessionId: args.publicId,
      createdAt: args.createdAt,
    });

    await ctx.db.insert('participants', {
      sessionId,
      publicSessionId: args.publicId,
      ...args.participant,
      role: 'owner',
    });

    return {
      id: args.publicId,
      inviteToken: args.inviteToken,
      episode: args.episode,
      createdAt: new Date(args.createdAt).toISOString(),
      endedAt: null,
      status: 'active' as const,
      participants: [{
        ...args.participant,
        role: 'owner' as const,
        joinedAt: new Date(args.participant.joinedAt).toISOString(),
      }],
    };
  },
});

export const getSession = query({
  args: {
    publicId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireParticipant(ctx, args.publicId, args.clientId, args.accessToken);
    const session = await sessionByPublicId(ctx, args.publicId);
    if (!session) return null;

    const invite = await ctx.db
      .query('sessionInvites')
      .withIndex('by_public_session_id', q => q.eq('publicSessionId', args.publicId))
      .first();

    const participants = await ctx.db
      .query('participants')
      .withIndex('by_public_session_id', q => q.eq('publicSessionId', args.publicId))
      .collect();

    return {
      id: session.publicId,
      inviteToken: invite?.token ?? '',
      episode: session.episode,
      createdAt: new Date(session.createdAt).toISOString(),
      endedAt: session.endedAt ? new Date(session.endedAt).toISOString() : null,
      status: session.status,
      participants: participants.map(participant => ({
        clientId: participant.clientId,
        displayName: participant.displayName,
        role: participant.role,
        joinedAt: new Date(participant.joinedAt).toISOString(),
      })),
    };
	},
});

export const getSessionLifecycle = query({
  args: {
    publicId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireParticipant(ctx, args.publicId, args.clientId, args.accessToken);
    const session = await sessionByPublicId(ctx, args.publicId);
    if (!session) return null;

    return {
      id: session.publicId,
      episode: session.episode,
      status: session.status,
      createdAt: new Date(session.createdAt).toISOString(),
      endedAt: session.endedAt ? new Date(session.endedAt).toISOString() : null,
    };
  },
});

export const joinSessionByInviteToken = mutation({
  args: {
    inviteToken: v.string(),
    participant: v.object({
      clientId: v.string(),
      accessToken: v.string(),
      displayName: v.string(),
      joinedAt: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query('sessionInvites')
      .withIndex('by_token', q => q.eq('token', args.inviteToken))
      .unique();

    if (!invite) return null;

    const session = await ctx.db.get(invite.sessionId);
    if (!session || session.status !== 'active') return null;

    await ctx.db.insert('participants', {
      sessionId: invite.sessionId,
      publicSessionId: invite.publicSessionId,
      ...args.participant,
      role: 'participant',
    });

    const participants = await ctx.db
      .query('participants')
      .withIndex('by_public_session_id', q => q.eq('publicSessionId', session.publicId))
      .collect();

    return {
      id: session.publicId,
      inviteToken: invite.token,
      episode: session.episode,
      createdAt: new Date(session.createdAt).toISOString(),
      endedAt: session.endedAt ? new Date(session.endedAt).toISOString() : null,
      status: session.status,
      participants: participants.map(participant => ({
        clientId: participant.clientId,
        displayName: participant.displayName,
        role: participant.role,
        joinedAt: new Date(participant.joinedAt).toISOString(),
      })),
    };
  },
});

export const getParticipantForGrant = query({
  args: {
    publicId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
  },
  handler: async (ctx, args) => {
    const participant = await participantForAccess(ctx, args.publicId, args.clientId, args.accessToken);
    if (!participant) return null;

    return {
      clientId: participant.clientId,
      accessToken: participant.accessToken,
      displayName: participant.displayName,
      role: participant.role,
      joinedAt: new Date(participant.joinedAt).toISOString(),
    };
  },
});

export const updateParticipantDisplayName = mutation({
  args: {
    publicId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
    displayName: v.string(),
  },
  handler: async (ctx, args) => {
    const participant = await participantForAccess(ctx, args.publicId, args.clientId, args.accessToken);
    if (!participant) return null;

    await ctx.db.patch(participant._id, { displayName: args.displayName });

    return {
      clientId: participant.clientId,
      accessToken: participant.accessToken,
      displayName: args.displayName,
      role: participant.role,
      joinedAt: new Date(participant.joinedAt).toISOString(),
    };
  },
});

export const updateSessionEpisode = mutation({
  args: {
    publicId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
    episode: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.publicId, args.clientId, args.accessToken);
    const session = await sessionByPublicId(ctx, args.publicId);
    if (!session || session.status !== 'active') return null;

    await ctx.db.patch(session._id, { episode: args.episode });

    return {
      id: session.publicId,
      episode: args.episode,
      status: session.status,
      createdAt: new Date(session.createdAt).toISOString(),
    };
	},
});

export const endSession = mutation({
  args: {
    publicId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
    endedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.publicId, args.clientId, args.accessToken);
    const session = await sessionByPublicId(ctx, args.publicId);
    if (!session) return null;

    if (session.status === 'ended') {
      return {
        id: session.publicId,
        episode: session.episode,
        status: session.status,
        createdAt: new Date(session.createdAt).toISOString(),
        endedAt: session.endedAt ? new Date(session.endedAt).toISOString() : null,
      };
    }

    await ctx.db.patch(session._id, {
      status: 'ended',
      endedAt: args.endedAt,
    });

    return {
      id: session.publicId,
      episode: session.episode,
      status: 'ended' as const,
      createdAt: new Date(session.createdAt).toISOString(),
      endedAt: new Date(args.endedAt).toISOString(),
    };
  },
});

export const listParticipants = query({
  args: {
    publicId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireParticipant(ctx, args.publicId, args.clientId, args.accessToken);
    const participants = await ctx.db
      .query('participants')
      .withIndex('by_public_session_id', q => q.eq('publicSessionId', args.publicId))
      .collect();

    return participants.map(participant => ({
      id: participant.clientId,
      name: participant.displayName,
    }));
  },
});

export const appendSessionEvent = mutation({
  args: {
    publicId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
    eventId: v.string(),
    createdAt: v.number(),
    payload: sessionEventPayload,
  },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx, args.publicId, args.clientId, args.accessToken);
    const session = await sessionByPublicId(ctx, args.publicId);
    const payload = args.payload;
    const isTerminalRecordingEvent = (
      payload.kind === 'recording-left'
      || payload.kind === 'recording-stopped'
    );
    const isOwnerEvent = (
      payload.kind === 'recording-started'
      || payload.kind === 'recording-stopped'
      || payload.kind === 'episode-update'
    );
    if (isOwnerEvent && participant.role !== 'owner') {
      throw new Error('Only the session owner can publish this event');
    }
    if (
      (payload.kind === 'recording-started' && payload.participant?.clientId !== undefined
        && payload.participant.clientId !== participant.clientId)
      || (payload.kind === 'recording-stopped' && payload.participant?.clientId !== undefined
        && payload.participant.clientId !== participant.clientId)
      || (payload.kind === 'recording-joined' && payload.participant.clientId !== participant.clientId)
      || (payload.kind === 'recording-left' && payload.participant.clientId !== participant.clientId)
      || (payload.kind === 'audio-joined' && payload.participant.clientId !== participant.clientId)
      || (payload.kind === 'audio-left' && payload.participant.clientId !== participant.clientId)
    ) {
      throw new Error('Session event participant does not match caller');
    }
    if (
      (payload.kind === 'recording-joined' || payload.kind === 'audio-joined')
      && payload.participant.role !== participant.role
    ) {
      throw new Error('Session event role does not match caller');
    }
    if (!session || (session.status !== 'active' && !isTerminalRecordingEvent)) return null;

    const existing = await ctx.db
      .query('sessionEvents')
      .withIndex('by_event_id', q => q.eq('eventId', args.eventId))
      .unique();

    if (existing) return existing._id;

    return await ctx.db.insert('sessionEvents', {
      publicSessionId: args.publicId,
      eventId: args.eventId,
      actorId: participant.clientId,
      createdAt: args.createdAt,
      payload: args.payload,
    });
  },
});

export const listSessionEvents = query({
  args: {
    publicId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireParticipant(ctx, args.publicId, args.clientId, args.accessToken);
    const events = await ctx.db
      .query('sessionEvents')
      .withIndex('by_public_session_id', q => q.eq('publicSessionId', args.publicId))
      .collect();

    return events
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(event => ({
        eventId: event.eventId,
        actorId: event.actorId,
        createdAt: event.createdAt,
        payload: event.payload,
      }));
	},
});

async function deleteByPublicSessionId(
  ctx: MutationCtx,
  table: 'sessionInvites' | 'participants' | 'sessionEvents' | 'sessionManifests' | 'sessionFavorites' | 'recordingUploads',
  publicSessionId: string,
) {
  const docs = await ctx.db
    .query(table)
    .withIndex('by_public_session_id', q => q.eq('publicSessionId', publicSessionId))
    .collect();

  for (const doc of docs) {
    await ctx.db.delete(doc._id);
  }

  return docs.length;
}

async function deleteRtcByPublicSessionId(ctx: MutationCtx, publicSessionId: string) {
  const presence = await ctx.db
    .query('rtcPresence')
    .withIndex('by_public_session_id', q => q.eq('publicSessionId', publicSessionId))
    .collect();
  const signals = await ctx.db
    .query('rtcSignals')
    .withIndex('by_created_at', q => q.eq('publicSessionId', publicSessionId))
    .collect();

  for (const doc of presence) await ctx.db.delete(doc._id);
  for (const doc of signals) await ctx.db.delete(doc._id);

  return {
    rtcPresence: presence.length,
    rtcSignals: signals.length,
  };
}

export const cleanupEndedSessions = mutation({
  args: {
    olderThan: v.number(),
    limit: v.optional(v.number()),
    confirmation: v.literal('delete-ended-sessions'),
    adminSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireAdminSecret(args.adminSecret);
    const limit = Math.min(Math.max(args.limit ?? 10, 1), 100);
    const sessions = await ctx.db
      .query('sessions')
      .withIndex('by_status_ended_at', q => (
        q
          .eq('status', 'ended')
          .lt('endedAt', args.olderThan)
      ))
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
      deleted.invites += await deleteByPublicSessionId(ctx, 'sessionInvites', session.publicId);
      deleted.participants += await deleteByPublicSessionId(ctx, 'participants', session.publicId);
      const deletedRtc = await deleteRtcByPublicSessionId(ctx, session.publicId);
      deleted.rtcPresence += deletedRtc.rtcPresence;
      deleted.rtcSignals += deletedRtc.rtcSignals;
      deleted.events += await deleteByPublicSessionId(ctx, 'sessionEvents', session.publicId);
      deleted.manifests += await deleteByPublicSessionId(ctx, 'sessionManifests', session.publicId);
      deleted.favorites += await deleteByPublicSessionId(ctx, 'sessionFavorites', session.publicId);
      deleted.recordings += await deleteByPublicSessionId(ctx, 'recordingUploads', session.publicId);
      await ctx.db.delete(session._id);
      deleted.sessions += 1;
    }

    return deleted;
  },
});

export const deleteSessionData = mutation({
  args: {
    publicId: v.string(),
    confirmation: v.literal('delete-session-data'),
    adminSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireAdminSecret(args.adminSecret);
    const session = await sessionByPublicId(ctx, args.publicId);
    if (!session) return null;

    const deleted = {
      sessions: 0,
      invites: await deleteByPublicSessionId(ctx, 'sessionInvites', args.publicId),
      participants: await deleteByPublicSessionId(ctx, 'participants', args.publicId),
      events: await deleteByPublicSessionId(ctx, 'sessionEvents', args.publicId),
      manifests: await deleteByPublicSessionId(ctx, 'sessionManifests', args.publicId),
      favorites: await deleteByPublicSessionId(ctx, 'sessionFavorites', args.publicId),
      recordings: await deleteByPublicSessionId(ctx, 'recordingUploads', args.publicId),
      ...await deleteRtcByPublicSessionId(ctx, args.publicId),
    };

    await ctx.db.delete(session._id);
    deleted.sessions = 1;

    return deleted;
  },
});
