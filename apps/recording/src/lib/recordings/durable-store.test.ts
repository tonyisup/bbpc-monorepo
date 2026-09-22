import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

import { DurableRecordingStore } from './durable-store';

function takeInput(id: string, startedAt = 1_000) {
  return {
    id,
    sessionId: 'sess_durable',
    episode: 'EP',
    hostName: 'Host',
    startedAt,
    mimeTypes: { mic: 'audio/webm;codecs=opus', sounders: 'audio/webm;codecs=opus' },
  };
}

describe('durable recording store', () => {
  it('keeps every chunk in order across a reopened database, as after a reload', async () => {
    const factory = new IDBFactory();
    const writer = new DurableRecordingStore(factory);
    await writer.beginTake(takeInput('take-1'));
    // Written without waiting, as the recorder emits them.
    await Promise.all(['one ', 'two ', 'three'].map(text => writer.appendChunk('take-1', 'mic', new Blob([text]))));
    await writer.appendChunk('take-1', 'sounders', new Blob(['ding']));

    const reader = new DurableRecordingStore(factory);
    const [take] = await reader.listTakes('sess_durable');
    expect(take).toMatchObject({ id: 'take-1', state: 'capturing', durationMs: null });
    expect(take.tracks.mic).toMatchObject({ chunkCount: 3, size: 13 });
    const mic = await reader.readTrack(take, 'mic');
    expect(mic.type).toBe('audio/webm;codecs=opus');
    expect(await mic.text()).toBe('one two three');
    expect(await (await reader.readTrack(take, 'sounders')).text()).toBe('ding');
  });

  it('records a normal stop and upload progress, and deletes a take with its chunks', async () => {
    const store = new DurableRecordingStore(new IDBFactory());
    await store.beginTake(takeInput('take-1'));
    await store.beginTake(takeInput('take-2', 5_000));
    await store.appendChunk('take-1', 'mic', new Blob(['audio']));
    await store.appendChunk('take-2', 'mic', new Blob(['other']));
    await store.finishTake('take-1', 2_000);
    await store.markBlockUploaded('take-1', 'mic', 0);
    await store.markBlockUploaded('take-1', 'mic', 0);
    await store.markCommitted('take-1', 'mic');

    expect(await store.getTake('take-1')).toMatchObject({
      state: 'saved',
      durationMs: 2_000,
      tracks: { mic: { uploadedBlocks: [0], committed: true }, sounders: { committed: false } },
    });

    await store.deleteTake('take-1');
    expect((await store.listTakes('sess_durable')).map(take => take.id)).toEqual(['take-2']);
    const remaining = (await store.getTake('take-2'))!;
    expect(await (await store.readTrack(remaining, 'mic')).text()).toBe('other');
    await expect(store.appendChunk('take-1', 'mic', new Blob(['late']))).rejects.toThrow('removed');
  });

  it('treats a capturing take as abandoned once its chunks stop, without Web Locks', async () => {
    const store = new DurableRecordingStore(new IDBFactory());
    const take = await store.beginTake(takeInput('take-1', Date.now()));
    expect(await store.isTakeLive(take)).toBe(true);
    expect(await store.isTakeLive({ ...take, lastChunkAt: Date.now() - 60_000 })).toBe(false);
    expect(await store.isTakeLive({ ...take, state: 'saved' })).toBe(false);
  });
});
