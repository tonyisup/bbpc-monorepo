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

    await expect(t.mutation(api.sessions.appendSessionEvent, {
      publicId: owner.publicId,
      clientId: 'guest-1',
      accessToken: 'guest-token',
      eventId: 'malicious-start',
      createdAt: createdAt + 2,
      payload: { kind: 'recording-started', startedByRole: 'owner', startedAt: createdAt + 2 },
    })).rejects.toThrow('Only the session owner can publish this event');
  });

  it('uses endedAt, not createdAt, when applying retention cleanup', async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const oldCreatedAt = now - 90 * 24 * 60 * 60 * 1000;
    const recentEnd = ownerInput('recently-ended', oldCreatedAt);
    const oldEnd = ownerInput('old-ended', oldCreatedAt);
    await t.mutation(api.sessions.createSession, recentEnd);
    await t.mutation(api.sessions.createSession, oldEnd);

    await t.mutation(api.sessions.endSession, {
      publicId: recentEnd.publicId,
      clientId: recentEnd.participant.clientId,
      accessToken: recentEnd.participant.accessToken,
      endedAt: now,
    });
    await t.mutation(api.sessions.endSession, {
      publicId: oldEnd.publicId,
      clientId: oldEnd.participant.clientId,
      accessToken: oldEnd.participant.accessToken,
      endedAt: now - 60 * 24 * 60 * 60 * 1000,
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
