import { createRequire } from 'node:module';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MIC_LOST_ERROR, RECORDER_STOPPED_ERROR, useRecordingEngine } from './useRecordingEngine';

const setSounderDestination = vi.fn();
vi.mock('@/components/AudioProvider', () => ({ useAudio: () => ({ setSounderDestination }) }));
const { act, create } = createRequire(import.meta.url)('react-test-renderer');
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); });

type FakeTrack = {
  stop: Mock<() => void>;
  readyState: 'live' | 'ended';
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  end: () => void;
};

function fakeTrack(): FakeTrack {
  const listeners = new Set<() => void>();
  const track: FakeTrack = {
    stop: vi.fn(() => { track.readyState = 'ended'; }),
    readyState: 'live',
    addEventListener: (_type, listener) => { listeners.add(listener); },
    removeEventListener: (_type, listener) => { listeners.delete(listener); },
    // The device went away: the browser ends the track and fires `ended`.
    end: () => { track.readyState = 'ended'; listeners.forEach(listener => listener()); },
  };
  return track;
}

function fakeStream(track = fakeTrack()) {
  return { track, getTracks: () => [track], getAudioTracks: () => [track] };
}

function installAudio({ contextState = 'running' as 'running' | 'suspended' } = {}) {
  const recorders: FakeRecorder[] = [];
  const ownedTracks: FakeTrack[] = [];
  const contexts: FakeContext[] = [];
  const sources: Array<{ stream: unknown; disconnect: ReturnType<typeof vi.fn> }> = [];
  const stream = () => {
    const created = fakeStream();
    ownedTracks.push(created.track);
    return created;
  };
  class FakeRecorder {
    static isTypeSupported(type: string) { return type === 'audio/mp4'; }
    state = 'inactive';
    mimeType: string;
    stream: unknown;
    ondataavailable?: (event: { data: Blob }) => void;
    onstop?: () => void;
    onerror?: (event: Event) => void;
    constructor(recordedStream: unknown, { mimeType }: { mimeType: string }) { this.stream = recordedStream; this.mimeType = mimeType; recorders.push(this); }
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
    state: string = contextState;
    close = vi.fn(async () => { this.state = 'closed'; });
    // A context without user activation stays suspended.
    resume = vi.fn(async () => {});
    destinations: Array<{ stream: ReturnType<typeof stream> }> = [];
    constructor() { contexts.push(this); }
    createMediaStreamSource(sourceStream: unknown) {
      const source = { stream: sourceStream, connect: vi.fn(), disconnect: vi.fn() };
      sources.push(source);
      return source;
    }
    createAnalyser() { return { connect: vi.fn(), disconnect: vi.fn(), fftSize: 0, frequencyBinCount: 2 }; }
    createMediaStreamDestination() {
      const destination = { stream: stream() };
      this.destinations.push(destination);
      return destination;
    }
  }
  const getUserMedia = vi.fn(async () => stream());
  vi.stubGlobal('window', { AudioContext: FakeContext });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  return { recorders, ownedTracks, contexts, sources, getUserMedia };
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
    const borrowedTrack = fakeTrack();
    let engine!: ReturnType<typeof useRecordingEngine>;
    function Harness() { engine = useRecordingEngine(interrupted); return null; }
    let root: { unmount: () => void };
    await act(async () => { root = create(createElement(Harness)); });
    await act(async () => engine.startRecording({ mediaStream: fakeStream(borrowedTrack) as unknown as MediaStream }));
    await act(async () => root.unmount());
    expect(borrowedTrack.stop).not.toHaveBeenCalled();
    expect(audio.ownedTracks.every(track => track.stop.mock.calls.length === 1)).toBe(true);
    expect(interrupted).toHaveBeenCalledTimes(1);
    expect(await interrupted.mock.calls[0][0].mic.text()).toBe('final audio');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('microphone lifecycle (audit R03)', () => {
  async function mount(interrupted = vi.fn()) {
    let engine!: ReturnType<typeof useRecordingEngine>;
    function Harness() { engine = useRecordingEngine(interrupted); return null; }
    let root!: { unmount: () => void };
    await act(async () => { root = create(createElement(Harness)); });
    return { engine: () => engine, root, interrupted };
  }

  it('keeps recording across a microphone switch without touching the borrowed stream', async () => {
    const audio = installAudio();
    const { engine, root } = await mount();
    const callMic = fakeStream();
    await act(async () => engine().startRecording({ mediaStream: callMic as unknown as MediaStream }));
    const [micRecorder] = audio.recorders;
    expect(engine().state.inputSwitchable).toBe(true);
    // The recorder takes the graph's output, not the call's track.
    expect(micRecorder.stream).toBe(audio.contexts[0].destinations[0].stream);

    const newMic = fakeStream();
    await act(async () => engine().replaceMicStream(newMic as unknown as MediaStream));
    expect(audio.sources.map(source => source.stream)).toEqual([callMic, newMic]);
    expect(audio.sources[0].disconnect).toHaveBeenCalled();
    // The call hook stops the old track itself; the take keeps going.
    callMic.track.stop();
    expect(micRecorder.state).toBe('recording');
    expect(engine().state.isRecording).toBe(true);
    expect(newMic.track.stop).not.toHaveBeenCalled();
    await act(async () => { await engine().stopRecording(); });
    await act(async () => root.unmount());
  });

  it('opens its own microphone when the call stream goes away, and stops it afterwards', async () => {
    const audio = installAudio();
    const { engine, root } = await mount();
    await act(async () => engine().startRecording({ mediaStream: fakeStream() as unknown as MediaStream }));
    await act(async () => engine().replaceMicStream(null));
    expect(audio.getUserMedia).toHaveBeenCalledTimes(1);
    expect(audio.recorders[0].state).toBe('recording');
    const ownMic = audio.ownedTracks.at(-1)!;
    // Asking again while it has a live microphone of its own does nothing.
    await act(async () => engine().replaceMicStream(null));
    expect(audio.getUserMedia).toHaveBeenCalledTimes(1);
    await act(async () => { await engine().stopRecording(); });
    expect(ownMic.stop).toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it('recovers from an unplugged microphone, or says so when it cannot', async () => {
    const audio = installAudio();
    const { engine, root } = await mount();
    const callMic = fakeStream();
    await act(async () => engine().startRecording({ mediaStream: callMic as unknown as MediaStream }));
    audio.getUserMedia.mockRejectedValueOnce(new Error('NotFoundError'));
    await act(async () => { callMic.track.end(); });
    expect(engine().state.error).toBe(MIC_LOST_ERROR);
    expect(engine().state.isRecording).toBe(true);

    await act(async () => engine().replaceMicStream(fakeStream() as unknown as MediaStream));
    expect(engine().state.error).toBeNull();
    await act(async () => { await engine().stopRecording(); });
    await act(async () => root.unmount());
  });

  it('locks the input and records the track itself when the audio context cannot run', async () => {
    const audio = installAudio({ contextState: 'suspended' });
    const { engine, root } = await mount();
    const callMic = fakeStream();
    await act(async () => engine().startRecording({ mediaStream: callMic as unknown as MediaStream }));
    expect(audio.contexts[0].resume).toHaveBeenCalled();
    expect(engine().state.inputSwitchable).toBe(false);
    expect(audio.recorders[0].stream).toBe(callMic);
    await act(async () => engine().replaceMicStream(fakeStream() as unknown as MediaStream));
    expect(audio.sources).toHaveLength(1);
    await act(async () => { await engine().stopRecording(); });
    await act(async () => root.unmount());
  });

  it('finalizes the take for recovery and reports it when a recorder stops on its own', async () => {
    const audio = installAudio({ contextState: 'suspended' });
    const { engine, root, interrupted } = await mount();
    await act(async () => engine().startRecording({ mediaStream: fakeStream() as unknown as MediaStream }));
    // What the audit observed after Leave Audio: the browser stops the recorder.
    await act(async () => { audio.recorders[0].stop(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(interrupted).toHaveBeenCalledTimes(1);
    expect(await interrupted.mock.calls[0][0].mic.text()).toBe('final audio');
    expect(engine().state.isRecording).toBe(false);
    expect(engine().state.error).toBe(RECORDER_STOPPED_ERROR);
    expect(audio.recorders.every(recorder => recorder.state === 'inactive')).toBe(true);
    await act(async () => root.unmount());
    expect(interrupted).toHaveBeenCalledTimes(1);
  });
});
