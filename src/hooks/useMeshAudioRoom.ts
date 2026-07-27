'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import {
  BBPC_CLIENT_API_VERSION,
  recordingApi,
} from '@/lib/convex/api';
import type { AudioDisconnectReason, RtcPresence, RtcSignal } from '@/types';
import { createRtcId, shouldCreateInitialOffer } from '@/lib/rtc/mesh';

export interface MeshAudioParticipant {
  clientId: string;
  displayName: string;
  role: 'owner' | 'participant';
  muted: boolean;
  recording: boolean;
  connectionState: RTCPeerConnectionState | 'not-connected' | 'stale';
  audioLevel: number;
}

export interface MeshAudioRoomState {
  joined: boolean;
  joining: boolean;
  muted: boolean;
  selectedInputDeviceId: string | null;
  participants: MeshAudioParticipant[];
  error: string | null;
  playbackBlocked: boolean;
}

export interface MeshAudioRoom {
  state: MeshAudioRoomState;
  localStream: MediaStream | null;
  inputDevices: MediaDeviceInfo[];
  joinAudio: () => Promise<void>;
  leaveAudio: () => Promise<void>;
  setMuted: (muted: boolean) => void;
  setInputDevice: (deviceId: string) => Promise<void>;
  retryPlayback: () => Promise<void>;
  getLocalStream: () => MediaStream | null;
}

interface UseMeshAudioRoomOptions {
  enabled: boolean;
  sessionId: string;
  clientId: string;
  accessToken: string;
  displayName: string;
  role: 'owner' | 'participant';
  recording: boolean;
  recordingStartedAt: number | null;
  sessionEnded: boolean;
  onAudioJoined: (joinedAudioAt: number) => void;
  onAudioLeft: (leftAudioAt: number) => void;
  onDisconnectStarted: (
    disconnect: {
      disconnectId: string;
      clientId: string;
      startedAt: number;
      reason: Exclude<AudioDisconnectReason, 'left'>;
    },
  ) => void;
  onDisconnectEnded: (
    disconnect: {
      disconnectId: string;
      clientId: string;
      endedAt: number;
    },
  ) => void;
}

const STALE_AFTER_MS = 15_000;
const HEARTBEAT_MS = 5_000;
const SIGNAL_WINDOW_REFRESH_MS = 30_000;
const PAGE_HIDDEN_TIMEOUT_MS = 30_000;

function supportsMeshAudio(): boolean {
  return Boolean(
    typeof globalThis.RTCPeerConnection !== 'undefined'
    && typeof navigator.mediaDevices?.getUserMedia === 'function'
    && typeof globalThis.MediaStream !== 'undefined',
  );
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, stripUndefined(entry)]),
    );
  }
  return value;
}

export function useMeshAudioRoom({
  enabled,
  sessionId,
  clientId,
  accessToken,
  displayName,
  role,
  recording,
  recordingStartedAt,
  sessionEnded,
  onAudioJoined,
  onAudioLeft,
  onDisconnectStarted,
  onDisconnectEnded,
}: UseMeshAudioRoomOptions): MeshAudioRoom {
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [connectionStates, setConnectionStates] = useState<Record<string, RTCPeerConnectionState>>({});
  const [audioLevels, setAudioLevels] = useState<Record<string, number>>({});
  const [tick, setTick] = useState(0);
  const [signalReadAt, setSignalReadAt] = useState(() => Date.now());

  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const processedSignalIdsRef = useRef<Set<string>>(new Set());
  const iceServersRef = useRef<RTCIceServer[]>([]);
  const mutedRef = useRef(muted);
  const joinedRef = useRef(joined);
  const recordingRef = useRef(recording);
  const recordingStartedAtRef = useRef(recordingStartedAt);
  const disconnectsRef = useRef<Map<string, string>>(new Map());
  const hiddenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenDisconnectIdRef = useRef<string | null>(null);
  const onAudioJoinedRef = useRef(onAudioJoined);
  const onAudioLeftRef = useRef(onAudioLeft);
  const onDisconnectStartedRef = useRef(onDisconnectStarted);
  const onDisconnectEndedRef = useRef(onDisconnectEnded);

  const listPresenceArgs = joined
    ? { publicSessionId: sessionId, clientId, accessToken }
    : 'skip';
  const listSignalsArgs = joined
    ? { publicSessionId: sessionId, clientId, accessToken, now: signalReadAt }
    : 'skip';
  const presence = useQuery(recordingApi.rtc.listAudioPresence, listPresenceArgs) as RtcPresence[] | undefined;
  const signals = useQuery(recordingApi.rtc.listSignalsForParticipant, listSignalsArgs) as RtcSignal[] | undefined;
  const joinAudioMutation = useMutation(recordingApi.rtc.joinAudio);
  const leaveAudioMutation = useMutation(recordingApi.rtc.leaveAudio);
  const heartbeatAudio = useMutation(recordingApi.rtc.heartbeatAudio);
  const sendSignalMutation = useMutation(recordingApi.rtc.sendSignal);

  useEffect(() => {
    onAudioJoinedRef.current = onAudioJoined;
    onAudioLeftRef.current = onAudioLeft;
    onDisconnectStartedRef.current = onDisconnectStarted;
    onDisconnectEndedRef.current = onDisconnectEnded;
  }, [onAudioJoined, onAudioLeft, onDisconnectEnded, onDisconnectStarted]);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    joinedRef.current = joined;
  }, [joined]);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(() => {
    recordingStartedAtRef.current = recordingStartedAt;
  }, [recordingStartedAt]);

  const refreshInputDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    setInputDevices(devices.filter(device => device.kind === 'audioinput'));
  }, []);

  const sendSignal = useCallback(async (
    toClientId: string,
    type: 'offer' | 'answer' | 'ice-candidate' | 'leave' | 'renegotiate',
    payload: unknown,
  ) => {
    await sendSignalMutation({
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      publicSessionId: sessionId,
      clientId,
      accessToken,
      toClientId,
      signalId: createRtcId(`${clientId}->${toClientId}:${type}`),
      type,
      payload: stripUndefined(payload),
    });
  }, [accessToken, clientId, sendSignalMutation, sessionId]);

  const tryPlayAll = useCallback(async () => {
    let blocked = false;
    for (const audio of audioElementsRef.current.values()) {
      try {
        await audio.play();
      } catch {
        blocked = true;
      }
    }
    setPlaybackBlocked(blocked);
  }, []);

  const attachRemoteStream = useCallback((remoteClientId: string, stream: MediaStream) => {
    remoteStreamsRef.current.set(remoteClientId, stream);
    let audio = audioElementsRef.current.get(remoteClientId);
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      audio.setAttribute('playsinline', 'true');
      audio.dataset.clientId = remoteClientId;
      audioElementsRef.current.set(remoteClientId, audio);
      document.body.appendChild(audio);
    }
    audio.srcObject = stream;
    void tryPlayAll();
  }, [tryPlayAll]);

  const startDisconnect = useCallback((
    remoteClientId: string,
    reason: Exclude<AudioDisconnectReason, 'left'>,
  ) => {
    if (!recordingRef.current || disconnectsRef.current.has(remoteClientId)) return;
    const disconnectId = createRtcId(`disconnect:${clientId}:${remoteClientId}`);
    disconnectsRef.current.set(remoteClientId, disconnectId);
    onDisconnectStartedRef.current({
      disconnectId,
      clientId: remoteClientId,
      startedAt: Date.now(),
      reason,
    });
  }, [clientId]);

  const endDisconnect = useCallback((remoteClientId: string) => {
    const disconnectId = disconnectsRef.current.get(remoteClientId);
    if (!disconnectId) return;
    disconnectsRef.current.delete(remoteClientId);
    onDisconnectEndedRef.current({
      disconnectId,
      clientId: remoteClientId,
      endedAt: Date.now(),
    });
  }, []);

  const ensurePeerConnection = useCallback((remoteClientId: string) => {
    const existing = peerConnectionsRef.current.get(remoteClientId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    peerConnectionsRef.current.set(remoteClientId, pc);
    setConnectionStates(prev => ({ ...prev, [remoteClientId]: pc.connectionState }));

    for (const track of localStreamRef.current?.getAudioTracks() ?? []) {
      pc.addTrack(track, localStreamRef.current!);
    }

    pc.onicecandidate = event => {
      if (event.candidate) {
        void sendSignal(remoteClientId, 'ice-candidate', event.candidate.toJSON());
      }
    };

    pc.ontrack = event => {
      const stream = remoteStreamsRef.current.get(remoteClientId) ?? new MediaStream();
      stream.addTrack(event.track);
      attachRemoteStream(remoteClientId, stream);
    };

    pc.onconnectionstatechange = () => {
      setConnectionStates(prev => ({ ...prev, [remoteClientId]: pc.connectionState }));
      if (pc.connectionState === 'connected') endDisconnect(remoteClientId);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        startDisconnect(remoteClientId, pc.connectionState === 'failed' ? 'ice-failed' : 'ice-disconnected');
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        endDisconnect(remoteClientId);
      }
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
        startDisconnect(remoteClientId, pc.iceConnectionState === 'failed' ? 'ice-failed' : 'ice-disconnected');
      }
    };

    return pc;
  }, [attachRemoteStream, endDisconnect, sendSignal, startDisconnect]);

  const createOffer = useCallback(async (remoteClientId: string) => {
    const pc = ensurePeerConnection(remoteClientId);
    if (pc.signalingState !== 'stable') return;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sendSignal(remoteClientId, 'offer', offer);
  }, [ensurePeerConnection, sendSignal]);

  const closePeerConnection = useCallback((remoteClientId: string, options?: { closeDisconnect?: boolean }) => {
    const pc = peerConnectionsRef.current.get(remoteClientId);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.close();
      peerConnectionsRef.current.delete(remoteClientId);
    }
    const audio = audioElementsRef.current.get(remoteClientId);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
      audioElementsRef.current.delete(remoteClientId);
    }
    remoteStreamsRef.current.delete(remoteClientId);
    setConnectionStates(prev => {
      const next = { ...prev };
      delete next[remoteClientId];
      return next;
    });
    if (options?.closeDisconnect !== false) {
      endDisconnect(remoteClientId);
    }
  }, [endDisconnect]);

  const teardownLocal = useCallback(() => {
    for (const remoteClientId of Array.from(peerConnectionsRef.current.keys())) {
      closePeerConnection(remoteClientId, { closeDisconnect: false });
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
    }
    setConnectionStates({});
    setAudioLevels({});
    processedSignalIdsRef.current.clear();
  }, [closePeerConnection]);

  const leaveAudio = useCallback(async () => {
    if (!joinedRef.current) return;
    const leftAt = Date.now();
    const remotes = Array.from(peerConnectionsRef.current.keys());
    await Promise.allSettled(remotes.map(remoteClientId => sendSignal(remoteClientId, 'leave', { leftAt })));
    teardownLocal();
    setJoined(false);
    await leaveAudioMutation({
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      publicSessionId: sessionId,
      clientId,
      accessToken,
    });
    onAudioLeftRef.current(leftAt);
  }, [accessToken, clientId, leaveAudioMutation, sendSignal, sessionId, teardownLocal]);

  const joinAudio = useCallback(async () => {
    if (!enabled) {
      setError('Mesh audio is disabled');
      return;
    }
    if (!supportsMeshAudio()) {
      setError('This browser does not support WebRTC audio');
      return;
    }
    if (sessionEnded) {
      setError('Session ended');
      return;
    }
    if (joinedRef.current || joining) return;

    setJoining(true);
    setError(null);

    try {
      const joinResult = await joinAudioMutation({
        clientApiVersion: BBPC_CLIENT_API_VERSION,
        publicSessionId: sessionId,
        clientId,
        accessToken,
        muted,
        recording,
      });

      if (!joinResult.ok) {
        setError(joinResult.reason === 'room-full' ? 'Audio room full' : 'Unable to join audio');
        return;
      }

      const iceResponse = await fetch(`/api/sessions/${sessionId}/rtc/ice`);
      if (!iceResponse.ok) throw new Error(`TURN credentials unavailable (${iceResponse.status})`);
      const iceConfig = await iceResponse.json() as { iceServers?: RTCIceServer[] };
      iceServersRef.current = iceConfig.iceServers ?? [];

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedInputDeviceId ? { exact: selectedInputDeviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      stream.getAudioTracks().forEach(track => {
        track.enabled = !mutedRef.current;
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setJoined(true);
      await refreshInputDevices();
      onAudioJoinedRef.current(Date.now());
      void tryPlayAll();
    } catch (err) {
      await leaveAudioMutation({
        clientApiVersion: BBPC_CLIENT_API_VERSION,
        publicSessionId: sessionId,
        clientId,
        accessToken,
      }).catch(() => null);
      teardownLocal();
      setJoined(false);
      setError(err instanceof Error ? err.message : 'Failed to join audio');
    } finally {
      setJoining(false);
    }
  }, [
    accessToken,
    clientId,
    enabled,
    joinAudioMutation,
    joining,
    leaveAudioMutation,
    muted,
    recording,
    refreshInputDevices,
    selectedInputDeviceId,
    sessionEnded,
    sessionId,
    teardownLocal,
    tryPlayAll,
  ]);

  const setMuted = useCallback((nextMuted: boolean) => {
    setMutedState(nextMuted);
    mutedRef.current = nextMuted;
    localStreamRef.current?.getAudioTracks().forEach(track => {
      track.enabled = !nextMuted;
    });
  }, []);

  const setInputDevice = useCallback(async (deviceId: string) => {
    setSelectedInputDeviceId(deviceId);
    if (!joinedRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const [track] = stream.getAudioTracks();
    track.enabled = !mutedRef.current;

    for (const pc of peerConnectionsRef.current.values()) {
      const sender = pc.getSenders().find(candidate => candidate.track?.kind === 'audio');
      if (sender) await sender.replaceTrack(track);
      else pc.addTrack(track, stream);
    }

    localStreamRef.current?.getTracks().forEach(existing => existing.stop());
    localStreamRef.current = stream;
    setLocalStream(stream);
    await Promise.allSettled(
      Array.from(peerConnectionsRef.current.keys()).map(remoteClientId => (
        sendSignal(remoteClientId, 'renegotiate', {})
      )),
    );
  }, [sendSignal]);

  const getLocalStream = useCallback(() => localStreamRef.current, []);

  useEffect(() => {
    if (!joined) return;
    setSignalReadAt(Date.now());
    const timer = setInterval(
      () => setSignalReadAt(Date.now()),
      SIGNAL_WINDOW_REFRESH_MS,
    );
    return () => clearInterval(timer);
  }, [joined]);

  useEffect(() => {
    if (!joined) return;
    void heartbeatAudio({
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      publicSessionId: sessionId,
      clientId,
      accessToken,
      muted,
      recording,
    });
    const timer = setInterval(() => {
      void heartbeatAudio({
        clientApiVersion: BBPC_CLIENT_API_VERSION,
        publicSessionId: sessionId,
        clientId,
        accessToken,
        muted: mutedRef.current,
        recording: recordingRef.current,
      });
    }, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [accessToken, clientId, heartbeatAudio, joined, muted, recording, sessionId]);

  useEffect(() => {
    if (!joined || !presence) return;
    const now = Date.now();
    const remoteRows = presence.filter(row => row.clientId !== clientId);
    const remoteIds = new Set(remoteRows.map(row => row.clientId));

    for (const row of remoteRows) {
      if (now - row.lastSeenAt > STALE_AFTER_MS) {
        if (recording) startDisconnect(row.clientId, 'heartbeat-timeout');
        continue;
      }
      if (!peerConnectionsRef.current.has(row.clientId)) {
        ensurePeerConnection(row.clientId);
        if (shouldCreateInitialOffer(clientId, row.clientId)) {
          void createOffer(row.clientId);
        }
      }
    }

    for (const remoteClientId of Array.from(peerConnectionsRef.current.keys())) {
      if (!remoteIds.has(remoteClientId)) closePeerConnection(remoteClientId, { closeDisconnect: false });
    }
  }, [clientId, closePeerConnection, createOffer, ensurePeerConnection, joined, presence, recording, startDisconnect]);

  useEffect(() => {
    if (!joined || !signals) return;

    for (const signal of signals) {
      if (processedSignalIdsRef.current.has(signal.signalId)) continue;
      processedSignalIdsRef.current.add(signal.signalId);

      void (async () => {
        const remoteClientId = signal.fromClientId;
        if (signal.type === 'leave') {
          closePeerConnection(remoteClientId, { closeDisconnect: false });
          return;
        }

        const pc = ensurePeerConnection(remoteClientId);
        if (signal.type === 'offer') {
          await pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await sendSignal(remoteClientId, 'answer', answer);
        } else if (signal.type === 'answer') {
          if (pc.signalingState !== 'stable') {
            await pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
          }
        } else if (signal.type === 'ice-candidate') {
          await pc.addIceCandidate(signal.payload as RTCIceCandidateInit);
        } else if (signal.type === 'renegotiate') {
          if (shouldCreateInitialOffer(clientId, remoteClientId)) {
            await createOffer(remoteClientId);
          }
        }
      })().catch(err => {
        console.error('[RTC] Failed to process signal:', err);
        setError(err instanceof Error ? err.message : 'WebRTC signal failed');
      });
    }
  }, [clientId, closePeerConnection, createOffer, ensurePeerConnection, joined, sendSignal, signals]);

  useEffect(() => {
    if (!joined || sessionEnded) return;
    const handleBeforeUnload = () => {
      localStreamRef.current?.getTracks().forEach(track => track.stop());
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [joined, sessionEnded]);

  useEffect(() => {
    if (!joined || !sessionEnded) return;
    void leaveAudio();
  }, [joined, leaveAudio, sessionEnded]);

  useEffect(() => {
    const timer = setInterval(() => setTick(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!joined) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && recordingRef.current) {
        hiddenTimerRef.current = setTimeout(() => {
          if (!joinedRef.current || !recordingRef.current || hiddenDisconnectIdRef.current) return;
          const disconnectId = createRtcId(`hidden:${clientId}`);
          hiddenDisconnectIdRef.current = disconnectId;
          onDisconnectStartedRef.current({
            disconnectId,
            clientId,
            startedAt: Date.now(),
            reason: 'page-hidden-timeout',
          });
        }, PAGE_HIDDEN_TIMEOUT_MS);
        return;
      }

      if (hiddenTimerRef.current) clearTimeout(hiddenTimerRef.current);
      hiddenTimerRef.current = null;
      if (hiddenDisconnectIdRef.current) {
        onDisconnectEndedRef.current({
          disconnectId: hiddenDisconnectIdRef.current,
          clientId,
          endedAt: Date.now(),
        });
        hiddenDisconnectIdRef.current = null;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (hiddenTimerRef.current) clearTimeout(hiddenTimerRef.current);
    };
  }, [clientId, joined]);

  useEffect(() => {
    return () => {
      teardownLocal();
    };
  }, [teardownLocal]);

  const participants = useMemo(() => {
    const now = Date.now();
    void tick;
    return (presence ?? (joined ? [{
      clientId,
      displayName,
      role,
      joinedAudioAt: Date.now(),
      lastSeenAt: Date.now(),
      muted,
      recording,
    }] : [])).map(row => {
      const stale = now - row.lastSeenAt > STALE_AFTER_MS;
      const connectionState = row.clientId === clientId
        ? (joined ? 'connected' as const : 'not-connected' as const)
        : stale
        ? 'stale' as const
        : connectionStates[row.clientId] ?? 'not-connected';

      return {
        clientId: row.clientId,
        displayName: row.displayName,
        role: row.role,
        muted: row.muted,
        recording: row.recording,
        connectionState,
        audioLevel: audioLevels[row.clientId] ?? 0,
      };
    });
  }, [audioLevels, clientId, connectionStates, displayName, joined, muted, presence, recording, role, tick]);

  return {
    state: {
      joined,
      joining,
      muted,
      selectedInputDeviceId,
      participants,
      error,
      playbackBlocked,
    },
    localStream,
    inputDevices,
    joinAudio,
    leaveAudio,
    setMuted,
    setInputDevice,
    retryPlayback: tryPlayAll,
    getLocalStream,
  };
}
