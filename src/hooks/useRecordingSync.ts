'use client';

import { useCallback, useId, useRef } from 'react';
import { useSessionSync } from './useSessionSync';
import type { SessionSyncEvent } from '@/types';
import type { SessionRole } from '@/lib/sessions/types';

interface RecordingSyncOptions {
  sessionId: string;
  clientId: string;
  accessToken: string;
  participantRole: SessionRole;
  onRemoteStart: (startedAt: number) => void;
  onRemoteStop: (startedAt: number, durationMs: number) => void;
}

/**
 * Syncs recording start/stop events across hosts via Convex session events.
 */
export function useRecordingSync({
  sessionId,
  clientId,
  accessToken,
  participantRole,
  onRemoteStart,
  onRemoteStop,
}: RecordingSyncOptions) {
  const reactId = useId();
  const sessionIdRef = useRef(`rec-${reactId}`);

  const handleRemoteEvent = useCallback((event: SessionSyncEvent) => {
    if (
      event.kind === 'recording-started'
      && event.from !== sessionIdRef.current
      && event.startedByRole === 'owner'
    ) {
      onRemoteStart(event.startedAt);
    }
    if (
      event.kind === 'recording-stopped'
      && event.from !== sessionIdRef.current
      && event.stoppedByRole === 'owner'
    ) {
      onRemoteStop(event.startedAt, event.durationMs);
    }
  }, [onRemoteStart, onRemoteStop]);

  const { sendEvent } = useSessionSync({
    sessionId,
    clientId,
    accessToken,
    onRemoteEvent: () => {},
    onLiveRemoteEvent: handleRemoteEvent,
  });

  const broadcastStart = useCallback((
    startedAt: number,
    participant: { clientId: string; name: string; joinedAt: number },
  ) => {
    if (participantRole !== 'owner') return;

    return sendEvent({
      kind: 'recording-started',
      startedAt,
      startedByRole: 'owner',
      participant: {
        ...participant,
        role: 'owner',
      },
      from: sessionIdRef.current,
    });
  }, [participantRole, sendEvent]);

  const broadcastStop = useCallback((
    startedAt: number,
    durationMs: number,
    participant: { clientId: string; leftAt: number },
  ) => {
    if (participantRole !== 'owner') return;

    return sendEvent({
      kind: 'recording-stopped',
      startedAt,
      durationMs,
      stoppedByRole: 'owner',
      participant: {
        ...participant,
        reason: 'host-stopped',
      },
      from: sessionIdRef.current,
    });
  }, [participantRole, sendEvent]);

  return { broadcastStart, broadcastStop };
}
