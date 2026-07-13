'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
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
  const events = useQuery(api.sessions.listSessionEvents, {
    publicId: sessionId,
    clientId,
    accessToken,
  });
  const appendEvent = useMutation(api.sessions.appendSessionEvent);
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

  const sendEvent = useCallback(async (event: SessionSyncEvent) => {
    try {
      await appendEvent({
        publicId: sessionId,
        clientId,
        accessToken,
        eventId: createEventId(sessionId, event.from),
        createdAt: Date.now(),
        payload: removeUndefined(event) as SessionSyncEvent,
      });
    } catch (err) {
      console.error('[Convex] Failed to append session event:', err);
    }
  }, [accessToken, appendEvent, clientId, sessionId]);

  return { sendEvent };
}
