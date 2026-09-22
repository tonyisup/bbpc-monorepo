'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from './SessionProvider';
import { useAudio } from './AudioProvider';
import { useRecordingEngine } from '@/hooks/useRecordingEngine';
import { useRecordingUpload } from '@/hooks/useRecordingUpload';
import { useRecordingSync } from '@/hooks/useRecordingSync';
import { useMeshAudioRoom } from '@/hooks/useMeshAudioRoom';

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

const DISPLAY_NAME_STORAGE_KEY = 'bbpc-display-name-v1';

function readStoredDisplayName(): string | null {
  try {
    const storedName = window.localStorage.getItem(DISPLAY_NAME_STORAGE_KEY)?.trim();
    return storedName || null;
  } catch {
    return null;
  }
}

function writeStoredDisplayName(name: string) {
  try {
    window.localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, name);
  } catch {
    // The server-side participant record remains authoritative.
  }
}

function VUMeter({ level }: { level: number }) {
  const bars = 8;
  const activeBars = Math.round(level * bars);
  return (
    <div className="flex items-end gap-0.5 h-4">
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className={`w-1 rounded-sm transition-all ${
            i < activeBars
              ? i >= bars - 2
                ? 'bg-[var(--danger)]'
                : i >= bars - 4
                ? 'bg-[var(--warning)]'
                : 'bg-[var(--success)]'
              : 'bg-[var(--card-border)]'
          }`}
          style={{ height: `${((i + 1) * 100) / bars}%` }}
        />
      ))}
    </div>
  );
}

function audioConnectionLabel(state: string): string {
  if (state === 'connected') return 'connected';
  if (state === 'connecting' || state === 'new') return 'connecting';
  if (state === 'disconnected') return 'reconnecting';
  if (state === 'failed' || state === 'closed') return 'disconnected';
  return state;
}

export function DashboardHeader() {
  const {
    state,
    elapsedMs,
    dispatch,
    sessionId,
    inviteUrl,
    participantClientId,
    participantAccessToken,
    participantRole,
    sessionStatus,
    pendingEventCount,
    syncError,
    rejectedEventCount,
    retryPendingEvents,
  } = useSession();
  const { stopAll } = useAudio();
  const recovery = useRecordingUpload(sessionId, state.episode, state.hostName);
  const recording = useRecordingEngine(recovery.retain);
  const uploadStatus = recovery.status;
  const uploadTracks = recovery.upload;
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingEditRef = useRef(false);
  const transportBusyRef = useRef(false);
  const [transportBusy, setTransportBusy] = useState(false);
  const [endingSession, setEndingSession] = useState(false);
  const endingSessionRef = useRef(false);
  const forcedUploadRef = useRef(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const storedNameAppliedRef = useRef(false);
  const [micPermissionOk, setMicPermissionOk] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);

  const hostName = state.hostName;
  const episodeName = state.episode;
  const [editingEpisode, setEditingEpisode] = useState(false);
  const [episodeInput, setEpisodeInput] = useState('');
  const episodeInputRef = useRef<HTMLInputElement>(null);

  const saveEpisode = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || savingEditRef.current) return;
    savingEditRef.current = true;
    setSaveError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/episode`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episode: trimmed }),
      });
      if (!res.ok) throw new Error(`Could not save episode title (${res.status}). Try again.`);
      dispatch({ type: 'UPDATE_EPISODE', episode: trimmed });
      setEditingEpisode(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save episode title');
    } finally { savingEditRef.current = false; }
  }, [dispatch, sessionId]);

  const startEpisodeEdit = useCallback(() => {
    setEpisodeInput(episodeName);
    setEditingEpisode(true);
    setTimeout(() => {
      episodeInputRef.current?.focus();
      episodeInputRef.current?.select();
    }, 0);
  }, [episodeName]);

  const saveName = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || savingEditRef.current) return;
    savingEditRef.current = true;
    setSaveError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/participant`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: trimmed }),
      });
      if (!res.ok) throw new Error(`Could not save your name (${res.status}). Try again.`);
      writeStoredDisplayName(trimmed);
      dispatch({ type: 'UPDATE_HOST_NAME', hostName: trimmed });
      setEditingName(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save your name');
    } finally { savingEditRef.current = false; }
  }, [dispatch, sessionId]);

  const startNameEdit = useCallback(() => {
    setNameInput(hostName);
    setEditingName(true);
    setTimeout(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }, 0);
  }, [hostName]);

  useEffect(() => {
    if (storedNameAppliedRef.current || sessionStatus === 'ended') return;

    storedNameAppliedRef.current = true;
    const storedName = readStoredDisplayName();
    if (!storedName || storedName === hostName) return;

    queueMicrotask(() => saveName(storedName));
  }, [hostName, saveName, sessionStatus]);

  // Realtime recording sync
  const recordingStartRef = useRef<number>(0);
  const stoppedTakesRef = useRef(new Set<number>());
  const joiningTakeRef = useRef<{ startedAt: number; canceled: boolean } | null>(null);
  const isOwner = participantRole === 'owner';
  const rtcAudioEnabled = process.env.NEXT_PUBLIC_RTC_AUDIO_ENABLED !== 'false';
  const meshAudio = useMeshAudioRoom({
    enabled: rtcAudioEnabled,
    sessionId,
    clientId: participantClientId,
    accessToken: participantAccessToken,
    displayName: hostName,
    role: participantRole,
    recording: recording.state.isRecording,
    recordingStartedAt: state.recordingStart,
    sessionEnded: sessionStatus === 'ended',
    onAudioJoined: joinedAudioAt => {
      dispatch({
        type: 'JOIN_AUDIO',
        participant: {
          clientId: participantClientId,
          name: hostName,
          role: participantRole,
          joinedAudioAt,
          recordingStartedAt: state.recordingStart,
        },
      });
    },
    onAudioLeft: leftAudioAt => {
      dispatch({
        type: 'LEAVE_AUDIO',
        participant: {
          clientId: participantClientId,
          leftAudioAt,
          recordingStartedAt: state.recordingStart,
        },
      });
    },
    onDisconnectStarted: disconnect => {
      dispatch({
        type: 'START_AUDIO_DISCONNECT',
        disconnect: {
          ...disconnect,
          recordingStartedAt: state.recordingStart,
        },
      });
    },
    onDisconnectEnded: disconnect => {
      dispatch({
        type: 'END_AUDIO_DISCONNECT',
        disconnect: {
          ...disconnect,
          recordingStartedAt: state.recordingStart,
        },
      });
    },
  });

  const dispatchRecordingJoin = useCallback((recordingStartedAt: number, joinedAt: number) => {
    dispatch({
      type: 'JOIN_RECORDING',
      participant: {
        clientId: participantClientId,
        name: hostName,
        role: participantRole,
        joinedAt,
        recordingStartedAt,
      },
    });
  }, [dispatch, hostName, participantClientId, participantRole]);

  const dispatchRecordingLeave = useCallback((
    recordingStartedAt: number,
    leftAt: number,
    reason: 'left' | 'host-stopped',
  ) => {
    dispatch({
      type: 'LEAVE_RECORDING',
      participant: {
        clientId: participantClientId,
        leftAt,
        recordingStartedAt,
        reason,
      },
    });
  }, [dispatch, participantClientId]);

  const joinActiveRecording = useCallback(async (recordingStartedAt: number) => {
    if (sessionStatus === 'ended' || recording.state.isRecording || recovery.hasPending() || transportBusyRef.current || stoppedTakesRef.current.has(recordingStartedAt)) return;
    const attempt = { startedAt: recordingStartedAt, canceled: false };
    joiningTakeRef.current = attempt;
    transportBusyRef.current = true;
    setTransportBusy(true);
    try {
      let micStream: MediaStream | null = null;
      if (rtcAudioEnabled) {
        if (!meshAudio.state.joined) await meshAudio.joinAudio();
        micStream = meshAudio.getLocalStream();
        if (!micStream) return;
      } else {
        const hasPermission = await recording.requestMicPermission();
        if (!hasPermission) return;
      }
      if (attempt.canceled) return;
      setMicPermissionOk(true);
      await recording.startRecording({ mediaStream: micStream ?? undefined, ownsMediaStream: !micStream });
      if (attempt.canceled) {
        // The host stopped while microphone/recorder startup was pending.
        // Finalize any capture immediately and preserve it through upload recovery.
        await uploadTracks(await recording.stopRecording());
        return;
      }
      recordingStartRef.current = recordingStartedAt;
      dispatchRecordingJoin(recordingStartedAt, Date.now());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not join recording');
    } finally {
      if (joiningTakeRef.current === attempt) joiningTakeRef.current = null;
      if (attempt.canceled && recordingStartRef.current === recordingStartedAt) recordingStartRef.current = 0;
      transportBusyRef.current = false;
      setTransportBusy(false);
    }
  }, [dispatchRecordingJoin, meshAudio, recording, rtcAudioEnabled, sessionStatus, recovery, uploadTracks]);

  const leaveActiveRecording = useCallback(async (reason: 'left' | 'host-stopped') => {
    const recordingStartedAt = recordingStartRef.current || state.recordingStart;
    if (!recordingStartedAt || !recording.state.isRecording || transportBusyRef.current) return;
    transportBusyRef.current = true;
    setTransportBusy(true);
    try {
      dispatchRecordingLeave(recordingStartedAt, Date.now(), reason);
      const tracks = await recording.stopRecording();
      recordingStartRef.current = reason === 'host-stopped' ? 0 : recordingStartedAt;
      await uploadTracks(tracks);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not stop recording');
    } finally {
      transportBusyRef.current = false;
      setTransportBusy(false);
    }
  }, [dispatchRecordingLeave, recording, state.recordingStart, uploadTracks]);

  const handleRemoteStart = useCallback((startedAt: number) => {
    console.log('[Recording] Remote host started recording at', startedAt);
    recordingStartRef.current = startedAt;
  }, []);

  const handleRemoteStop = useCallback(async (startedAt: number, durationMs: number) => {
    console.log('[Recording] Remote host stopped recording', { startedAt, durationMs });
    stoppedTakesRef.current.add(startedAt);
    const joining = joiningTakeRef.current;
    if (!isOwner && joining?.startedAt === startedAt) {
      joining.canceled = true;
      return;
    }
    if (!isOwner && recording.state.isRecording && recordingStartRef.current === startedAt) {
      await leaveActiveRecording('host-stopped');
    }
    if (recordingStartRef.current === startedAt) recordingStartRef.current = 0;
  }, [isOwner, leaveActiveRecording, recording.state.isRecording]);

  const recordingSync = useRecordingSync({
    sessionId,
    clientId: participantClientId,
    accessToken: participantAccessToken,
    participantRole,
    onRemoteStart: handleRemoteStart,
    onRemoteStop: handleRemoteStop,
  });

  const copyInvite = useCallback(async () => {
    if (sessionStatus === 'ended' || inviteUrl === null) return;

    try {
      await navigator.clipboard.writeText(inviteUrl);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 1800);
    } catch (err) {
      console.error('[Session] Failed to copy invite link:', err);
    }
  }, [inviteUrl, sessionStatus]);

  // Unified start: session + audio recording + broadcast
  const handleStartRecording = async () => {
    if (!isOwner || sessionStatus === 'ended' || recovery.hasPending() || transportBusyRef.current || pendingEventCount || recordingSync.pendingCount) return;
    transportBusyRef.current = true;
    setTransportBusy(true);
    try {

      // Request mic permission first
      let micStream: MediaStream | null = null;
      if (rtcAudioEnabled) {
        if (!meshAudio.state.joined) await meshAudio.joinAudio();
        micStream = meshAudio.getLocalStream();
        if (!micStream) return;
      } else {
        const hasPermission = await recording.requestMicPermission();
        if (!hasPermission) return;
      }
      setMicPermissionOk(true);

      const now = Date.now();
      recordingStartRef.current = now;

      try {
        // Start the local recorder before changing shared transport state.
        await recording.startRecording({
          mediaStream: micStream ?? undefined,
          ownsMediaStream: !micStream,
        });
      } catch (err) {
        recordingStartRef.current = 0;
        console.error('[Recording] Failed to start recording:', err);
        return;
      }

      dispatch({
        type: 'START_RECORDING',
        startedAt: now,
        participant: {
          clientId: participantClientId,
          name: hostName,
          role: 'owner',
          joinedAt: now,
        },
      });

      // Broadcast to guests
      void recordingSync.broadcastStart(now, {
        clientId: participantClientId,
        name: hostName,
        joinedAt: now,
      })?.catch(() => { /* The sync banner exposes and retains the event. */ });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Recording start could not be shared');
    } finally {
      transportBusyRef.current = false;
      setTransportBusy(false);
    }
  };

  // Unified stop: session + audio recording + broadcast + upload
  const handleStopRecording = async () => {
    if (!isOwner || transportBusyRef.current) return false;
    transportBusyRef.current = true;
    setTransportBusy(true);
    try {
      const recordingStartedAt = recordingStartRef.current || state.recordingStart || Date.now();
      const stoppedAt = Date.now();

      // Stop session recording
      dispatch({
        type: 'STOP_RECORDING',
        participant: {
          clientId: participantClientId,
          leftAt: stoppedAt,
          recordingStartedAt,
          reason: 'host-stopped',
        },
      });

      // Stop WebRTC audio recording
      const tracks = await recording.stopRecording();
      recordingStartRef.current = 0;

      // Retain/upload audio before attempting the shared stop event.
      const upload = uploadTracks(tracks);
      const broadcast = recordingSync.broadcastStop(recordingStartedAt, stoppedAt - recordingStartedAt, {
        clientId: participantClientId,
        leftAt: stoppedAt,
      });

      const results = await Promise.allSettled([broadcast, upload]);
      return results.every(result => result.status === 'fulfilled' && result.value !== false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not stop recording');
      return false;
    } finally {
      transportBusyRef.current = false;
      setTransportBusy(false);
    }
  };

  const hostRecordingActive = state.isRecording;
  const localRecordingActive = recording.state.isRecording;
  const isRecording = isOwner ? (hostRecordingActive || localRecordingActive) : localRecordingActive;
  const sessionEnded = sessionStatus === 'ended';
  const timelinePaused = !isRecording && state.recordingRuns.length > 0;
  const canEditEpisode = isOwner && !sessionEnded && !hostRecordingActive && !recovery.pending;
  const guestCanJoinRecording = !isOwner && !sessionEnded && hostRecordingActive && !localRecordingActive && !recovery.pending;
  const canEndSession = isOwner && !sessionEnded;
  const inviteUnavailable = sessionEnded || inviteUrl === null;
  const inviteButtonClassName = inviteUnavailable
    ? 'px-2 py-1.5 text-xs font-medium rounded border border-[var(--card-border)] text-[var(--muted)] opacity-50 cursor-not-allowed transition-colors'
    : 'px-2 py-1.5 text-xs font-medium rounded border border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--accent)] transition-colors';

  const handleEndSession = async () => {
    if (!canEndSession || endingSessionRef.current || transportBusyRef.current) return;
    const confirmed = window.confirm('End this recording session? Active recordings will be stopped and uploaded first.');
    if (!confirmed) return;

    endingSessionRef.current = true;
    setEndingSession(true);
    stopAll();

    try {
      if (hostRecordingActive || localRecordingActive) {
        if (!await handleStopRecording()) return;
      }
      if (recovery.hasPending() && !await recovery.retry()) return;
      await Promise.all([retryPendingEvents(), recordingSync.retryPendingEvents()]);
      if (meshAudio.state.joined) {
        await meshAudio.leaveAudio();
      }

      const res = await fetch(`/api/sessions/${sessionId}/end`, { method: 'POST' });
      if (!res.ok) throw new Error(`End session failed: ${res.status}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not end session');
    } finally {
      endingSessionRef.current = false;
      setEndingSession(false);
    }
  };

  useEffect(() => {
    if (!sessionEnded || !localRecordingActive || forcedUploadRef.current || endingSessionRef.current) return;
    forcedUploadRef.current = true;

    void leaveActiveRecording('host-stopped').finally(() => {
      forcedUploadRef.current = false;
    });
  }, [leaveActiveRecording, localRecordingActive, sessionEnded]);

  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (!localRecordingActive && !recovery.hasPending() && !pendingEventCount && !recordingSync.pendingCount) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [localRecordingActive, pendingEventCount, recordingSync.pendingCount, recovery]);

  return (
    <header className="flex items-center justify-between gap-4 px-6 py-3 border-b border-[var(--card-border)] bg-[var(--card-bg)]">
      <div className="flex items-center gap-4">
        {/* Episode name — click to edit (only when not recording) */}
        {editingEpisode && canEditEpisode ? (
          <input
            ref={episodeInputRef}
            value={episodeInput}
            onChange={e => setEpisodeInput(e.target.value)}
            onBlur={() => saveEpisode(episodeInput)}
            onKeyDown={e => {
              if (e.key === 'Enter') saveEpisode(episodeInput);
              if (e.key === 'Escape') setEditingEpisode(false);
            }}
            className="text-lg font-semibold tracking-tight px-2 py-0.5 rounded border border-[var(--accent)] bg-[var(--card-bg)] text-[var(--foreground)] w-48 focus:outline-none"
            placeholder="Episode title"
          />
        ) : (
          <button
            onClick={canEditEpisode ? startEpisodeEdit : undefined}
            className={`text-lg font-semibold tracking-tight px-2 py-0.5 rounded border transition-colors ${
              !canEditEpisode
                ? 'border-transparent cursor-default'
                : 'border-transparent hover:border-[var(--card-border)] cursor-pointer hover:text-[var(--accent)]'
            }`}
            title={canEditEpisode ? 'Click to edit episode title' : undefined}
          >
            {episodeName}
          </button>
        )}
        <span className="text-xs text-[var(--muted)]">{state.date}</span>
      </div>

      <div className="flex items-center gap-3">
        {rtcAudioEnabled && (
          <div className="flex items-center gap-2 pr-3 border-r border-[var(--card-border)]">
            {!meshAudio.state.joined ? (
              <button
                onClick={() => void meshAudio.joinAudio()}
                disabled={meshAudio.state.joining || sessionEnded}
                className="px-2 py-1.5 text-xs font-medium rounded border border-[var(--accent)] text-[var(--foreground)] hover:bg-[var(--accent)] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {meshAudio.state.joining ? 'Joining...' : 'Join Audio'}
              </button>
            ) : (
              <button
                onClick={() => void meshAudio.leaveAudio()}
                className="px-2 py-1.5 text-xs font-medium rounded border border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--danger)] hover:border-[var(--danger)] transition-colors"
              >
                Leave Audio
              </button>
            )}

            <button
              onClick={() => meshAudio.setMuted(!meshAudio.state.muted)}
              disabled={!meshAudio.state.joined}
              className="px-2 py-1.5 text-xs font-medium rounded border border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {meshAudio.state.muted ? 'Unmute' : 'Mute'}
            </button>

            <select
              value={meshAudio.state.selectedInputDeviceId ?? ''}
              onChange={event => void meshAudio.setInputDevice(event.target.value)}
              disabled={!meshAudio.state.joined || meshAudio.inputDevices.length === 0}
              className="max-w-36 px-2 py-1.5 text-xs rounded border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--foreground)] disabled:opacity-50"
              title="Input device"
            >
              <option value="">Default mic</option>
              {meshAudio.inputDevices.map(device => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Mic ${device.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>

            {meshAudio.state.playbackBlocked && (
              <button
                onClick={() => void meshAudio.retryPlayback()}
                className="px-2 py-1.5 text-xs font-medium rounded border border-[var(--warning)] text-[var(--warning)] hover:bg-[var(--warning)] hover:text-black transition-colors"
              >
                Tap to enable audio
              </button>
            )}

            {meshAudio.state.participants.length > 0 && (
              <div className="hidden xl:flex items-center gap-1 max-w-xl overflow-x-auto">
                {meshAudio.state.participants.map(participant => {
                  const label = audioConnectionLabel(participant.connectionState);
                  const warning = state.isRecording && !participant.recording;
                  return (
                    <span
                      key={participant.clientId}
                      className={`whitespace-nowrap px-2 py-1 text-[11px] rounded border ${
                        warning
                          ? 'border-[var(--warning)] text-[var(--warning)]'
                          : 'border-[var(--card-border)] text-[var(--muted)]'
                      }`}
                      title={`${participant.displayName}: ${label}`}
                    >
                      {participant.displayName}
                      {participant.muted ? ' muted' : ''}
                      {participant.recording ? ' rec' : ''}
                      {' '}
                      {label}
                    </span>
                  );
                })}
              </div>
            )}

            {meshAudio.state.error && (
              <span className="max-w-44 truncate text-xs text-[var(--danger)]" title={meshAudio.state.error}>
                {meshAudio.state.error}
              </span>
            )}
          </div>
        )}

        {/* WebRTC Audio Recording Status */}
        <div className="flex items-center gap-2 pr-3 border-r border-[var(--card-border)]">
          {recording.state.error ? (
            <span className="text-xs text-[var(--danger)]" title={recording.state.error}>
              ⚠ Mic error
            </span>
          ) : recording.state.isRecording ? (
            <>
              <VUMeter level={recording.state.micLevel} />
              <span className="text-xs text-[var(--danger)] font-medium animate-pulse">REC</span>
              <span className="text-xs text-[var(--muted)] font-mono">
                {formatElapsed(recording.state.durationMs)}
              </span>
            </>
          ) : (
            <span className="text-xs text-[var(--muted)]">
              {micPermissionOk ? '🎙 Ready' : '🎙 Click Start'}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1 text-xs" aria-live="polite">
          {uploadStatus === 'uploading' && <span>Uploading audio…</span>}
          {uploadStatus === 'done' && <span>Audio uploaded</span>}
          {recovery.pending && <>
            <span role={uploadStatus === 'error' ? 'alert' : undefined}>{recovery.error ?? 'Audio is saved in this tab. Upload it before ending the session.'}</span>
            <div className="flex gap-2">
              <button disabled={uploadStatus === 'uploading'} onClick={() => void recovery.retry()}>Retry upload</button>
              <button onClick={() => recovery.download('mic')}>Download mic</button>
              <button onClick={() => recovery.download('sounders')}>Download sounders</button>
              <button disabled={uploadStatus === 'uploading'} onClick={() => {
                if (window.confirm('Discard the audio still in this tab? Download both tracks first if you want to keep them. This cannot be undone.')) recovery.discard();
              }}>Discard audio</button>
            </div>
          </>}
          {(pendingEventCount > 0 || recordingSync.pendingCount > 0) && <div role="status">
            {syncError || recordingSync.syncError ? 'Changes not saved. Keep this tab open.' : 'Saving session changes…'}
            {(syncError || recordingSync.syncError) && <button onClick={() => {
              void Promise.all([retryPendingEvents(), recordingSync.retryPendingEvents()]).then(() => setSaveError(null)).catch(() => {});
            }}>Retry saving</button>}
          </div>}
          {rejectedEventCount > 0 && <span role="alert">
            {rejectedEventCount === 1 ? '1 session change was' : `${rejectedEventCount} session changes were`} rejected and not saved.
          </span>}
          {saveError && <span role="alert">{saveError}</span>}
        </div>

        {/* Sounder stop */}
        {isOwner && (
          <button
            onClick={copyInvite}
            disabled={inviteUnavailable}
            className={inviteButtonClassName}
            title={
              sessionEnded
                ? 'Session ended'
                : inviteUrl === null
                  ? 'Invite link unavailable'
                  : 'Copy invite link'
            }
          >
            {inviteCopied ? 'Copied' : 'Invite'}
          </button>
        )}

        {/* Sounder stop */}
        <button
          onClick={stopAll}
          className="px-2 py-1.5 text-xs font-medium rounded border border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--danger)] hover:border-[var(--danger)] transition-colors"
          title="Stop all playing sounders"
        >
          ⏹
        </button>

        {/* Host name — click to edit */}
        {editingName ? (
          <input
            ref={nameInputRef}
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onBlur={() => saveName(nameInput)}
            onKeyDown={e => {
              if (e.key === 'Enter') saveName(nameInput);
              if (e.key === 'Escape') setEditingName(false);
            }}
            className="text-sm px-2 py-0.5 rounded border border-[var(--accent)] bg-[var(--card-bg)] text-[var(--foreground)] w-24 focus:outline-none"
            placeholder="Your name"
          />
        ) : (
          <button
            onClick={startNameEdit}
            className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors px-2 py-0.5 rounded border border-transparent hover:border-[var(--card-border)]"
            title="Click to set your name"
          >
            {hostName}
          </button>
        )}

        {/* Session timeline: frozen while paused between runs */}
        <div className={`font-mono text-xl font-bold tabular-nums ${isRecording ? 'text-[var(--danger)]' : 'text-[var(--muted)]'}`}>
          {isRecording || timelinePaused ? formatElapsed(elapsedMs) : '--:--:--'}
          {timelinePaused && <span className="ml-2 font-sans text-xs font-medium uppercase">Paused</span>}
        </div>

	        {/* Recording controls */}
        {sessionEnded ? (
          <span className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--warning)]/40 text-[var(--warning)]">
            Ended
          </span>
        ) : isOwner && isRecording ? (
          <button
            onClick={handleStopRecording}
            disabled={transportBusy}
            className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--danger)] text-white hover:opacity-90 transition-opacity"
          >
            Stop Recording
          </button>
        ) : isOwner ? (
          <button
            onClick={handleStartRecording}
            disabled={transportBusy || !!recovery.pending || pendingEventCount > 0 || recordingSync.pendingCount > 0}
            className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--success)] text-white hover:opacity-90 transition-opacity"
          >
            {timelinePaused ? 'Resume Recording' : 'Start Recording'}
          </button>
        ) : localRecordingActive ? (
          <button
            onClick={() => void leaveActiveRecording('left')}
            disabled={transportBusy}
            className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--danger)] text-white hover:opacity-90 transition-opacity"
          >
            Leave Recording
          </button>
        ) : guestCanJoinRecording ? (
          <button
            disabled={transportBusy}
            onClick={() => {
              const recordingStartedAt = recordingStartRef.current || state.recordingStart;
              if (recordingStartedAt) void joinActiveRecording(recordingStartedAt);
            }}
            className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--success)] text-white hover:opacity-90 transition-opacity"
          >
            Join Recording
          </button>
        ) : (
          <span className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--card-border)] text-[var(--muted)]">
            Waiting for Host
          </span>
        )}
        {participantRole === 'owner' && !sessionEnded && (
          <button
            onClick={handleEndSession}
            disabled={!canEndSession || endingSession || transportBusy || uploadStatus === 'uploading'}
            className={`px-2 py-1.5 text-xs font-medium rounded border transition-colors ${
              canEndSession && !endingSession
                ? 'border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--danger)] hover:border-[var(--danger)]'
                : 'border-[var(--card-border)] text-[var(--muted)] opacity-50 cursor-not-allowed'
            }`}
            title={isRecording ? 'Stop, upload, and end session' : 'End session'}
          >
            {endingSession ? 'Ending...' : 'End Session'}
          </button>
        )}
      </div>
    </header>
  );
}
