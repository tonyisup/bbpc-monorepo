import { afterEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  findParticipantForGrant: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock('@/lib/sessions/store', () => store);

const { GET } = await import('./route');

const grants = Buffer.from(JSON.stringify([{ sessionId: 'sess_1', clientId: 'client_a', accessToken: 'access_a' }])).toString('base64url');
const participant = { clientId: 'client_a', displayName: 'Guest', role: 'participant', joinedAt: '', accessToken: 'access_a' };

function requestIce() {
  return GET(
    new Request('https://recording.example.test/api/sessions/sess_1/rtc/ice', { headers: { cookie: `bbpc-session-grants=${grants}` } }),
    { params: Promise.resolve({ sessionId: 'sess_1' }) },
  );
}

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

describe('ICE credentials', () => {
  it('issues relay credentials to participants of an active session', async () => {
    vi.stubEnv('TURN_URLS', 'turn:turn.example.test:3478');
    vi.stubEnv('TURN_STATIC_AUTH_SECRET', 'synthetic-secret');
    store.findParticipantForGrant.mockResolvedValue(participant);
    store.getSession.mockResolvedValue({ id: 'sess_1', status: 'active' });

    const response = await requestIce();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.iceServers).toEqual(expect.arrayContaining([
      expect.objectContaining({ urls: ['turn:turn.example.test:3478'], credential: expect.any(String) }),
    ]));
  });

  it('refuses relay credentials once the session has ended', async () => {
    // Audit: ended membership stays valid for export and could keep minting TURN credentials.
    store.findParticipantForGrant.mockResolvedValue(participant);
    store.getSession.mockResolvedValue({ id: 'sess_1', status: 'ended' });

    const response = await requestIce();

    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain('credential');
  });

  it('refuses a missing or rejected grant', async () => {
    store.findParticipantForGrant.mockResolvedValue(null);

    expect((await requestIce()).status).toBe(403);
    expect(store.getSession).not.toHaveBeenCalled();
  });
});
