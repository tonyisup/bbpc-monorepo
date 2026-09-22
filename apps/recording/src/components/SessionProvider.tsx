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
import { timelineLengthMs } from '@/lib/session-timeline';
import { serverNow, syncServerClock } from '@/lib/clock';

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
const CLOCK_RESYNC_MS = 10 * 60 * 1000;

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

  // Align this device with the server clock that every participant's
  // timestamps use; refresh it over long sessions and after sleeping.
  useEffect(() => {
    void syncServerClock();
    const timer = setInterval(() => { void syncServerClock(); }, CLOCK_RESYNC_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void syncServerClock(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Session timeline position: advances while recording, frozen while paused.
  const [liveElapsedMs, setLiveElapsedMs] = useState(0);
  const rafRef = useRef<number>(0);
  const runs = state.recordingRuns;

  useEffect(() => {
    if (!state.isRecording) {
      return;
    }
    const tick = () => {
      setLiveElapsedMs(timelineLengthMs(runs, serverNow()));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [state.isRecording, runs]);
  // Every run is closed while paused, so the length no longer depends on now.
  const elapsedMs = state.isRecording ? liveElapsedMs : timelineLengthMs(runs, 0);

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
    const event = actionToSyncEvent(action, state.hostName, timelineLengthMs(runs, serverNow()), sessionIdRef.current);
    if (event) void sendEvent(event).catch(() => { /* The sync banner retains and exposes the failed event. */ });
  }, [rawDispatch, runs, sendEvent, sessionStatus, state.hostName]);

  const toManifest = useCallback(
    (): Manifest => sessionStateToManifest(state, sessionId),
    [state, sessionId],
  );

  return (
    <SessionContext.Provider
      value={{
        state,
        dispatch,
        elapsedMs,
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
