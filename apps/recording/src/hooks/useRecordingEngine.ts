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
  mic: Blob;        // The recorder-selected audio format
  sounders: Blob;
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
  throw new Error('This browser has no supported audio recording format');
}

/**
 * Recording engine using Web Audio API.
 *
 * Creates an AudioContext with two output paths:
 *   Mic → MediaStreamDestination → MediaRecorder (mic track)
 *   Sounder destination (via AudioProvider) → MediaStreamDestination → MediaRecorder (sounder track)
 */
export function useRecordingEngine(onInterrupted?: (tracks: RecordingTracks) => void): RecordingEngine {
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

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startingRef = useRef(false);
  const mountedRef = useRef(true);
  const stoppingRef = useRef<Promise<RecordingTracks> | null>(null);

  const teardown = useCallback(async () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    for (const recorder of [micRecorderRef.current, sounderRecorderRef.current]) {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    }
    if (ownsMicStreamRef.current) micStreamRef.current?.getTracks().forEach(track => track.stop());
    micDestRef.current?.stream.getTracks().forEach(track => track.stop());
    sounderDestRef.current?.stream.getTracks().forEach(track => track.stop());
    micSourceRef.current?.disconnect();
    analyserRef.current?.disconnect();
    const ctx = audioCtxRef.current;
    micStreamRef.current = null;
    micSourceRef.current = null;
    micDestRef.current = null;
    sounderDestRef.current = null;
    micRecorderRef.current = null;
    sounderRecorderRef.current = null;
    analyserRef.current = null;
    audioCtxRef.current = null;
    setSounderDestination(null);
    if (ctx && ctx.state !== 'closed') await ctx.close();
  }, [setSounderDestination]);

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
    if (startingRef.current || micRecorderRef.current || stoppingRef.current) return;
    startingRef.current = true;
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
      if (!mountedRef.current) {
        if (!options?.mediaStream || options.ownsMediaStream) micStream.getTracks().forEach(track => track.stop());
        return;
      }
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

      timerRef.current = setInterval(() => {
        setState(prev => ({ ...prev, durationMs: Date.now() - startedAtRef.current }));
      }, 250);
    } catch (err) {
      await teardown();
      setState(prev => ({
        ...prev,
        isRecording: false,
        error: err instanceof Error ? err.message : 'Failed to start recording',
      }));
      throw err;
    } finally {
      startingRef.current = false;
    }
  }, [startVU, setSounderDestination, teardown]);

  const stopRecording = useCallback((): Promise<RecordingTracks> => {
    if (stoppingRef.current) return stoppingRef.current;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (mountedRef.current) setState(prev => ({ ...prev, isRecording: false, micLevel: 0 }));
    const durationMs = Date.now() - startedAtRef.current;
    const stopTrack = (rec: MediaRecorder | null, chunks: Blob[]) => new Promise<Blob>(resolve => {
      const finish = () => resolve(new Blob(chunks, { type: rec?.mimeType || chunks[0]?.type || '' }));
      if (!rec || rec.state === 'inactive') finish();
      else {
        rec.onstop = finish;
        rec.stop();
      }
    });
    // Stop both recorders at the same boundary, before waiting for either final chunk.
    const result = Promise.all([
      stopTrack(micRecorderRef.current, micChunksRef.current),
      stopTrack(sounderRecorderRef.current, sounderChunksRef.current),
    ]).then(async ([mic, sounders]) => {
      await teardown();
      micChunksRef.current = [];
      sounderChunksRef.current = [];
      return { mic, sounders, startedAt: startedAtRef.current, durationMs };
    }).finally(() => { stoppingRef.current = null; });
    stoppingRef.current = result;
    return result;
  }, [teardown]);

  const onInterruptedRef = useRef(onInterrupted);
  useEffect(() => { onInterruptedRef.current = onInterrupted; }, [onInterrupted]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (micRecorderRef.current || sounderRecorderRef.current) {
        void stopRecording().then(tracks => onInterruptedRef.current?.(tracks));
      } else {
        void teardown();
      }
    };
  }, [stopRecording, teardown]);

  return {
    state,
    startRecording,
    stopRecording,
    requestMicPermission,
  };
}
