import type { RecordingSink } from '@/hooks/useRecordingEngine';
import { createPortableId } from '@/lib/portable-ids';
import { holdTakeLock, type DurableRecordingStore } from './durable-store';

/**
 * A recording sink that writes the take to this device as it is captured.
 * Writes run in order in the background; if one fails, `onUnavailable` is
 * called once and the take continues in memory only.
 */
export function createDurableSink(
  store: DurableRecordingStore,
  take: { sessionId: string; episode: string; hostName: string },
  onUnavailable: (error: unknown) => void,
): RecordingSink & { settled: () => Promise<void> } {
  const takeId = createPortableId('take');
  let writes: Promise<void> = Promise.resolve();
  let failed = false;
  let releaseLock = () => {};
  const enqueue = (write: () => Promise<void>) => {
    writes = writes.then(async () => {
      if (failed) return;
      try {
        await write();
      } catch (error) {
        failed = true;
        onUnavailable(error);
      }
    });
  };

  return {
    takeId,
    begin(startedAt, mimeTypes) {
      releaseLock = holdTakeLock(takeId);
      // Ask the browser not to evict recordings under storage pressure.
      void globalThis.navigator?.storage?.persist?.().catch(() => false);
      enqueue(async () => { await store.beginTake({ id: takeId, ...take, startedAt, mimeTypes }); });
    },
    chunk(track, data) {
      enqueue(() => store.appendChunk(takeId, track, data));
    },
    finish(durationMs) {
      enqueue(() => store.finishTake(takeId, durationMs));
      void writes.finally(releaseLock);
    },
    settled: () => writes,
  };
}
