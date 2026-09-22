import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  querySharedConvex: vi.fn(),
  cookie: undefined as string | undefined,
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (mocks.cookie === undefined ? undefined : { value: mocks.cookie }) }),
  headers: async () => new Headers({ host: 'recording.example.test' }),
}));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not found'); } }));
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'user_owner' }) }));
vi.mock('@/lib/convex/http', () => ({
  querySharedConvex: mocks.querySharedConvex,
  mutateSharedConvex: vi.fn(),
  mutateSharedConvexAsUser: vi.fn(),
}));
vi.mock('@/components/dashboard/DashboardApp', () => ({ DashboardApp: () => null }));

const { default: SessionPage } = await import('./page');

const staleOwnerGrant = {
  sessionId: 'sess_owner',
  clientId: 'client_owner',
  accessToken: 'access_replaced_abcdefghijklmnopqrstuvwxyz',
  inviteToken: 'inv_owner_abcdefghijklmnopqrstuvwxyz',
};

function render() {
  return SessionPage({
    params: Promise.resolve({ sessionId: 'sess_owner' }),
    searchParams: Promise.resolve({}),
  });
}

afterEach(() => {
  mocks.cookie = undefined;
  vi.resetAllMocks();
});

describe('session page access', () => {
  it('offers owner recovery when the stored owner grant was replaced', async () => {
    // Owner recovery on another device replaces this browser's token.
    mocks.cookie = Buffer.from(JSON.stringify([staleOwnerGrant])).toString('base64url');
    mocks.querySharedConvex.mockRejectedValue(
      new ConvexError({ code: 'FORBIDDEN', message: 'Recording session access is denied.', retryable: false }),
    );

    const page = JSON.stringify(await render());

    expect(page).toContain('Invite required');
    expect(page).toContain('I created this session');
  });

  it('still fails when the backend cannot be reached', async () => {
    mocks.cookie = Buffer.from(JSON.stringify([staleOwnerGrant])).toString('base64url');
    mocks.querySharedConvex.mockRejectedValue(new TypeError('fetch failed'));

    await expect(render()).rejects.toThrow('fetch failed');
  });
});
