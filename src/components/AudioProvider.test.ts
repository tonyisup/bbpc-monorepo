import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { connectSounderToRecordingGraph } from './AudioProvider';

describe('connectSounderToRecordingGraph', () => {
  it('creates the source in the recording destination context', () => {
    const connections: string[] = [];
    const speakerDestination = { kind: 'speakers' } as unknown as AudioDestinationNode;
    const recordingDestination = { kind: 'recording' } as unknown as MediaStreamAudioDestinationNode;
    const ctx = {
      state: 'running',
      destination: speakerDestination,
    } as unknown as AudioContext;
    Object.defineProperty(recordingDestination, 'context', { value: ctx });

    const source = {
      connect(node: AudioNode) {
        connections.push(node === speakerDestination ? 'speakers' : 'recording');
        return source;
      },
    } as unknown as MediaElementAudioSourceNode;

    let sourceContext: AudioContext | null = null;
    connectSounderToRecordingGraph(
      {} as HTMLAudioElement,
      recordingDestination,
      (incomingCtx) => {
        sourceContext = incomingCtx;
        return source;
      },
    );

    assert.equal(sourceContext, ctx);
    assert.deepEqual(connections, ['speakers', 'recording']);
  });

  it('resumes a suspended context before wiring playback', () => {
    let resumeCalled = false;
    const speakerDestination = {} as AudioDestinationNode;
    const recordingDestination = {} as MediaStreamAudioDestinationNode;
    const ctx = {
      state: 'suspended',
      destination: speakerDestination,
      resume() {
        resumeCalled = true;
        return Promise.resolve();
      },
    } as unknown as AudioContext;
    Object.defineProperty(recordingDestination, 'context', { value: ctx });

    const source = {
      connect() {
        return source;
      },
    } as unknown as MediaElementAudioSourceNode;

    connectSounderToRecordingGraph(
      {} as HTMLAudioElement,
      recordingDestination,
      () => source,
    );

    assert.equal(resumeCalled, true);
  });
});
