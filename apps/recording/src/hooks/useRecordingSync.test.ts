import { createRequire } from 'node:module';
import { createElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { isRecordingPortableId } from '@tonyisup/bbpc-convex-api/contracts';
import { useRecordingSync } from './useRecordingSync';

const mutation = vi.fn();
vi.mock('convex/react', () => ({ useMutation: () => mutation, useQuery: () => undefined }));
const { act, create } = createRequire(import.meta.url)('react-test-renderer');
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => { vi.unstubAllGlobals(); mutation.mockReset(); });

it('gives each rendered tab its own event source', async () => {
  // Audit R02: React useId gave identical trees in separate browsers the same
  // source, so each discarded the other's commands as its own echo.
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  mutation.mockResolvedValue(null);
  const sources: string[] = [];
  for (const sessionId of ['source-one', 'source-two']) {
    let hook!: ReturnType<typeof useRecordingSync>;
    function Harness() {
      hook = useRecordingSync({
        sessionId,
        clientId: 'client_owner',
        accessToken: 'test',
        participantRole: 'owner',
        onRemoteStart: () => {},
        onRemoteStop: () => {},
      });
      return null;
    }
    let root!: { unmount: () => void };
    await act(async () => { root = create(createElement(Harness)); });
    await act(async () => { await hook.broadcastStart(1_000, { clientId: 'client_owner', name: 'Host', joinedAt: 1_000 }); });
    sources.push(mutation.mock.calls.at(-1)![0].payload.from);
    await act(async () => root.unmount());
  }
  expect(sources[0]).not.toBe(sources[1]);
  expect(sources.every(isRecordingPortableId)).toBe(true);
});
