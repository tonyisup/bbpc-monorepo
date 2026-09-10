import { createRequire } from 'node:module';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRecordingEngine } from './useRecordingEngine';

const setSounderDestination = vi.fn();
vi.mock('@/components/AudioProvider', () => ({ useAudio: () => ({ setSounderDestination }) }));
const { act, create } = createRequire(import.meta.url)('react-test-renderer');
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); });

function installAudio() {
  const recorders: FakeRecorder[] = [];
  const ownedTracks: Array<{ stop: ReturnType<typeof vi.fn> }> = [];
  const contexts: FakeContext[] = [];
  const stream = () => {
    const track = { stop: vi.fn() };
    ownedTracks.push(track);
    return { getTracks: () => [track] };
  };
  class FakeRecorder {
    static isTypeSupported(type: string) { return type === 'audio/mp4'; }
    state = 'inactive';
    mimeType: string;
    ondataavailable?: (event: { data: Blob }) => void;
    onstop?: () => void;
    constructor(_stream: unknown, { mimeType }: { mimeType: string }) { this.mimeType = mimeType; recorders.push(this); }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(['final audio'], { type: this.mimeType }) });
        this.onstop?.();
      });
    }
  }
  class FakeContext {
    state = 'running';
    close = vi.fn(async () => { this.state = 'closed'; });
    constructor() { contexts.push(this); }
    createMediaStreamSource() { return { connect: vi.fn(), disconnect: vi.fn() }; }
    createAnalyser() { return { connect: vi.fn(), disconnect: vi.fn(), fftSize: 0, frequencyBinCount: 2 }; }
    createMediaStreamDestination() { return { stream: stream() }; }
  }
  vi.stubGlobal('window', { AudioContext: FakeContext });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => stream()) } });
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  return { recorders, ownedTracks, contexts };
}

describe('recording engine lifecycle', () => {
  it('preserves the negotiated MIME and final chunks, stops both tracks, and clears its interval', async () => {
    vi.useFakeTimers();
    const audio = installAudio();
    let engine!: ReturnType<typeof useRecordingEngine>;
    function Harness() { engine = useRecordingEngine(); return null; }
    let root: { unmount: () => void };
    await act(async () => { root = create(createElement(Harness)); });
    await act(async () => engine.startRecording());
    expect(vi.getTimerCount()).toBe(1);
    let tracks!: Awaited<ReturnType<typeof engine.stopRecording>>;
    await act(async () => { tracks = await engine.stopRecording(); });
    expect(tracks.mic.type).toBe('audio/mp4');
    expect(await tracks.mic.text()).toBe('final audio');
    expect(await tracks.sounders.text()).toBe('final audio');
    expect(audio.recorders.every(recorder => recorder.state === 'inactive')).toBe(true);
    expect(audio.ownedTracks.every(track => track.stop.mock.calls.length === 1)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(audio.contexts[0].close).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it('finalizes interrupted recording for recovery on unmount without stopping a borrowed microphone', async () => {
    vi.useFakeTimers();
    const audio = installAudio();
    const interrupted = vi.fn();
    const borrowedTrack = { stop: vi.fn() };
    let engine!: ReturnType<typeof useRecordingEngine>;
    function Harness() { engine = useRecordingEngine(interrupted); return null; }
    let root: { unmount: () => void };
    await act(async () => { root = create(createElement(Harness)); });
    await act(async () => engine.startRecording({ mediaStream: { getTracks: () => [borrowedTrack] } as unknown as MediaStream }));
    await act(async () => root.unmount());
    expect(borrowedTrack.stop).not.toHaveBeenCalled();
    expect(audio.ownedTracks.every(track => track.stop.mock.calls.length === 1)).toBe(true);
    expect(interrupted).toHaveBeenCalledTimes(1);
    expect(await interrupted.mock.calls[0][0].mic.text()).toBe('final audio');
    expect(vi.getTimerCount()).toBe(0);
  });
});
