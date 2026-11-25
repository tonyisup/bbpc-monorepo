import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SESSION_GRANTS_COOKIE,
  readSessionGrantsFromCookieValue,
} from '@/lib/sessions/cookies';
import type { SessionAccessGrant } from '@/lib/sessions/types';

const cookieJar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

const store = vi.hoisted(() => ({
  resolveInviteSession: vi.fn(),
  findParticipantForGrant: vi.fn(),
  joinSessionByInviteToken: vi.fn(),
}));
vi.mock('@/lib/sessions/store', () => store);

const { GET, POST } = await import('./route');

const ownerGrant: SessionAccessGrant = {
  sessionId: 'sess_owner',
  clientId: 'client_owner',
  accessToken: 'access_owner_abcdefghijklmnopqrstuvwxyz',
  inviteToken: 'inv_owner_abcdefghijklmnopqrstuvwxyz',
};
const guestGrant: SessionAccessGrant = {
  sessionId: 'sess_owner',
  clientId: 'client_guest',
  accessToken: 'access_guest_abcdefghijklmnopqrstuvwxyz',
};

function storeGrants(grants: SessionAccessGrant[]) {
  cookieJar.set(SESSION_GRANTS_COOKIE, Buffer.from(JSON.stringify(grants), 'utf8').toString('base64url'));
}

async function openInvite(inviteToken = ownerGrant.inviteToken!) {
  return await GET(
    new Request(`https://recording.example.test/join/${inviteToken}`),
    { params: Promise.resolve({ inviteToken }) },
  );
}

async function confirmJoin(inviteToken = ownerGrant.inviteToken!, origin: string | null = 'https://recording.example.test') {
  return await POST(
    new Request(`https://recording.example.test/join/${inviteToken}`, {
      method: 'POST',
      headers: origin === null ? {} : { origin },
    }),
    { params: Promise.resolve({ inviteToken }) },
  );
}

function grantsSetBy(response: Response): SessionAccessGrant[] | null {
  const header = response.headers.get('set-cookie');
  if (!header) return null;
  const value = header.match(new RegExp(`${SESSION_GRANTS_COOKIE}=([^;]+)`))?.[1];
  return readSessionGrantsFromCookieValue(value);
}

afterEach(() => {
  cookieJar.clear();
  vi.resetAllMocks();
});

describe('invite route', () => {
  it('keeps owner access when the owner opens their own invite', async () => {
    // Audit R05: this used to replace the owner grant with a new guest grant.
    storeGrants([ownerGrant]);
    store.resolveInviteSession.mockResolvedValue('sess_owner');
    store.findParticipantForGrant.mockResolvedValue({ ...ownerGrant, role: 'owner' });

    const response = await openInvite();

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://recording.example.test/sessions/sess_owner');
    expect(grantsSetBy(response)).toBeNull();
    expect(store.findParticipantForGrant).toHaveBeenCalledWith('sess_owner', ownerGrant);
    expect(store.joinSessionByInviteToken).not.toHaveBeenCalled();
  });

  it('reuses a returning guest membership instead of adding a participant', async () => {
    storeGrants([guestGrant]);
    store.resolveInviteSession.mockResolvedValue('sess_owner');
    store.findParticipantForGrant.mockResolvedValue({ ...guestGrant, role: 'participant' });

    const response = await openInvite();

    expect(response.status).toBe(307);
    expect(store.joinSessionByInviteToken).not.toHaveBeenCalled();
  });

  it('joins and stores a new grant when the existing one was revoked', async () => {
    const otherGrant = { ...guestGrant, sessionId: 'sess_other' };
    storeGrants([otherGrant, guestGrant]);
    store.resolveInviteSession.mockResolvedValue('sess_owner');
    // findParticipantForGrant reports a grant the backend rejected as null.
    store.findParticipantForGrant.mockResolvedValue(null);
    const joinedGrant = { sessionId: 'sess_owner', clientId: 'client_new', accessToken: 'access_new_abcdefghijklmnopqrstuvwxyz' };
    store.joinSessionByInviteToken.mockResolvedValue({ session: { id: 'sess_owner' }, grant: joinedGrant });

    expect((await openInvite()).status).toBe(200);
    expect(store.joinSessionByInviteToken).not.toHaveBeenCalled();
    const response = await confirmJoin();

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://recording.example.test/sessions/sess_owner');
    expect(grantsSetBy(response)).toEqual([otherGrant, joinedGrant]);
  });

  it('only shows the join page when the link is opened, so previews cannot fill the session', async () => {
    store.resolveInviteSession.mockResolvedValue('sess_owner');

    for (let index = 0; index < 12; index += 1) {
      const response = await openInvite();
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(await response.text()).toContain('<form method="post">');
    }
    expect(store.joinSessionByInviteToken).not.toHaveBeenCalled();
  });

  it('refuses a join posted from another site', async () => {
    store.resolveInviteSession.mockResolvedValue('sess_owner');

    const response = await confirmJoin(undefined, 'https://attacker.example.test');

    expect(response.status).toBe(403);
    expect(store.joinSessionByInviteToken).not.toHaveBeenCalled();
  });

  it('does not replace an owner grant when access cannot be checked', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    storeGrants([ownerGrant]);
    store.resolveInviteSession.mockResolvedValue('sess_owner');
    store.findParticipantForGrant.mockRejectedValue(new TypeError('fetch failed'));

    const response = await openInvite();

    expect(response.status).toBe(503);
    expect(grantsSetBy(response)).toBeNull();
    expect(store.joinSessionByInviteToken).not.toHaveBeenCalled();
  });

  it('rejects an unknown or inactive invite without joining', async () => {
    store.resolveInviteSession.mockResolvedValue(null);

    const response = await openInvite('inv_unknown_abcdefghijklmnopqrstuvwxyz');

    expect(response.status).toBe(404);
    expect(store.joinSessionByInviteToken).not.toHaveBeenCalled();
  });
});
