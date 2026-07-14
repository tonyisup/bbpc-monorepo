import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { afterEach, describe, it, vi } from 'vitest';
import { useMeshAudioRoom } from './useMeshAudioRoom';

const mutation = vi.fn();

vi.mock('convex/react', () => ({
  useMutation: () => mutation,
  useQuery: () => undefined,
}));

const require = createRequire(import.meta.url);
const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: ReturnType<typeof createElement>) => {
    unmount: () => void;
    update: (element: ReturnType<typeof createElement>) => void;
  };
};

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ displayName }: { displayName: string }) {
  useMeshAudioRoom({
    enabled: true,
    sessionId: 'session-id',
    clientId: 'client-id',
    accessToken: 'access-token',
    displayName,
    role: 'owner',
    recording: false,
    recordingStartedAt: null,
    sessionEnded: false,
    onAudioJoined: () => undefined,
    onAudioLeft: () => undefined,
    onDisconnectStarted: () => undefined,
    onDisconnectEnded: () => undefined,
  });

  return null;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useMeshAudioRoom', () => {
  it('does not tear down when inline event handlers change identity', async () => {
    const errors: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });

    let root: ReturnType<typeof create> | undefined;
    await act(async () => {
      root = create(createElement(Harness, { displayName: 'Initial' }));
    });

    await act(async () => {
      root?.update(createElement(Harness, { displayName: 'Updated' }));
    });

    assert.equal(
      errors.some(args => args.some(value => String(value).includes('Maximum update depth exceeded'))),
      false,
    );

    await act(async () => {
      root?.unmount();
    });
  });
});
