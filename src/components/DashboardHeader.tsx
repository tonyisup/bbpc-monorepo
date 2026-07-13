'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from './SessionProvider';
import { useAudio } from './AudioProvider';
import { useRecordingEngine } from '@/hooks/useRecordingEngine';
import type { RecordingTracks } from '@/hooks/useRecordingEngine';
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
  } = useSession();
  const { stopAll } = useAudio();
  const recording = useRecordingEngine();
  const uploadStatusRef = useRef<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
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

  const saveEpisode = useCallback((name: string) => {
    const trimmed = name.trim();
    if (trimmed) {
      dispatch({ type: 'UPDATE_EPISODE', episode: trimmed });
      void fetch(`/api/sessions/${sessionId}/episode`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episode: trimmed }),
      }).catch(err => {
        console.error('[Session] Failed to update episode:', err);
      });
    }
    setEditingEpisode(false);
  }, [dispatch, sessionId]);

  const startEpisodeEdit = useCallback(() => {
    setEpisodeInput(episodeName);
    setEditingEpisode(true);
    setTimeout(() => {
      episodeInputRef.current?.focus();
      episodeInputRef.current?.select();
    }, 0);
  }, [episodeName]);

  const saveName = useCallback((name: string) => {
    const trimmed = name.trim();
    if (trimmed) {
      writeStoredDisplayName(trimmed);
      dispatch({ type: 'UPDATE_HOST_NAME', hostName: trimmed });
      void fetch(`/api/sessions/${sessionId}/participant`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: trimmed }),
      }).catch(err => {
        console.error('[Session] Failed to update display name:', err);
      });
    }
    setEditingName(false);
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

  const uploadTrack = useCallback(async (
    sessionId: string,
    episode: string,
    hostName: string,
    trackType: 'mic' | 'sounders',
    blob: Blob,
    startedAt: number,
  ) => {
    try {
      if (blob.size < 100) {
        console.log('[Recording] Skipping empty track:', trackType, blob.size);
        return true;
      }
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      const res = await fetch('/api/recordings/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, episode, hostName, trackType, startedAt, audioBase64: base64 }),
      });

      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      return true;
    } catch (err) {
      console.error('[Recording] Upload error:', err);
      return false;
    }
  }, []);

  const uploadTracks = useCallback(async (tracks: RecordingTracks) => {
    setUploadStatus('uploading');
    uploadStatusRef.current = 'uploading';

    const [micOk, sounderOk] = await Promise.all([
      uploadTrack(sessionId, episodeName, hostName, 'mic', tracks.mic, tracks.startedAt),
      uploadTrack(sessionId, episodeName, hostName, 'sounders', tracks.sounders, tracks.startedAt),
    ]);

    const finalStatus = micOk && sounderOk ? 'done' : 'error';
    setUploadStatus(finalStatus);
    uploadStatusRef.current = finalStatus;

    setTimeout(() => {
      setUploadStatus('idle');
      uploadStatusRef.current = 'idle';
    }, 3000);

    return finalStatus === 'done';
  }, [episodeName, hostName, sessionId, uploadTrack]);

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
    if (sessionStatus === 'ended' || recording.state.isRecording) return;

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

    try {
      await recording.startRecording({ mediaStream: micStream ?? undefined, ownsMediaStream: !micStream });
      recordingStartRef.current = recordingStartedAt;
      dispatchRecordingJoin(recordingStartedAt, Date.now());
    } catch (err) {
      console.error('[Recording] Failed to join recording:', err);
    }
  }, [dispatchRecordingJoin, meshAudio, recording, rtcAudioEnabled, sessionStatus]);

  const leaveActiveRecording = useCallback(async (reason: 'left' | 'host-stopped') => {
    const recordingStartedAt = recordingStartRef.current || state.recordingStart;
    if (!recordingStartedAt || !recording.state.isRecording) return;

    const leftAt = Date.now();
    dispatchRecordingLeave(recordingStartedAt, leftAt, reason);

    const tracks = await recording.stopRecording();
    recordingStartRef.current = reason === 'host-stopped' ? 0 : recordingStartedAt;
    await uploadTracks(tracks);
  }, [dispatchRecordingLeave, recording, state.recordingStart, uploadTracks]);

  const handleRemoteStart = useCallback((startedAt: number) => {
    console.log('[Recording] Remote host started recording at', startedAt);
    recordingStartRef.current = startedAt;
  }, []);

  const handleRemoteStop = useCallback(async (startedAt: number, durationMs: number) => {
    console.log('[Recording] Remote host stopped recording', { startedAt, durationMs });
    if (!isOwner && recording.state.isRecording) {
      await leaveActiveRecording('host-stopped');
    }
    recordingStartRef.current = 0;
  }, [isOwner, leaveActiveRecording, recording.state.isRecording]);

  const { broadcastStart, broadcastStop } = useRecordingSync({
    sessionId,
    clientId: participantClientId,
    accessToken: participantAccessToken,
    participantRole,
    onRemoteStart: handleRemoteStart,
    onRemoteStop: handleRemoteStop,
  });

  const copyInvite = useCallback(async () => {
    if (sessionStatus === 'ended') return;

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
    if (!isOwner || sessionStatus === 'ended') return;

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
    broadcastStart(now, {
      clientId: participantClientId,
      name: hostName,
      joinedAt: now,
    });
  };

  // Unified stop: session + audio recording + broadcast + upload
  const handleStopRecording = async () => {
    if (!isOwner) return;
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

    // Broadcast stop to guests
    await broadcastStop(recordingStartedAt, stoppedAt - recordingStartedAt, {
      clientId: participantClientId,
      leftAt: stoppedAt,
    });

    await uploadTracks(tracks);
  };

  const hostRecordingActive = state.isRecording;
  const localRecordingActive = recording.state.isRecording;
  const isRecording = isOwner ? (hostRecordingActive || localRecordingActive) : localRecordingActive;
  const sessionEnded = sessionStatus === 'ended';
  const canEditEpisode = isOwner && !sessionEnded && !hostRecordingActive;
  const guestCanJoinRecording = !isOwner && !sessionEnded && hostRecordingActive && !localRecordingActive;
  const canEndSession = isOwner && !sessionEnded;
  const inviteButtonClassName = sessionEnded
    ? 'px-2 py-1.5 text-xs font-medium rounded border border-[var(--card-border)] text-[var(--muted)] opacity-50 cursor-not-allowed transition-colors'
    : 'px-2 py-1.5 text-xs font-medium rounded border border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--accent)] transition-colors';

  const handleEndSession = async () => {
    if (!canEndSession) return;
    const confirmed = window.confirm('End this recording session? Active recordings will be stopped and uploaded first.');
    if (!confirmed) return;

    endingSessionRef.current = true;
    setEndingSession(true);
    stopAll();

    try {
      if (hostRecordingActive || localRecordingActive) {
        await handleStopRecording();
      }
      if (meshAudio.state.joined) {
        await meshAudio.leaveAudio();
      }

      const res = await fetch(`/api/sessions/${sessionId}/end`, { method: 'POST' });
      if (!res.ok) throw new Error(`End session failed: ${res.status}`);
    } catch (err) {
      console.error('[Session] Failed to end session:', err);
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
              {uploadStatus === 'uploading' && (
                <span className="text-xs text-[var(--warning)] animate-pulse">↑ uploading...</span>
              )}
              {uploadStatus === 'done' && (
                <span className="text-xs text-[var(--success)]">✓ uploaded</span>
              )}
              {uploadStatus === 'error' && (
                <span className="text-xs text-[var(--danger)]">✗ upload failed</span>
              )}
            </>
          ) : (
            <span className="text-xs text-[var(--muted)]">
              {micPermissionOk ? '🎙 Ready' : '🎙 Click Start'}
            </span>
          )}
        </div>

        {/* Sounder stop */}
        <button
          onClick={copyInvite}
          disabled={sessionEnded}
          className={inviteButtonClassName}
          title={sessionEnded ? 'Session ended' : 'Copy invite link'}
        >
          {inviteCopied ? 'Copied' : 'Invite'}
        </button>

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

        {/* Session timer */}
        <div className={`font-mono text-xl font-bold tabular-nums ${isRecording ? 'text-[var(--danger)]' : 'text-[var(--muted)]'}`}>
          {isRecording ? formatElapsed(elapsedMs) : '--:--:--'}
        </div>

	        {/* Recording controls */}
        {sessionEnded ? (
          <span className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--warning)]/40 text-[var(--warning)]">
            Ended
          </span>
        ) : isOwner && isRecording ? (
          <button
            onClick={handleStopRecording}
            className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--danger)] text-white hover:opacity-90 transition-opacity"
          >
            Stop Recording
          </button>
        ) : isOwner ? (
          <button
            onClick={handleStartRecording}
            className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--success)] text-white hover:opacity-90 transition-opacity"
          >
            Start Recording
          </button>
        ) : localRecordingActive ? (
          <button
            onClick={() => void leaveActiveRecording('left')}
            className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--danger)] text-white hover:opacity-90 transition-opacity"
          >
            Leave Recording
          </button>
        ) : guestCanJoinRecording ? (
          <button
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
            disabled={!canEndSession || endingSession}
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
