import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { v } from 'convex/values';

const role = v.union(v.literal('owner'), v.literal('participant'));

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

export const createSession = mutation({
  args: {
    publicId: v.string(),
    inviteToken: v.string(),
    episode: v.string(),
    createdAt: v.number(),
    participant: v.object({
      clientId: v.string(),
      accessToken: v.string(),
      displayName: v.string(),
      role,
      joinedAt: v.number(),
    }),
  },
  handler: async (ctx, args) => {
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
        joinedAt: new Date(args.participant.joinedAt).toISOString(),
      }],
    };
  },
});

export const getSession = query({
  args: {
    publicId: v.string(),
  },
  handler: async (ctx, args) => {
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
        accessToken: participant.accessToken,
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
  },
  handler: async (ctx, args) => {
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
      role,
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
        accessToken: participant.accessToken,
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
    episode: v.string(),
  },
  handler: async (ctx, args) => {
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
    endedAt: v.number(),
  },
  handler: async (ctx, args) => {
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
  },
  handler: async (ctx, args) => {
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
    eventId: v.string(),
    actorId: v.string(),
    createdAt: v.number(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const session = await sessionByPublicId(ctx, args.publicId);
    const payload = args.payload as { kind?: unknown };
    const isTerminalRecordingEvent = (
      payload.kind === 'recording-left'
      || payload.kind === 'recording-stopped'
    );
    if (!session || (session.status !== 'active' && !isTerminalRecordingEvent)) return null;

    const existing = await ctx.db
      .query('sessionEvents')
      .withIndex('by_event_id', q => q.eq('eventId', args.eventId))
      .unique();

    if (existing) return existing._id;

    return await ctx.db.insert('sessionEvents', {
      publicSessionId: args.publicId,
      eventId: args.eventId,
      actorId: args.actorId,
      createdAt: args.createdAt,
      payload: args.payload,
    });
  },
});

export const listSessionEvents = query({
  args: {
    publicId: v.string(),
  },
  handler: async (ctx, args) => {
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
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 10, 1), 100);
    const sessions = await ctx.db
      .query('sessions')
      .withIndex('by_status_created_at', q => (
        q
          .eq('status', 'ended')
          .lt('createdAt', args.olderThan)
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
  },
  handler: async (ctx, args) => {
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
