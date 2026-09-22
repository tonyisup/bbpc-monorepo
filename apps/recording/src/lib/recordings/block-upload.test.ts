import { afterEach, describe, expect, it, vi } from 'vitest';

import { uploadTrackInBlocks } from './block-upload';
import { RECORDING_BLOCK_BYTES } from './upload';

const fetchMock = vi.fn();
afterEach(() => { vi.unstubAllGlobals(); fetchMock.mockReset(); });

function track(size: number) {
  return new Blob([new Uint8Array(size)], { type: 'audio/webm;codecs=opus' });
}

function requests() {
  return fetchMock.mock.calls.map(call => {
    const [url, init] = call as [string, RequestInit];
    const parsed = new URL(url, 'https://recording.example.test');
    return `${init.method} ${parsed.pathname}${parsed.searchParams.has('index') ? `#${parsed.searchParams.get('index')}` : ''}`;
  });
}

describe('block uploads', () => {
  it('sends a long recording as blocks under the hosting limit, then commits it', async () => {
    vi.stubGlobal('fetch', fetchMock.mockResolvedValue(new Response('{}')));
    const blocks: number[] = [];
    const size = 2 * RECORDING_BLOCK_BYTES + 10;
    await uploadTrackInBlocks({
      sessionId: 'sess', episode: 'EP', trackType: 'mic', startedAt: 1_000,
      blob: track(size), uploadedBlocks: new Set(), onBlockUploaded: index => { blocks.push(index); },
    });
    expect(requests()).toEqual(['PUT /api/recordings/blocks#0', 'PUT /api/recordings/blocks#1', 'PUT /api/recordings/blocks#2', 'POST /api/recordings/commit']);
    expect(fetchMock.mock.calls.slice(0, 3).map(([, init]) => (init.body as Blob).size)).toEqual([RECORDING_BLOCK_BYTES, RECORDING_BLOCK_BYTES, 10]);
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toMatchObject({ blockCount: 3, size, startedAt: 1_000, contentType: 'audio/webm;codecs=opus' });
    expect(blocks).toEqual([0, 1, 2]);
  });

  it('resumes by skipping blocks already staged', async () => {
    vi.stubGlobal('fetch', fetchMock.mockResolvedValue(new Response('{}')));
    await uploadTrackInBlocks({
      sessionId: 'sess', episode: 'EP', trackType: 'mic', startedAt: 1_000,
      blob: track(2 * RECORDING_BLOCK_BYTES + 10), uploadedBlocks: new Set([0, 1]),
    });
    expect(requests()).toEqual(['PUT /api/recordings/blocks#2', 'POST /api/recordings/commit']);
  });

  it('sends every block again when a resumed commit finds blocks missing', async () => {
    vi.stubGlobal('fetch', fetchMock
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response('{"message":"Recording commit failed"}', { status: 502 }))
      .mockResolvedValue(new Response('{}')));
    await uploadTrackInBlocks({
      sessionId: 'sess', episode: 'EP', trackType: 'sounders', startedAt: 1_000,
      blob: track(RECORDING_BLOCK_BYTES + 1), uploadedBlocks: new Set([0]),
    });
    expect(requests()).toEqual([
      'PUT /api/recordings/blocks#1', 'POST /api/recordings/commit',
      'PUT /api/recordings/blocks#0', 'PUT /api/recordings/blocks#1', 'POST /api/recordings/commit',
    ]);
  });

  it('reports the server message and skips empty tracks', async () => {
    vi.stubGlobal('fetch', fetchMock.mockResolvedValue(new Response('{"message":"Session access denied"}', { status: 403 })));
    await expect(uploadTrackInBlocks({
      sessionId: 'sess', episode: 'EP', trackType: 'mic', startedAt: 1_000, blob: track(5), uploadedBlocks: new Set(),
    })).rejects.toThrow('Session access denied');
    fetchMock.mockClear();
    await uploadTrackInBlocks({ sessionId: 'sess', episode: 'EP', trackType: 'mic', startedAt: 1_000, blob: track(0), uploadedBlocks: new Set() });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
