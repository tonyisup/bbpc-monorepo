import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';

import { createDurableSink } from './durable-sink';
import { DurableRecordingStore } from './durable-store';

const take = { sessionId: 'sess_sink', episode: 'EP', hostName: 'Host' };
const mimeTypes = { mic: 'audio/webm', sounders: 'audio/webm' };

describe('durable recording sink', () => {
  it('writes the take to the device as it is captured', async () => {
    const store = new DurableRecordingStore(new IDBFactory());
    const unavailable = vi.fn();
    const sink = createDurableSink(store, take, unavailable);
    sink.begin(1_000, mimeTypes);
    sink.chunk('mic', new Blob(['a']));
    sink.chunk('mic', new Blob(['b']));
    sink.chunk('sounders', new Blob(['s']));
    sink.finish(2_000);
    await sink.settled();

    const saved = (await store.getTake(sink.takeId))!;
    expect(saved).toMatchObject({ sessionId: 'sess_sink', startedAt: 1_000, durationMs: 2_000, state: 'saved' });
    expect(await (await store.readTrack(saved, 'mic')).text()).toBe('ab');
    expect(unavailable).not.toHaveBeenCalled();
  });

  it('reports a failed write once and stops writing', async () => {
    const store = new DurableRecordingStore(new IDBFactory());
    vi.spyOn(store, 'appendChunk').mockRejectedValue(new Error('QuotaExceededError'));
    const unavailable = vi.fn();
    const sink = createDurableSink(store, take, unavailable);
    sink.begin(1_000, mimeTypes);
    sink.chunk('mic', new Blob(['a']));
    sink.chunk('mic', new Blob(['b']));
    sink.finish(2_000);
    await sink.settled();
    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(store.appendChunk).toHaveBeenCalledTimes(1);
  });
});
