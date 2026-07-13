/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const ADMIN_SECRET = 'test-session-admin-secret';

function ownerInput(publicId: string, createdAt: number) {
  return {
    adminSecret: ADMIN_SECRET,
    publicId,
    inviteToken: `invite-${publicId}`,
    episode: 'EP-TEST',
    createdAt,
    participant: {
      clientId: `owner-${publicId}`,
      accessToken: `owner-token-${publicId}`,
      displayName: 'Owner',
      joinedAt: createdAt,
    },
  };
}

describe('session authorization', () => {
  beforeEach(() => {
    vi.stubEnv('SESSION_ADMIN_SECRET', ADMIN_SECRET);
  });

  it('rejects session creation without the server admin secret', async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.sessions.createSession, {
      ...ownerInput('session-1', Date.now()),
      adminSecret: 'wrong',
    })).rejects.toThrow('Administrative access required');
    await expect(t.mutation(api.sessions.createSession, {
      ...ownerInput('session-1', Date.now()),
      adminSecret: `${ADMIN_SECRET.slice(0, -1)}x`,
    })).rejects.toThrow('Administrative access required');
  });

  it('does not expose participant tokens and forces invitees to participant role', async () => {
    const t = convexTest(schema, modules);
    const createdAt = Date.now();
    const owner = ownerInput('session-2', createdAt);
    await t.mutation(api.sessions.createSession, owner);

    const joined = await t.mutation(api.sessions.joinSessionByInviteToken, {
      inviteToken: owner.inviteToken,
      participant: {
        clientId: 'guest-1',
        accessToken: 'guest-token',
        displayName: 'Guest',
        joinedAt: createdAt + 1,
      },
    });
    expect(joined?.participants).toEqual(expect.arrayContaining([
      expect.objectContaining({ clientId: 'guest-1', role: 'participant' }),
    ]));
    expect(joined?.participants.every(participant => !('accessToken' in participant))).toBe(true);

    const session = await t.query(api.sessions.getSession, {
      publicId: owner.publicId,
      clientId: owner.participant.clientId,
      accessToken: owner.participant.accessToken,
    });
    expect(session?.participants.every(participant => !('accessToken' in participant))).toBe(true);
  });

  it('blocks guests from owner recording controls and session mutations', async () => {
    const t = convexTest(schema, modules);
    const createdAt = Date.now();
    const owner = ownerInput('session-3', createdAt);
    await t.mutation(api.sessions.createSession, owner);
    await t.mutation(api.sessions.joinSessionByInviteToken, {
      inviteToken: owner.inviteToken,
      participant: {
        clientId: 'guest-1',
        accessToken: 'guest-token',
        displayName: 'Guest',
        joinedAt: createdAt + 1,
      },
    });

    await expect(t.mutation(api.sessions.updateSessionEpisode, {
      publicId: owner.publicId,
      clientId: 'guest-1',
      accessToken: 'guest-token',
      episode: 'HIJACKED',
    })).rejects.toThrow('Session owner access required');

    await expect(t.mutation(api.sessions.endSession, {
      publicId: owner.publicId,
      clientId: 'guest-1',
      accessToken: 'guest-token',
      endedAt: createdAt + 2,
    })).rejects.toThrow('Session owner access required');

    await expect(t.mutation(api.sessions.appendSessionEvent, {
      publicId: owner.publicId,
      clientId: 'guest-1',
      accessToken: 'guest-token',
      eventId: 'malicious-start',
      createdAt: createdAt + 2,
      payload: { kind: 'recording-started', startedByRole: 'owner', startedAt: createdAt + 2 },
    })).rejects.toThrow('Only the session owner can publish this event');
  });

  it('rejects spoofed audio disconnect events', async () => {
    const t = convexTest(schema, modules);
    const createdAt = Date.now();
    const owner = ownerInput('session-4', createdAt);
    await t.mutation(api.sessions.createSession, owner);

    await expect(t.mutation(api.sessions.appendSessionEvent, {
      publicId: owner.publicId,
      clientId: owner.participant.clientId,
      accessToken: owner.participant.accessToken,
      eventId: 'spoofed-disconnect-start',
      createdAt: createdAt + 1,
      payload: {
        kind: 'audio-disconnect-started',
        disconnect: {
          disconnectId: 'disconnect-1',
          clientId: 'another-client',
          startedAt: createdAt + 1,
          recordingStartedAt: null,
          reason: 'ice-disconnected',
        },
      },
    })).rejects.toThrow('Session event participant does not match caller');

    await expect(t.mutation(api.sessions.appendSessionEvent, {
      publicId: owner.publicId,
      clientId: owner.participant.clientId,
      accessToken: owner.participant.accessToken,
      eventId: 'spoofed-disconnect-end',
      createdAt: createdAt + 2,
      payload: {
        kind: 'audio-disconnect-ended',
        disconnect: {
          disconnectId: 'disconnect-1',
          clientId: 'another-client',
          endedAt: createdAt + 2,
          recordingStartedAt: null,
        },
      },
    })).rejects.toThrow('Session event participant does not match caller');
  });

  it('does not reassign an existing recording upload to another session', async () => {
    const t = convexTest(schema, modules);
    const createdAt = Date.now();
    const first = ownerInput('recording-session-1', createdAt);
    const second = ownerInput('recording-session-2', createdAt);
    await t.mutation(api.sessions.createSession, first);
    await t.mutation(api.sessions.createSession, second);

    const upload = {
      episode: 'EP-TEST',
      hostName: 'Owner',
      trackType: 'mic' as const,
      startedAt: createdAt,
      blobName: 'shared-blob-name.webm',
      url: 'https://example.test/shared-blob-name.webm',
      size: 123,
      contentType: 'audio/webm',
      uploadedAt: createdAt + 1,
    };
    const uploadId = await t.mutation(api.recordings.saveUpload, {
      publicSessionId: first.publicId,
      clientId: first.participant.clientId,
      accessToken: first.participant.accessToken,
      ...upload,
    });
    const updatedUploadId = await t.mutation(api.recordings.saveUpload, {
      publicSessionId: first.publicId,
      clientId: first.participant.clientId,
      accessToken: first.participant.accessToken,
      ...upload,
      size: 456,
    });
    expect(updatedUploadId).toBe(uploadId);

    await expect(t.mutation(api.recordings.saveUpload, {
      publicSessionId: second.publicId,
      clientId: second.participant.clientId,
      accessToken: second.participant.accessToken,
      ...upload,
    })).rejects.toThrow('Recording upload belongs to a different session');
  });

  it('uses endedAt, not createdAt, when applying retention cleanup', async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const oldCreatedAt = now - 90 * 24 * 60 * 60 * 1000;
    const recentEnd = ownerInput('recently-ended', oldCreatedAt);
    const oldEnd = ownerInput('old-ended', oldCreatedAt);
    await t.mutation(api.sessions.createSession, recentEnd);
    await t.mutation(api.sessions.createSession, oldEnd);

    const oldEndedAt = now - 60 * 24 * 60 * 60 * 1000;
    const beforeEnd = Date.now();
    const ended = await t.mutation(api.sessions.endSession, {
      publicId: recentEnd.publicId,
      clientId: recentEnd.participant.clientId,
      accessToken: recentEnd.participant.accessToken,
      endedAt: oldEndedAt,
    });
    const afterEnd = Date.now();
    expect(Date.parse(ended?.endedAt ?? '')).toBeGreaterThanOrEqual(beforeEnd);
    expect(Date.parse(ended?.endedAt ?? '')).toBeLessThanOrEqual(afterEnd);

    await t.run(async ctx => {
      const session = await ctx.db
        .query('sessions')
        .withIndex('by_public_id', q => q.eq('publicId', oldEnd.publicId))
        .unique();
      if (!session) throw new Error('Expected old session');
      await ctx.db.patch(session._id, {
        status: 'ended',
        endedAt: oldEndedAt,
      });
    });

    const deleted = await t.mutation(api.sessions.cleanupEndedSessions, {
      olderThan: now - 30 * 24 * 60 * 60 * 1000,
      confirmation: 'delete-ended-sessions',
      adminSecret: ADMIN_SECRET,
    });
    expect(deleted.sessions).toBe(1);

    const remaining = await t.run(async ctx => (
      await ctx.db.query('sessions').collect()
    ));
    expect(remaining.map(session => session.publicId)).toEqual(['recently-ended']);
  });
});
