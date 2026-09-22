import 'fake-indexeddb/auto';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRecordingUpload } from './useRecordingUpload';
import { durableRecordingStore } from '@/lib/recordings/durable-store';

const { act, create } = createRequire(import.meta.url)('react-test-renderer');
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => vi.unstubAllGlobals());

interface SentRequest { method: string; path: string; trackType: string; index?: number; body?: Record<string, unknown> }

// The block routes: PUT /api/recordings/blocks?…&index=n, then POST /api/recordings/commit.
function recordRequests(respond: (request: SentRequest) => Response | Promise<Response>) {
  const requests: SentRequest[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const parsed = new URL(url, 'https://recording.example.test');
    const body = parsed.pathname.endsWith('/commit') ? JSON.parse(init.body as string) : undefined;
    const request: SentRequest = {
      method: init.method ?? 'GET',
      path: parsed.pathname,
      trackType: body?.trackType ?? parsed.searchParams.get('trackType'),
      ...(parsed.searchParams.has('index') ? { index: Number(parsed.searchParams.get('index')) } : {}),
      ...(body ? { body } : {}),
    };
    requests.push(request);
    return respond(request);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { requests, fetchMock };
}

const ok = () => new Response('{}');

describe('recording upload recovery', () => {
  it('retains failed bytes, reuses original metadata, retries only failed tracks and prevents duplicate requests', async () => {
    let hook!: ReturnType<typeof useRecordingUpload>;
    function Harness({ episode = 'EP-original' }: { episode?: string }) {
      hook = useRecordingUpload('recovery-test', episode, 'Host');
      return null;
    }
    let root: { update: (node: ReturnType<typeof createElement>) => void; unmount: () => void };
    let failSounders = true;
    const { requests } = recordRequests(request => (
      request.trackType === 'sounders' && failSounders
        ? new Response('{"message":"Could not upload sounders audio"}', { status: 502 })
        : ok()
    ));
    await act(async () => { root = create(createElement(Harness)); });
    const tracks = { mic: new Blob(['mic'], { type: 'audio/mp4' }), sounders: new Blob(['sounders'], { type: 'audio/ogg;codecs=opus' }), startedAt: 42, durationMs: 1000 };
    await act(async () => { expect(await hook.upload(tracks)).toBe(false); });
    expect(hook.pending?.tracks.mic).toBe(tracks.mic);
    expect(hook.status).toBe('error');
    expect(hook.error).toContain('sounders');
    expect(requests.find(request => request.path.endsWith('/commit'))?.body).toMatchObject({ trackType: 'mic', contentType: 'audio/mp4' });
    await act(async () => { root.update(createElement(Harness, { episode: 'EP-changed' })); });
    failSounders = false;
    const before = requests.length;
    await act(async () => { await Promise.all([hook.retry(), hook.retry()]); });
    // Only the sounders track again: one block and its commit.
    expect(requests.slice(before).map(request => `${request.method} ${request.trackType}`)).toEqual(['PUT sounders', 'POST sounders']);
    expect(requests.at(-1)?.body).toMatchObject({ trackType: 'sounders', episode: 'EP-original', startedAt: 42 });
    expect(hook.pending).toBeNull();
    expect(hook.status).toBe('done');
    await act(async () => root.unmount());
  });

  it('keeps audio available after client navigation and only clears it on explicit disposal', async () => {
    let hook!: ReturnType<typeof useRecordingUpload>;
    function Harness() { hook = useRecordingUpload('navigation-test', 'EP', 'Host'); return null; }
    let root: { unmount: () => void };
    await act(async () => { root = create(createElement(Harness)); });
    const tracks = { mic: new Blob(['mic']), sounders: new Blob(['sounders']), startedAt: 99, durationMs: 1 };
    await act(async () => hook.retain(tracks));
    await act(async () => root.unmount());
    await act(async () => { root = create(createElement(Harness)); });
    expect(hook.pending?.tracks).toBe(tracks);
    await act(async () => hook.discard());
    expect(hook.hasPending()).toBe(false);
    await act(async () => root.unmount());
  });
});

it('shares an in-flight upload lock across remounts and never deletes a later recording', async () => {
  let hook!: ReturnType<typeof useRecordingUpload>;
  function Harness() { hook = useRecordingUpload('upload-remount-race', 'EP', 'Host'); return null; }
  let root: { unmount: () => void };
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const { fetchMock } = recordRequests(async () => { await gate; return ok(); });
  await act(async () => { root = create(createElement(Harness)); });
  const first = { mic: new Blob(['first'], { type: 'audio/webm' }), sounders: new Blob(['first'], { type: 'audio/webm' }), startedAt: 100, durationMs: 1 };
  const second = { mic: new Blob(['second']), sounders: new Blob(['second']), startedAt: 200, durationMs: 1 };
  let upload!: Promise<boolean>;
  await act(async () => { upload = hook.upload(first); });
  await act(async () => root.unmount());
  await act(async () => { root = create(createElement(Harness)); });
  expect(hook.status).toBe('uploading');
  expect(hook.retry()).toBe(upload);
  await act(async () => hook.discard());
  expect(hook.pending?.tracks).toBe(first);
  expect(() => hook.retain(second)).toThrow('pending recording');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await act(async () => { release(); await upload; });
  expect(hook.status).toBe('done');
  expect(hook.pending).toBeNull();
  await act(async () => hook.retain(second));
  await act(async () => { await upload; });
  expect(hook.pending?.tracks).toBe(second);
  await act(async () => hook.discard());
  await act(async () => root.unmount());
});

it('offers a take left on this device by an interrupted page and resumes its upload', async () => {
  // Audit: "a reload, browser crash or lost tab destroys unsaved audio".
  const store = durableRecordingStore()!;
  await store.beginTake({
    id: 'take-crashed',
    sessionId: 'reload-test',
    episode: 'EP-before-crash',
    hostName: 'Guest',
    startedAt: 5_000,
    mimeTypes: { mic: 'audio/webm;codecs=opus', sounders: 'audio/webm;codecs=opus' },
  });
  await store.appendChunk('take-crashed', 'mic', new Blob(['captured ']));
  await store.appendChunk('take-crashed', 'mic', new Blob(['before crash']));
  // The crashed tab staged the first block before it died.
  await store.markBlockUploaded('take-crashed', 'mic', 0);

  // After a reload no tab holds the take's lock any more.
  vi.stubGlobal('navigator', { locks: { query: async () => ({ held: [] }) } });
  const { requests } = recordRequests(() => ok());
  let hook!: ReturnType<typeof useRecordingUpload>;
  function Harness() { hook = useRecordingUpload('reload-test', 'EP-now', 'Guest'); return null; }
  let root!: { unmount: () => void };
  await act(async () => { root = create(createElement(Harness)); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });

  expect(hook.notice).toContain('interrupted');
  expect(hook.pending?.tracks).toMatchObject({ startedAt: 5_000, takeId: 'take-crashed' });
  expect(await hook.pending!.tracks.mic.text()).toBe('captured before crash');
  expect(hook.pending!.tracks.sounders.size).toBe(0);

  await act(async () => { expect(await hook.retry()).toBe(true); });
  // Block 0 was already staged, so only the commit is sent; empty sounders are skipped.
  expect(requests.map(request => `${request.method} ${request.path}`)).toEqual(['POST /api/recordings/commit']);
  expect(requests[0].body).toMatchObject({ episode: 'EP-before-crash', startedAt: 5_000, blockCount: 1, size: 21 });
  expect(await store.getTake('take-crashed')).toBeNull();
  await act(async () => root.unmount());
});
