'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useMutation, useQuery } from 'convex/react';
import type { FunctionArgs } from 'convex/server';
import {
  BBPC_CLIENT_API_VERSION,
  recordingApi,
} from '@/lib/convex/api';
import type { SessionSyncEvent } from '@/types';

interface UseSessionSyncOptions {
  sessionId: string;
  clientId: string;
  accessToken: string;
  onRemoteEvent: (event: SessionSyncEvent) => void;
  onLiveRemoteEvent?: (event: SessionSyncEvent) => void;
}

function createEventId(sessionId: string, from: string | undefined): string {
  const randomPart = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${sessionId}:${from ?? 'client'}:${Date.now()}:${randomPart}`;
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

type PendingEvent = FunctionArgs<typeof recordingApi.sessions.appendSessionEvent>;
interface QueueSnapshot { pendingCount: number; syncError: string | null }
interface PendingQueue {
  events: PendingEvent[];
  sending: Promise<void> | null;
  snapshot: QueueSnapshot;
}
const emptyQueueSnapshot: QueueSnapshot = { pendingCount: 0, syncError: null };
// Shared by all subscribers for this participant, and retained across navigation.
const pendingQueues = new Map<string, PendingQueue>();
const queueListeners = new Set<() => void>();
function subscribeQueue(listener: () => void) {
  queueListeners.add(listener);
  return () => { queueListeners.delete(listener); };
}
function publishQueue(queue: PendingQueue, syncError = queue.snapshot.syncError) {
  queue.snapshot = { pendingCount: queue.events.length, syncError };
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
  const { pendingCount, syncError } = useSyncExternalStore(
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
      try {
        while (queue.events.length) {
          // Keep event identity/order; use the currently authorized participant capability.
          await appendEvent({ ...queue.events[0] });
          queue.events.shift();
          publishQueue(queue);
        }
        publishQueue(queue, null);
      } catch (err) {
        publishQueue(queue, err instanceof Error ? err.message : 'Session changes could not be saved');
        throw err;
      } finally {
        queue.sending = null;
      }
    };
    queue.sending = Promise.resolve().then(flush);
    return queue.sending;
  }, [accessToken, appendEvent, queueKey]);

  const sendEvent = useCallback((event: SessionSyncEvent): Promise<void> => {
    let queue = pendingQueues.get(queueKey);
    if (!queue) {
      queue = { events: [], sending: null, snapshot: emptyQueueSnapshot };
      pendingQueues.set(queueKey, queue);
    }
    queue.events.push({
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      publicId: sessionId,
      clientId,
      accessToken,
      eventId: createEventId(sessionId, event.from),
      createdAt: Date.now(),
      payload: removeUndefined(event) as SessionSyncEvent,
    });
    publishQueue(queue);
    return retryPendingEvents();
  }, [accessToken, clientId, queueKey, retryPendingEvents, sessionId]);

  useEffect(() => {
    const retry = () => { void retryPendingEvents().catch(() => {}); };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [retryPendingEvents]);

  return { sendEvent, pendingCount, syncError, retryPendingEvents };
}
