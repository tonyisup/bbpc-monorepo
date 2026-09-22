'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useMutation, useQuery } from 'convex/react';
import type { FunctionArgs } from 'convex/server';
import { ConvexError } from 'convex/values';
import type { DomainErrorCode } from '@tonyisup/bbpc-convex-api/contracts';
import {
  BBPC_CLIENT_API_VERSION,
  recordingApi,
} from '@/lib/convex/api';
import { createPortableId } from '@/lib/portable-ids';
import type { SessionSyncEvent } from '@/types';

interface UseSessionSyncOptions {
  sessionId: string;
  clientId: string;
  accessToken: string;
  onRemoteEvent: (event: SessionSyncEvent) => void;
  onLiveRemoteEvent?: (event: SessionSyncEvent) => void;
}

export function createEventId(): string {
  return createPortableId('evt');
}

function removeUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(removeUndefined);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, removeUndefined(entry)]),
    );
  }

  return value;
}

export function deliverSessionEvents(
  events: Array<{ eventId: string; payload: unknown }>,
  processedEventIds: Set<string>,
  initialized: boolean,
  onRemoteEvent: (event: SessionSyncEvent) => void,
  onLiveRemoteEvent?: (event: SessionSyncEvent) => void,
): void {
  for (const event of events) {
    if (processedEventIds.has(event.eventId)) continue;
    processedEventIds.add(event.eventId);
    const payload = event.payload as SessionSyncEvent;
    onRemoteEvent(payload);
    if (initialized) onLiveRemoteEvent?.(payload);
  }
}

// Rejections that no retry of the same event can fix. Retrying one would block
// every later event in the ordered queue, so it is dropped and counted instead.
const PERMANENT_REJECTION_CODES: ReadonlySet<DomainErrorCode> = new Set([
  'VALIDATION_FAILED',
  'FORBIDDEN',
  'CONFLICT',
  'NOT_FOUND',
]);

export function isPermanentEventRejection(error: unknown): boolean {
  if (!(error instanceof ConvexError)) return false;
  const data: unknown = error.data;
  if (!data || typeof data !== 'object') return false;
  const { code, retryable } = data as { code?: unknown; retryable?: unknown };
  return retryable === false
    && typeof code === 'string'
    && PERMANENT_REJECTION_CODES.has(code as DomainErrorCode);
}

function rejectionMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    const data: unknown = error.data;
    if (data && typeof data === 'object' && typeof (data as { message?: unknown }).message === 'string') {
      return (data as { message: string }).message;
    }
  }
  return error instanceof Error ? error.message : 'A session change was rejected';
}

type PendingEvent = FunctionArgs<typeof recordingApi.sessions.appendSessionEvent>;
interface QueueSnapshot { pendingCount: number; syncError: string | null; rejectedCount: number }
interface PendingQueue {
  events: PendingEvent[];
  sending: Promise<void> | null;
  rejectedCount: number;
  snapshot: QueueSnapshot;
}
const emptyQueueSnapshot: QueueSnapshot = { pendingCount: 0, syncError: null, rejectedCount: 0 };
// Each sendEvent caller waits for its own event only, so one rejected event
// cannot fail a later, unrelated one. Keyed by eventId, outside the mutation args.
const eventWaiters = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
function settleEvent(eventId: string, error?: Error) {
  const waiter = eventWaiters.get(eventId);
  if (!waiter) return;
  eventWaiters.delete(eventId);
  if (error) waiter.reject(error);
  else waiter.resolve();
}
// Shared by all subscribers for this participant, and retained across navigation.
const pendingQueues = new Map<string, PendingQueue>();
const queueListeners = new Set<() => void>();
function subscribeQueue(listener: () => void) {
  queueListeners.add(listener);
  return () => { queueListeners.delete(listener); };
}
function publishQueue(queue: PendingQueue, syncError = queue.snapshot.syncError) {
  queue.snapshot = { pendingCount: queue.events.length, syncError, rejectedCount: queue.rejectedCount };
  queueListeners.forEach(listener => listener());
}
const serverQueueSnapshot = () => emptyQueueSnapshot;

/**
 * Subscribe to and publish session events through Convex.
 */
export function useSessionSync({
  sessionId,
  clientId,
  accessToken,
  onRemoteEvent,
  onLiveRemoteEvent,
}: UseSessionSyncOptions) {
  const events = useQuery(recordingApi.sessions.listSessionEvents, {
    publicId: sessionId,
    clientId,
    accessToken,
  });
  const appendEvent = useMutation(recordingApi.sessions.appendSessionEvent);
  const processedEventIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const onRemoteRef = useRef(onRemoteEvent);
  const onLiveRemoteRef = useRef(onLiveRemoteEvent);

  useEffect(() => {
    onRemoteRef.current = onRemoteEvent;
  }, [onRemoteEvent]);

  useEffect(() => {
    onLiveRemoteRef.current = onLiveRemoteEvent;
  }, [onLiveRemoteEvent]);

  useEffect(() => {
    if (!events) return;

    deliverSessionEvents(
      events,
      processedEventIdsRef.current,
      initializedRef.current,
      onRemoteRef.current,
      onLiveRemoteRef.current,
    );
    initializedRef.current = true;
  }, [events]);

  const queueKey = JSON.stringify([sessionId, clientId]);
  const { pendingCount, syncError, rejectedCount } = useSyncExternalStore(
    subscribeQueue,
    useCallback(() => pendingQueues.get(queueKey)?.snapshot ?? emptyQueueSnapshot, [queueKey]),
    serverQueueSnapshot,
  );

  const retryPendingEvents = useCallback((): Promise<void> => {
    const queue = pendingQueues.get(queueKey);
    if (!queue || !queue.events.length) return Promise.resolve();
    queue.events.forEach(event => { event.accessToken = accessToken; });
    if (queue.sending) return queue.sending;
    const flush = async () => {
      let rejection: unknown = null;
      try {
        while (queue.events.length) {
          const event = queue.events[0];
          try {
            // Keep event identity/order; use the currently authorized participant capability.
            await appendEvent({ ...event });
            settleEvent(event.eventId);
          } catch (err) {
            if (!isPermanentEventRejection(err)) throw err;
            console.error('[Session Sync] Event rejected and dropped:', event.payload.kind, err);
            queue.rejectedCount += 1;
            rejection = err;
            settleEvent(event.eventId, new Error(rejectionMessage(err)));
          }
          queue.events.shift();
          publishQueue(queue);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Session changes could not be saved';
        publishQueue(queue, message);
        // Still queued for a retry, but nothing is saved yet for these callers.
        for (const event of queue.events) settleEvent(event.eventId, err instanceof Error ? err : new Error(message));
        throw err;
      } finally {
        queue.sending = null;
      }
      if (rejection !== null) {
        const message = rejectionMessage(rejection);
        publishQueue(queue, message);
        throw new Error(message);
      }
      publishQueue(queue, null);
    };
    queue.sending = Promise.resolve().then(flush);
    return queue.sending;
  }, [accessToken, appendEvent, queueKey]);

  const sendEvent = useCallback((event: SessionSyncEvent): Promise<void> => {
    let queue = pendingQueues.get(queueKey);
    if (!queue) {
      queue = { events: [], sending: null, rejectedCount: 0, snapshot: emptyQueueSnapshot };
      pendingQueues.set(queueKey, queue);
    }
    const eventId = createEventId();
    const saved = new Promise<void>((resolve, reject) => { eventWaiters.set(eventId, { resolve, reject }); });
    queue.events.push({
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      publicId: sessionId,
      clientId,
      accessToken,
      eventId,
      createdAt: Date.now(),
      payload: removeUndefined(event) as SessionSyncEvent,
    });
    publishQueue(queue);
    // Failures reach this event's caller through `saved` and the sync banner.
    retryPendingEvents().catch(() => {});
    return saved;
  }, [accessToken, clientId, queueKey, retryPendingEvents, sessionId]);

  useEffect(() => {
    const retry = () => { void retryPendingEvents().catch(() => {}); };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [retryPendingEvents]);

  return { sendEvent, pendingCount, syncError, rejectedCount, retryPendingEvents };
}
