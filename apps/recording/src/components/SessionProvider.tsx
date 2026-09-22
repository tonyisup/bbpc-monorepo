'use client';

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useRef,
  useState,
  useEffect,
} from 'react';
import { useQuery } from 'convex/react';
import { useSessionSync } from '@/hooks/useSessionSync';
import type { SessionState, SessionAction, Manifest, Sounder, SessionSyncEvent } from '@/types';
import type { SessionRole, SessionStatus } from '@/lib/sessions/types';
import { useAudio } from './AudioProvider';
import {
  actionToSyncEvent,
  createInitialState,
  sessionReducer,
  sessionStateToManifest,
  syncEventToAction,
} from '@/lib/session-state';
import { recordingApi } from '@/lib/convex/api';
import { createPortableId } from '@/lib/portable-ids';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface SessionContextValue {
  state: SessionState;
  dispatch: React.Dispatch<SessionAction>;
  elapsedMs: number;
  toManifest: () => Manifest;
  sessionId: string;
  inviteUrl: string | null;
  participantClientId: string;
  participantAccessToken: string;
  participantRole: SessionRole;
  sessionStatus: SessionStatus;
  endedAt: string | null;
  pendingEventCount: number;
  syncError: string | null;
  /** Changes the server permanently rejected; they were dropped, not saved. */
  rejectedEventCount: number;
  retryPendingEvents: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

interface SessionProviderProps {
  children: React.ReactNode;
  sessionId: string;
  inviteUrl: string | null;
  episode?: string;
  date?: string;
  hostName?: string;
  participantClientId: string;
  participantAccessToken: string;
  participantRole: SessionRole;
  initialStatus: SessionStatus;
  initialEndedAt?: string | null;
  sounders?: Sounder[];
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function SessionProvider({
  children,
  sessionId,
  inviteUrl,
  episode = 'EP-NEW',
  date = new Date().toISOString().slice(0, 10),
  hostName = 'host',
  participantClientId,
  participantAccessToken,
  participantRole,
  initialStatus,
  initialEndedAt = null,
  sounders = [],
}: SessionProviderProps) {
  const { play } = useAudio();
  const [state, rawDispatch] = useReducer(
    sessionReducer,
    null,
    () => createInitialState(episode, date, hostName, sounders)
  );

  // Elapsed timer
  const [elapsedMs, setElapsedMs] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!state.isRecording || state.recordingStart === null) {
      return;
    }
    const tick = () => {
      setElapsedMs(Date.now() - state.recordingStart!);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [state.isRecording, state.recordingStart]);

  // Identifies this mounted tab, not the participant: events it dispatched
  // locally are skipped when they echo back, while a reload replays them.
  const [eventSourceId] = useState(() => createPortableId('sess'));
  const sessionIdRef = useRef(eventSourceId);

  const handleRemoteEvent = useCallback((event: SessionSyncEvent) => {
    if (event.from === sessionIdRef.current) return;
    const action = syncEventToAction(event);
    if (action) rawDispatch(action);
  }, []);

  const handleLiveRemoteEvent = useCallback((event: SessionSyncEvent) => {
    if (event.from === sessionIdRef.current || event.kind !== 'sounder') return;
    play(event.sounder.url, { record: false });
  }, [play]);

  const { sendEvent, pendingCount, syncError, rejectedCount, retryPendingEvents } = useSessionSync({
    sessionId,
    clientId: participantClientId,
    accessToken: participantAccessToken,
    onRemoteEvent: handleRemoteEvent,
    onLiveRemoteEvent: handleLiveRemoteEvent,
  });
  const lifecycle = useQuery(recordingApi.sessions.getSessionLifecycle, {
    publicId: sessionId,
    clientId: participantClientId,
    accessToken: participantAccessToken,
  });
  const sessionStatus = lifecycle?.status ?? initialStatus;
  const endedAt = lifecycle?.endedAt ?? initialEndedAt;

  // Wrapped dispatch: local + broadcast
  const dispatch = useCallback((action: SessionAction) => {
    if (sessionStatus === 'ended' && action.type !== 'UPDATE_HOST_NAME') return;

    rawDispatch(action);
    const event = actionToSyncEvent(action, state.hostName, state.recordingStart, sessionIdRef.current);
    if (event) void sendEvent(event).catch(() => { /* The sync banner retains and exposes the failed event. */ });
  }, [rawDispatch, sendEvent, sessionStatus, state.hostName, state.recordingStart]);

  const toManifest = useCallback(
    (): Manifest => sessionStateToManifest(state, sessionId),
    [state, sessionId],
  );

  return (
    <SessionContext.Provider
      value={{
        state,
        dispatch,
        elapsedMs: state.isRecording ? elapsedMs : 0,
        toManifest,
        sessionId,
        inviteUrl,
        participantClientId,
        participantAccessToken,
        participantRole,
        sessionStatus,
        endedAt,
        pendingEventCount: pendingCount,
        syncError,
        rejectedEventCount: rejectedCount,
        retryPendingEvents,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
