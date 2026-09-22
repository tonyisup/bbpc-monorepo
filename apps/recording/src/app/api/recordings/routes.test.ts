import { afterEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  const blobs = new Map<string, { staged: Map<string, Uint8Array>; committed: Uint8Array | null; contentType?: string }>();
  const blobFor = (name: string) => {
    if (!blobs.has(name)) blobs.set(name, { staged: new Map(), committed: null });
    return blobs.get(name)!;
  };
  const container = {
    getBlockBlobClient: (name: string) => ({
      url: `https://storage.example.test/recordings/${name}`,
      stageBlock: vi.fn(async (id: string, body: Uint8Array) => { blobFor(name).staged.set(id, body); }),
      commitBlockList: vi.fn(async (ids: string[], options: { blobHTTPHeaders: { blobContentType: string } }) => {
        const blob = blobFor(name);
        const parts = ids.map(id => {
          const part = blob.staged.get(id);
          if (!part) throw new Error('InvalidBlockList');
          return part;
        });
        blob.committed = new Uint8Array(parts.flatMap(part => [...part]));
        blob.contentType = options.blobHTTPHeaders.blobContentType;
      }),
      getProperties: vi.fn(async () => ({ contentLength: blobFor(name).committed?.byteLength })),
    }),
  };
  return {
    blobs,
    container,
    access: vi.fn(),
    saveUpload: vi.fn(async () => 'upload-id'),
  };
});

vi.mock('@/lib/recordings/access', () => ({ recordingParticipantFor: fake.access }));
vi.mock('@/lib/convex/http', () => ({ mutateSharedConvex: fake.saveUpload }));
vi.mock('@/lib/recordings/storage', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/recordings/storage')>()),
  getRecordingsContainer: async () => fake.container,
}));
vi.mock('server-only', () => ({}));

const { PUT } = await import('./blocks/route');
const { POST } = await import('./commit/route');

const participant = { clientId: 'client_guest', displayName: 'Guest', role: 'participant', joinedAt: '', accessToken: 'access' };
const grant = { sessionId: 'sess_up', clientId: 'client_guest', accessToken: 'access_guest_abcdefghijklmnopqrstuvwxyz' };
const take = { sessionId: 'sess_up', trackType: 'mic', startedAt: '1700000000000', contentType: 'audio/webm;codecs=opus' };
const blobName = 'sess_up/2023-11-14T22-13-20-000Z/take-client_guest-mic.webm';

function stage(index: number, bytes: Uint8Array) {
  const query = new URLSearchParams({ ...take, index: String(index) });
  return PUT(new Request(`https://recording.example.test/api/recordings/blocks?${query}`, { method: 'PUT', body: new Blob([bytes as Uint8Array<ArrayBuffer>]) }));
}

function commit(extra: Record<string, unknown>) {
  return POST(new Request('https://recording.example.test/api/recordings/commit', {
    method: 'POST',
    body: JSON.stringify({ ...take, startedAt: Number(take.startedAt), episode: 'EP-1', ...extra }),
  }));
}

afterEach(() => {
  fake.blobs.clear();
  vi.clearAllMocks();
});

describe('block upload routes', () => {
  it('stages blocks in any order and commits them into one blob with its metadata', async () => {
    fake.access.mockResolvedValue({ grant, participant });
    expect((await stage(1, new Uint8Array([4, 5]))).status).toBe(200);
    expect((await stage(0, new Uint8Array([1, 2, 3]))).status).toBe(200);
    // A retried block replaces itself.
    expect((await stage(1, new Uint8Array([4, 5]))).status).toBe(200);

    const response = await commit({ blockCount: 2, size: 5 });
    expect(response.status).toBe(200);
    expect([...fake.blobs.get(blobName)!.committed!]).toEqual([1, 2, 3, 4, 5]);
    expect(fake.blobs.get(blobName)!.contentType).toBe('audio/webm;codecs=opus');
    expect(fake.saveUpload).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      publicSessionId: 'sess_up',
      clientId: 'client_guest',
      hostName: 'Guest',
      blobName,
      url: `https://storage.example.test/recordings/${blobName}`,
      size: 5,
      startedAt: 1_700_000_000_000,
    }));
  });

  it('fails a commit while a block is missing, without saving metadata', async () => {
    fake.access.mockResolvedValue({ grant, participant });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await stage(0, new Uint8Array([1]));
    expect((await commit({ blockCount: 2, size: 2 })).status).toBe(502);
    await stage(1, new Uint8Array([2]));
    expect((await commit({ blockCount: 2, size: 3 })).status).toBe(409);
    expect(fake.saveUpload).not.toHaveBeenCalled();
  });

  it('refuses unauthenticated requests and blocks over the hosting limit', async () => {
    fake.access.mockResolvedValue(null);
    expect((await stage(0, new Uint8Array([1]))).status).toBe(403);
    expect((await commit({ blockCount: 1, size: 1 })).status).toBe(403);

    fake.access.mockResolvedValue({ grant, participant });
    expect((await stage(0, new Uint8Array(3 * 1024 * 1024 + 1))).status).toBe(413);
    expect((await stage(-1, new Uint8Array([1]))).status).toBe(400);
    expect((await commit({ blockCount: 0, size: 1 })).status).toBe(400);
    expect(fake.blobs.size).toBe(0);
  });
});
