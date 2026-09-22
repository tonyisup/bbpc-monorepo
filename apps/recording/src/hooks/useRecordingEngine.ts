'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import { useAudio } from '@/components/AudioProvider';

export interface RecordingState {
  isRecording: boolean;
  micLevel: number; // 0-1 for VU meter
  durationMs: number;
  error: string | null;
  /**
   * Whether the microphone input can change mid-recording. False when the
   * audio context could not run, so the recorder holds the input track itself.
   */
  inputSwitchable: boolean;
}

export interface RecordingEngine {
  state: RecordingState;
  startRecording: (options?: { mediaStream?: MediaStream; ownsMediaStream?: boolean }) => Promise<void>;
  stopRecording: () => Promise<RecordingTracks>;
  /**
   * Record from a different microphone stream without stopping the take.
   * Null means the borrowed stream went away; the engine opens its own.
   */
  replaceMicStream: (stream: MediaStream | null) => Promise<void>;
  requestMicPermission: () => Promise<boolean>;
}

export interface RecordingTracks {
  mic: Blob;        // The recorder-selected audio format
  sounders: Blob;
  startedAt: number; // Date.now() when recording started
  durationMs: number;
}

const SAMPLE_RATE = 48000;
const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: SAMPLE_RATE,
};
export const MIC_LOST_ERROR = 'Microphone disconnected. Your voice is not being recorded.';
export const RECORDER_STOPPED_ERROR = 'Recording stopped unexpectedly. The audio captured so far is kept in this tab.';

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
 *
 * Recording the destination rather than the microphone track lets the input
 * change without ending the take (audit R03). If the context cannot run, the
 * recorder falls back to the track itself and input changes are locked.
 * An unexpected recorder stop finalizes the take for recovery.
 */
export function useRecordingEngine(onInterrupted?: (tracks: RecordingTracks) => void): RecordingEngine {
  const { setSounderDestination } = useAudio();
  const [state, setState] = useState<RecordingState>({
    isRecording: false,
    micLevel: 0,
    durationMs: 0,
    error: null,
    inputSwitchable: false,
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
  const inputSwitchableRef = useRef(false);
  const detachTrackEndedRef = useRef<(() => void) | null>(null);
  const onMicTrackEndedRef = useRef<() => void>(() => {});
  const onUnexpectedStopRef = useRef<() => void>(() => {});
  const recorderErrorRef = useRef<string | null>(null);

  const teardown = useCallback(async () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    for (const recorder of [micRecorderRef.current, sounderRecorderRef.current]) {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    }
    detachTrackEndedRef.current?.();
    detachTrackEndedRef.current = null;
    inputSwitchableRef.current = false;
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
      stream.getTracks().forEach(t => t.stop());
      return true;
    } catch {
      setState(prev => ({ ...prev, error: 'Microphone permission denied' }));
      return false;
    }
  }, []);

  // Route a microphone stream into the graph, replacing the previous source.
  const connectMicSource = useCallback((ctx: AudioContext, micStream: MediaStream) => {
    micSourceRef.current?.disconnect();
    detachTrackEndedRef.current?.();
    const micSource = ctx.createMediaStreamSource(micStream);
    micSourceRef.current = micSource;
    if (analyserRef.current) micSource.connect(analyserRef.current);
    if (micDestRef.current) micSource.connect(micDestRef.current);
    // A track ends on its own when the device is unplugged or revoked.
    const tracks = micStream.getAudioTracks?.() ?? [];
    const onEnded = () => onMicTrackEndedRef.current();
    tracks.forEach(track => track.addEventListener?.('ended', onEnded));
    detachTrackEndedRef.current = () => tracks.forEach(track => track.removeEventListener?.('ended', onEnded));
  }, []);

  const startRecording = useCallback(async (options?: { mediaStream?: MediaStream; ownsMediaStream?: boolean }) => {
    if (startingRef.current || micRecorderRef.current || stoppingRef.current) return;
    startingRef.current = true;
    try {
      setState(prev => ({ ...prev, error: null, isRecording: true, micLevel: 0, durationMs: 0 }));
      startedAtRef.current = Date.now();
      recorderErrorRef.current = null;

      const ctx = createAudioContext();
      audioCtxRef.current = ctx;
      if (ctx.state === 'suspended') await ctx.resume?.().catch(() => {});

      // --- Mic track ---
      const micStream = options?.mediaStream ?? await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
      if (!mountedRef.current) {
        if (!options?.mediaStream || options.ownsMediaStream) micStream.getTracks().forEach(track => track.stop());
        return;
      }
      micStreamRef.current = micStream;
      ownsMicStreamRef.current = options?.mediaStream ? options.ownsMediaStream ?? false : true;

      // VU meter
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;

      // Mic output destination
      const micDest = ctx.createMediaStreamDestination();
      micDestRef.current = micDest;
      connectMicSource(ctx, micStream);

      // Mic recorder: from the graph when it runs, so the input can change.
      const inputSwitchable = ctx.state === 'running';
      inputSwitchableRef.current = inputSwitchable;
      const micRecorder = new MediaRecorder(inputSwitchable ? micDest.stream : micStream, { mimeType: getSupportedMimeType() });
      micChunksRef.current = [];
      micRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) micChunksRef.current.push(e.data);
      };
      micRecorder.onerror = (event) => {
        const error = (event as Event & { error?: { message?: string } }).error;
        recorderErrorRef.current = error?.message ?? 'The browser reported a recording error';
      };
      micRecorder.onstop = () => onUnexpectedStopRef.current();
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
      sounderRecorder.onstop = () => onUnexpectedStopRef.current();
      sounderRecorder.start(1000);
      sounderRecorderRef.current = sounderRecorder;
      setState(prev => ({ ...prev, inputSwitchable }));

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
  }, [connectMicSource, startVU, setSounderDestination, teardown]);

  const stopRecording = useCallback((): Promise<RecordingTracks> => {
    if (stoppingRef.current) return stoppingRef.current;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (mountedRef.current) setState(prev => ({ ...prev, isRecording: false, micLevel: 0, inputSwitchable: false }));
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

  const replaceMicStream = useCallback(async (stream: MediaStream | null) => {
    const ctx = audioCtxRef.current;
    if (!ctx || !micRecorderRef.current || stoppingRef.current || !inputSwitchableRef.current) return;
    if (stream === micStreamRef.current) return;
    // Already on a microphone of its own: nothing was taken away.
    if (stream === null && ownsMicStreamRef.current && micStreamRef.current?.getAudioTracks?.().some(track => track.readyState !== 'ended')) return;
    // Another replacement (such as the call's newly selected microphone) may
    // land while the default microphone is being opened; that one wins.
    const replacing = micStreamRef.current;
    let next = stream;
    try {
      next ??= await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
    } catch {
      if (mountedRef.current && micStreamRef.current === replacing) setState(prev => ({ ...prev, error: MIC_LOST_ERROR }));
      return;
    }
    if (
      audioCtxRef.current !== ctx
      || !micRecorderRef.current
      || stoppingRef.current
      || micStreamRef.current !== replacing
    ) {
      if (stream === null) next.getTracks().forEach(track => track.stop());
      return;
    }
    const previous = micStreamRef.current;
    const ownedPrevious = ownsMicStreamRef.current;
    micStreamRef.current = next;
    ownsMicStreamRef.current = stream === null;
    connectMicSource(ctx, next);
    if (ownedPrevious) previous?.getTracks().forEach(track => track.stop());
    if (mountedRef.current) setState(prev => ({ ...prev, error: prev.error === MIC_LOST_ERROR ? null : prev.error }));
  }, [connectMicSource]);

  const onInterruptedRef = useRef(onInterrupted);
  useEffect(() => { onInterruptedRef.current = onInterrupted; }, [onInterrupted]);
  useEffect(() => {
    onMicTrackEndedRef.current = () => {
      if (!micRecorderRef.current || stoppingRef.current) return;
      if (inputSwitchableRef.current) {
        // Keep the take and try the default microphone.
        void replaceMicStream(null);
        return;
      }
      // The recorder holds this track, so it is stopping; onstop finalizes it.
      if (mountedRef.current) setState(prev => ({ ...prev, error: MIC_LOST_ERROR }));
    };
    onUnexpectedStopRef.current = () => {
      if (stoppingRef.current || !micRecorderRef.current) return;
      const cause = recorderErrorRef.current;
      console.error('[Recording] Recorder stopped unexpectedly', cause ?? '');
      void stopRecording().then(tracks => {
        onInterruptedRef.current?.(tracks);
        if (mountedRef.current) setState(prev => ({ ...prev, error: cause ? `${RECORDER_STOPPED_ERROR} (${cause})` : RECORDER_STOPPED_ERROR }));
      });
    };
  }, [replaceMicStream, stopRecording]);
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
    replaceMicStream,
    requestMicPermission,
  };
}
