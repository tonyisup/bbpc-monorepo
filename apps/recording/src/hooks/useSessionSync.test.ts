import { createRequire } from 'node:module';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverSessionEvents, useSessionSync } from './useSessionSync';
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

// Exercise the hook's actual mutation/retry path, including uncertain responses.

const mutation = vi.fn();
vi.mock('convex/react', () => ({ useMutation: () => mutation, useQuery: () => undefined }));
const { act, create } = createRequire(import.meta.url)('react-test-renderer');
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => { vi.unstubAllGlobals(); mutation.mockReset(); });

it('propagates failures, keeps ordered events and retries the same event ids', async () => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  let hook!: ReturnType<typeof useSessionSync>;
  function Harness() {
    hook = useSessionSync({ sessionId: 'sync-test', clientId: 'host', accessToken: 'test', onRemoteEvent: () => {} });
    return null;
  }
  let root: { unmount: () => void };
  await act(async () => { root = create(createElement(Harness)); });
  await act(async () => hook.retryPendingEvents());
  mutation.mockRejectedValue(new Error('offline'));
  await act(async () => { await expect(hook.sendEvent(startEvent)).rejects.toThrow('offline'); });
  expect(hook.pendingCount).toBe(1);
  expect(hook.syncError).toBe('offline');
  const first = mutation.mock.calls[0][0];
  await act(async () => { await expect(hook.sendEvent({ kind: 'recording-stopped', startedAt: 1000, durationMs: 5000, stoppedByRole: 'owner' })).rejects.toThrow('offline'); });
  expect(hook.pendingCount).toBe(2);
  mutation.mockResolvedValue(null);
  await act(async () => { await Promise.all([hook.retryPendingEvents(), hook.retryPendingEvents()]); });
  expect(mutation.mock.calls[2][0]).toEqual(first);
  expect(mutation.mock.calls[3][0].payload.kind).toBe('recording-stopped');
  expect(mutation).toHaveBeenCalledTimes(4);
  expect(hook.pendingCount).toBe(0);
  expect(hook.syncError).toBeNull();
  await act(async () => root.unmount());
});

it('preserves failed events across remounts and isolates them by participant', async () => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  let hook!: ReturnType<typeof useSessionSync>;
  function Harness({ clientId = 'host' }: { clientId?: string }) {
    hook = useSessionSync({ sessionId: 'failed-navigation', clientId, accessToken: 'test', onRemoteEvent: () => {} });
    return null;
  }
  let root: ReturnType<typeof create>;
  await act(async () => { root = create(createElement(Harness)); });
  mutation.mockRejectedValue(new Error('offline'));
  await act(async () => { await expect(hook.sendEvent(startEvent)).rejects.toThrow('offline'); });
  const original = mutation.mock.calls[0][0];
  await act(async () => root.unmount());
  await act(async () => { root = create(createElement(Harness, { clientId: 'guest' })); });
  expect(hook.pendingCount).toBe(0);
  await act(async () => root.unmount());
  await act(async () => { root = create(createElement(Harness)); });
  expect(hook.pendingCount).toBe(1);
  expect(hook.syncError).toBe('offline');
  mutation.mockResolvedValue(null);
  await act(async () => hook.retryPendingEvents());
  expect(mutation.mock.calls[1][0]).toEqual(original);
  expect(hook.pendingCount).toBe(0);
  await act(async () => root.unmount());
});

it('shares in-flight event sends across remounts and drains newly queued events once', async () => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  let hook!: ReturnType<typeof useSessionSync>;
  function Harness() {
    hook = useSessionSync({ sessionId: 'inflight-navigation', clientId: 'host', accessToken: 'test', onRemoteEvent: () => {} });
    return null;
  }
  let root: ReturnType<typeof create>;
  let resolveMutation!: (value: null) => void;
  mutation.mockImplementationOnce(() => new Promise(resolve => { resolveMutation = resolve; })).mockResolvedValue(null);
  await act(async () => { root = create(createElement(Harness)); });
  let sending!: Promise<void>;
  await act(async () => { sending = hook.sendEvent(startEvent); });
  const originalId = mutation.mock.calls[0][0].eventId;
  await act(async () => root.unmount());
  await act(async () => { root = create(createElement(Harness)); });
  expect(hook.pendingCount).toBe(1);
  expect(hook.retryPendingEvents()).toBe(sending);
  await act(async () => { expect(hook.sendEvent({ kind: 'recording-stopped', startedAt: 1000, durationMs: 5, stoppedByRole: 'owner' })).toBe(sending); });
  expect(mutation).toHaveBeenCalledTimes(1);
  await act(async () => { resolveMutation(null); await sending; });
  expect(mutation).toHaveBeenCalledTimes(2);
  expect(mutation.mock.calls[0][0].eventId).toBe(originalId);
  expect(mutation.mock.calls[1][0].payload.kind).toBe('recording-stopped');
  expect(hook.pendingCount).toBe(0);
  await act(async () => root.unmount());
});
