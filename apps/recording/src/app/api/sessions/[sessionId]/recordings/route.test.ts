import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  hasSessionAccess: vi.fn(),
  listBySession: vi.fn(),
  sign: vi.fn(),
}));
vi.mock('@/lib/sessions/store', () => ({ hasSessionAccess: mocks.hasSessionAccess }));
vi.mock('@/lib/convex/http', () => ({ querySharedConvex: mocks.listBySession }));
vi.mock('@/lib/recordings/storage', () => ({ signedRecordingUrl: mocks.sign }));

const { GET } = await import('./route');

const grants = Buffer.from(JSON.stringify([{ sessionId: 'sess_1', clientId: 'client_a', accessToken: 'access_a' }])).toString('base64url');
const upload = { id: 'u1', blobName: 'sess_1/take/take-client_a-mic.webm', url: 'https://bbpctest.blob.core.windows.net/recordings/sess_1/take/take-client_a-mic.webm' };

function list() {
  return GET(
    new NextRequest('https://recording.example.test/api/sessions/sess_1/recordings', { headers: { cookie: `bbpc-session-grants=${grants}` } }),
    { params: Promise.resolve({ sessionId: 'sess_1' }) },
  );
}

afterEach(() => vi.resetAllMocks());

describe('session recordings list', () => {
  it('replaces stored URLs with expiring signed links', async () => {
    mocks.hasSessionAccess.mockResolvedValue(true);
    mocks.listBySession.mockResolvedValue([upload]);
    mocks.sign.mockResolvedValue({ url: `${upload.url}?sp=r&sig=abc`, expiresAt: 5_000 });

    const body = await (await list()).json();

    expect(mocks.sign).toHaveBeenCalledWith(upload.blobName);
    expect(body.recordings).toEqual([{ ...upload, url: `${upload.url}?sp=r&sig=abc`, urlExpiresAt: 5_000 }]);
  });

  it('refuses rather than returning unsigned links when signing fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.hasSessionAccess.mockResolvedValue(true);
    mocks.listBySession.mockResolvedValue([upload]);
    mocks.sign.mockRejectedValue(new Error('Account key missing'));

    const response = await list();

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(upload.url);
  });
});
