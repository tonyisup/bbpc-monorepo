import { describe, expect, it, vi } from 'vitest';
import { deliverSessionEvents } from './useSessionSync';
import type { SessionSyncEvent } from '@/types';

const startEvent: SessionSyncEvent = {
  kind: 'recording-started',
  startedAt: 1_000,
  startedByRole: 'owner',
};

describe('session event delivery', () => {
  it('rebuilds state without treating historical events as live commands', () => {
    const processed = new Set<string>();
    const onRemote = vi.fn();
    const onLive = vi.fn();

    deliverSessionEvents(
      [{ eventId: 'old-start', payload: startEvent }],
      processed,
      false,
      onRemote,
      onLive,
    );

    expect(onRemote).toHaveBeenCalledWith(startEvent);
    expect(onLive).not.toHaveBeenCalled();
  });

  it('delivers newly appended events to the live command callback', () => {
    const processed = new Set<string>(['old-start']);
    const stopEvent: SessionSyncEvent = {
      kind: 'recording-stopped',
      startedAt: 1_000,
      durationMs: 5_000,
      stoppedByRole: 'owner',
    };
    const onLive = vi.fn();

    deliverSessionEvents(
      [{ eventId: 'old-start', payload: startEvent }, { eventId: 'new-stop', payload: stopEvent }],
      processed,
      true,
      vi.fn(),
      onLive,
    );

    expect(onLive).toHaveBeenCalledTimes(1);
    expect(onLive).toHaveBeenCalledWith(stopEvent);
  });
});
