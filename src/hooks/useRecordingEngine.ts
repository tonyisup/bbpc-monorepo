'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import { useAudio } from '@/components/AudioProvider';

export interface RecordingState {
  isRecording: boolean;
  micLevel: number; // 0-1 for VU meter
  durationMs: number;
  error: string | null;
}

export interface RecordingEngine {
  state: RecordingState;
  startRecording: (options?: { mediaStream?: MediaStream; ownsMediaStream?: boolean }) => Promise<void>;
  stopRecording: () => Promise<RecordingTracks>;
  requestMicPermission: () => Promise<boolean>;
}

export interface RecordingTracks {
  mic: Blob;        // webm/opus of mic only
  sounders: Blob;   // webm/opus of sounders only
  startedAt: number; // Date.now() when recording started
  durationMs: number;
}

const SAMPLE_RATE = 48000;

function createAudioContext(): AudioContext {
  return new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)({ sampleRate: SAMPLE_RATE });
}

function getSupportedMimeType(): string {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return 'audio/webm';
}

/**
 * Recording engine using Web Audio API.
 *
 * Creates an AudioContext with two output paths:
 *   Mic → MediaStreamDestination → MediaRecorder (mic track)
 *   Sounder destination (via AudioProvider) → MediaStreamDestination → MediaRecorder (sounder track)
 */
export function useRecordingEngine(): RecordingEngine {
  const { setSounderDestination } = useAudio();
  const [state, setState] = useState<RecordingState>({
    isRecording: false,
    micLevel: 0,
    durationMs: 0,
    error: null,
  });

  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const ownsMicStreamRef = useRef(true);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const sounderDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const micRecorderRef = useRef<MediaRecorder | null>(null);
  const sounderRecorderRef = useRef<MediaRecorder | null>(null);
  const micChunksRef = useRef<Blob[]>([]);
  const sounderChunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const startedAtRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
      }
    };
  }, []);

  const stopVU = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const startVU = useCallback(() => {
    if (!analyserRef.current) return;
    const analyser = analyserRef.current;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const v = (dataArray[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      setState(prev => ({ ...prev, micLevel: Math.min(rms * 3, 1) }));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const requestMicPermission = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: SAMPLE_RATE,
        },
      });
      stream.getTracks().forEach(t => t.stop());
      return true;
    } catch {
      setState(prev => ({ ...prev, error: 'Microphone permission denied' }));
      return false;
    }
  }, []);

  const startRecording = useCallback(async (options?: { mediaStream?: MediaStream; ownsMediaStream?: boolean }) => {
    try {
      setState(prev => ({ ...prev, error: null, isRecording: true, micLevel: 0, durationMs: 0 }));
      startedAtRef.current = Date.now();

      const ctx = createAudioContext();
      audioCtxRef.current = ctx;

      // --- Mic track ---
      const micStream = options?.mediaStream ?? await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: SAMPLE_RATE,
        },
      });
      micStreamRef.current = micStream;
      ownsMicStreamRef.current = options?.mediaStream ? options.ownsMediaStream ?? false : true;

      const micSource = ctx.createMediaStreamSource(micStream);
      micSourceRef.current = micSource;

      // VU meter
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;
      micSource.connect(analyser);

      // Mic output destination
      const micDest = ctx.createMediaStreamDestination();
      micDestRef.current = micDest;
      micSource.connect(micDest);

      // Mic recorder
      const micRecorder = new MediaRecorder(micStream, { mimeType: getSupportedMimeType() });
      micChunksRef.current = [];
      micRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) micChunksRef.current.push(e.data);
      };
      micRecorder.start(1000);
      micRecorderRef.current = micRecorder;

      // --- Sounder track ---
      const sounderDest = ctx.createMediaStreamDestination();
      sounderDestRef.current = sounderDest;

      // Route AudioProvider sounders through this destination
      setSounderDestination(sounderDest);

      const sounderRecorder = new MediaRecorder(sounderDest.stream, { mimeType: getSupportedMimeType() });
      sounderChunksRef.current = [];
      sounderRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) sounderChunksRef.current.push(e.data);
      };
      sounderRecorder.start(1000);
      sounderRecorderRef.current = sounderRecorder;

      startVU();

      const timer = setInterval(() => {
        setState(prev => ({ ...prev, durationMs: Date.now() - startedAtRef.current }));
      }, 250);
      (window as unknown as { __recordingTimer: ReturnType<typeof setInterval> }).__recordingTimer = timer;
    } catch (err) {
      const timer = (window as unknown as { __recordingTimer?: ReturnType<typeof setInterval> }).__recordingTimer;
      if (timer) clearInterval(timer);
      if (micRecorderRef.current?.state === 'recording') micRecorderRef.current.stop();
      if (sounderRecorderRef.current?.state === 'recording') sounderRecorderRef.current.stop();
      if (micStreamRef.current && ownsMicStreamRef.current) {
        micStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        await audioCtxRef.current.close();
      }
      micStreamRef.current = null;
      ownsMicStreamRef.current = true;
      micSourceRef.current = null;
      micDestRef.current = null;
      sounderDestRef.current = null;
      micRecorderRef.current = null;
      sounderRecorderRef.current = null;
      analyserRef.current = null;
      audioCtxRef.current = null;
      micChunksRef.current = [];
      sounderChunksRef.current = [];
      setSounderDestination(null);
      setState(prev => ({
        ...prev,
        isRecording: false,
        error: err instanceof Error ? err.message : 'Failed to start recording',
      }));
      throw err;
    }
  }, [startVU, setSounderDestination]);

  const stopRecording = useCallback(async (): Promise<RecordingTracks> => {
    stopVU();
    const timer = (window as unknown as { __recordingTimer?: ReturnType<typeof setInterval> }).__recordingTimer;
    if (timer) clearInterval(timer);

    setState(prev => ({ ...prev, isRecording: false, micLevel: 0 }));

    const durationMs = Date.now() - startedAtRef.current;

    const micBlob = await new Promise<Blob>((resolve) => {
      const rec = micRecorderRef.current;
      if (!rec || rec.state === 'inactive') {
        resolve(new Blob(micChunksRef.current, { type: 'audio/webm' }));
        return;
      }
      rec.onstop = () => resolve(new Blob(micChunksRef.current, { type: 'audio/webm' }));
      rec.stop();
    });

    const sounderBlob = await new Promise<Blob>((resolve) => {
      const rec = sounderRecorderRef.current;
      if (!rec || rec.state === 'inactive') {
        resolve(new Blob(sounderChunksRef.current, { type: 'audio/webm' }));
        return;
      }
      rec.onstop = () => resolve(new Blob(sounderChunksRef.current, { type: 'audio/webm' }));
      rec.stop();
    });

    // Cleanup
    if (micStreamRef.current && ownsMicStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop());
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      await audioCtxRef.current.close();
    }

    micStreamRef.current = null;
    ownsMicStreamRef.current = true;
    micSourceRef.current = null;
    micDestRef.current = null;
    sounderDestRef.current = null;
    micRecorderRef.current = null;
    sounderRecorderRef.current = null;
    analyserRef.current = null;
    audioCtxRef.current = null;
    micChunksRef.current = [];
    sounderChunksRef.current = [];

    setSounderDestination(null);

    return {
      mic: micBlob,
      sounders: sounderBlob,
      startedAt: startedAtRef.current,
      durationMs,
    };
  }, [stopVU, setSounderDestination]);

  return {
    state,
    startRecording,
    stopRecording,
    requestMicPermission,
  };
}
