import { createRequire } from 'node:module';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRecordingUpload } from './useRecordingUpload';

const { act, create } = createRequire(import.meta.url)('react-test-renderer');
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => vi.unstubAllGlobals());

describe('recording upload recovery', () => {
  it('retains failed bytes, reuses original metadata, retries only failed tracks and prevents duplicate requests', async () => {
    let hook!: ReturnType<typeof useRecordingUpload>;
    function Harness({ episode = 'EP-original' }: { episode?: string }) {
      hook = useRecordingUpload('recovery-test', episode, 'Host');
      return null;
    }
    let root: { update: (node: ReturnType<typeof createElement>) => void; unmount: () => void };
    const requests: Array<Record<string, unknown>> = [];
    let failSounders = true;
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      return { ok: body.trackType !== 'sounders' || !failSounders, status: 500 };
    }));
    await act(async () => { root = create(createElement(Harness)); });
    const tracks = { mic: new Blob(['mic'], { type: 'audio/mp4' }), sounders: new Blob(['sounders'], { type: 'audio/ogg;codecs=opus' }), startedAt: 42, durationMs: 1000 };
    await act(async () => { expect(await hook.upload(tracks)).toBe(false); });
    expect(hook.pending?.tracks.mic).toBe(tracks.mic);
    expect(hook.status).toBe('error');
    expect(hook.error).toContain('sounders');
    expect(requests[0].contentType).toBe('audio/mp4');
    await act(async () => { root.update(createElement(Harness, { episode: 'EP-changed' })); });
    failSounders = false;
    await act(async () => { await Promise.all([hook.retry(), hook.retry()]); });
    expect(requests).toHaveLength(3);
    expect(requests[2]).toMatchObject({ trackType: 'sounders', episode: 'EP-original', startedAt: 42 });
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
  let resolveUpload!: (value: { ok: boolean; status: number }) => void;
  const response = new Promise<{ ok: boolean; status: number }>(resolve => { resolveUpload = resolve; });
  const fetchMock = vi.fn(() => response);
  vi.stubGlobal('fetch', fetchMock);
  await act(async () => { root = create(createElement(Harness)); });
  const first = { mic: new Blob(['first']), sounders: new Blob(['first']), startedAt: 100, durationMs: 1 };
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
  await act(async () => { resolveUpload({ ok: true, status: 200 }); await upload; });
  expect(hook.status).toBe('done');
  expect(hook.pending).toBeNull();
  await act(async () => hook.retain(second));
  await act(async () => { await upload; });
  expect(hook.pending?.tracks).toBe(second);
  await act(async () => hook.discard());
  await act(async () => root.unmount());
});
