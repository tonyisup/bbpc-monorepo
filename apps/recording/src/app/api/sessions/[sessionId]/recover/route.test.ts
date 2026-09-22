import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SESSION_GRANTS_COOKIE, readSessionGrantsFromCookieValue } from '@/lib/sessions/cookies';
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
const mocks = vi.hoisted(() => ({
  getRequiredConvexToken: vi.fn(),
  recoverOwnerAccess: vi.fn(),
}));
vi.mock('@/lib/convex/server', () => ({ getRequiredConvexToken: mocks.getRequiredConvexToken }));
vi.mock('@/lib/sessions/store', () => ({ recoverOwnerAccess: mocks.recoverOwnerAccess }));

const { POST } = await import('./route');

const otherGrant: SessionAccessGrant = { sessionId: 'sess_other', clientId: 'client_guest', accessToken: 'access_guest_abcdefghijklmnopqrstuvwxyz' };
const recovered: SessionAccessGrant = {
  sessionId: 'sess_lost',
  clientId: 'client_owner',
  accessToken: 'access_new_abcdefghijklmnopqrstuvwxyz',
  inviteToken: 'inv_new_abcdefghijklmnopqrstuvwxyz',
};

async function recover() {
  return await POST(
    new Request('https://recording.example.test/api/sessions/sess_lost/recover', { method: 'POST' }),
    { params: Promise.resolve({ sessionId: 'sess_lost' }) },
  );
}

function grantsSetBy(response: Response): SessionAccessGrant[] | null {
  const value = response.headers.get('set-cookie')?.match(new RegExp(`${SESSION_GRANTS_COOKIE}=([^;]+)`))?.[1];
  return value === undefined ? null : readSessionGrantsFromCookieValue(value);
}

afterEach(() => {
  cookieJar.clear();
  vi.resetAllMocks();
});

describe('owner access recovery route', () => {
  it('stores the recovered owner grant alongside existing grants', async () => {
    cookieJar.set(SESSION_GRANTS_COOKIE, Buffer.from(JSON.stringify([otherGrant])).toString('base64url'));
    mocks.getRequiredConvexToken.mockResolvedValue('convex-token');
    mocks.recoverOwnerAccess.mockResolvedValue(recovered);

    const response = await recover();

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://recording.example.test/sessions/sess_lost');
    expect(mocks.recoverOwnerAccess).toHaveBeenCalledWith('convex-token', 'sess_lost');
    expect(grantsSetBy(response)).toEqual([otherGrant, recovered]);
  });

  it('asks a signed-out visitor to sign in', async () => {
    mocks.getRequiredConvexToken.mockResolvedValue(null);

    const response = await recover();

    expect(response.headers.get('location')).toBe('https://recording.example.test/sessions/sess_lost?recoverError=sign-in-required');
    expect(mocks.recoverOwnerAccess).not.toHaveBeenCalled();
    expect(grantsSetBy(response)).toBeNull();
  });

  it('refuses an account that does not own the session', async () => {
    mocks.getRequiredConvexToken.mockResolvedValue('convex-token');
    mocks.recoverOwnerAccess.mockRejectedValue(new ConvexError({ code: 'FORBIDDEN', message: 'Only the recording session owner can recover its access.', retryable: false }));

    const response = await recover();

    expect(response.headers.get('location')).toBe('https://recording.example.test/sessions/sess_lost?recoverError=not-owner');
    expect(grantsSetBy(response)).toBeNull();
  });
});
