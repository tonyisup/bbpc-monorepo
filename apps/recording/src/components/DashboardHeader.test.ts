import { createRequire } from 'node:module';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardHeader } from './DashboardHeader';
import { createInitialState, sessionReducer } from '@/lib/session-state';

const { act, create } = createRequire(import.meta.url)('react-test-renderer');
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let participantRole: 'owner' | 'guest' = 'owner';
let remoteStop!: (startedAt: number, durationMs: number) => Promise<void>;
let session = createInitialState('EP-test', '2026-09-10', 'Host', []);
const tracks = { mic: new Blob(['mic'], { type: 'audio/mp4' }), sounders: new Blob(['sounders'], { type: 'audio/mp4' }), startedAt: 1000, durationMs: 3000 };
const recording = {
  state: { isRecording: false, micLevel: 0, durationMs: 3000, error: null },
  startRecording: vi.fn(), requestMicPermission: vi.fn(async () => true),
  stopRecording: vi.fn(async () => { recording.state.isRecording = false; return tracks; }),
};
const dispatch = vi.fn(action => { session = sessionReducer(session, action); });
const broadcastStop = vi.fn(async () => {});
const retryPendingEvents = vi.fn(async () => {});
vi.mock('./SessionProvider', () => ({ useSession: () => ({
  state: session, elapsedMs: 3000, dispatch, sessionId: 'header-test', inviteUrl: null,
  participantClientId: 'host', participantAccessToken: 'test', participantRole,
  sessionStatus: 'active', pendingEventCount: 0, syncError: null, retryPendingEvents,
}) }));
vi.mock('./AudioProvider', () => ({ useAudio: () => ({ stopAll: vi.fn() }) }));
vi.mock('@/hooks/useRecordingEngine', () => ({ useRecordingEngine: () => recording }));
vi.mock('@/hooks/useRecordingSync', () => ({ useRecordingSync: (options: { onRemoteStop: typeof remoteStop }) => {
  remoteStop = options.onRemoteStop;
  return { broadcastStart: vi.fn(async () => {}), broadcastStop, retryPendingEvents, pendingCount: 0, syncError: null };
} }));
vi.mock('@/hooks/useMeshAudioRoom', () => ({ useMeshAudioRoom: () => ({
  state: { joined: false, participants: [], selectedInputDeviceId: null }, inputDevices: [],
}) }));

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_RTC_AUDIO_ENABLED', 'false');
  vi.stubGlobal('window', {
    confirm: vi.fn(() => true), addEventListener: vi.fn(), removeEventListener: vi.fn(),
    localStorage: { getItem: vi.fn(() => null), setItem: vi.fn() },
  });
  session = createInitialState('EP-test', '2026-09-10', 'Host', []);
  recording.state.isRecording = false;
  participantRole = 'owner';
  recording.startRecording.mockReset();
  recording.requestMicPermission.mockReset().mockResolvedValue(true);
  vi.clearAllMocks();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

// react-test-renderer exposes the actual handlers and rendered disabled/error state.
type Node = { type: string; props: { onClick: () => Promise<void>; disabled?: boolean; onBlur: () => Promise<void>; onChange: (event: { target: { value: string } }) => void; placeholder?: string }; children: unknown[] };
function button(root: { root: { findAll: (predicate: (node: Node) => boolean) => Node[] } }, text: string) {
  return root.root.findAll(node => node.type === 'button' && node.children.join('') === text)[0];
}

describe('DashboardHeader persistence controls', () => {
  it('keeps failed audio visible and recoverable and refuses to end or start a new recording until upload succeeds', async () => {
    session = { ...session, isRecording: true, recordingStart: 1000 };
    recording.state.isRecording = true;
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    let root: ReturnType<typeof create>;
    await act(async () => { root = create(createElement(DashboardHeader)); });
    await act(async () => button(root, 'End Session').props.onClick());
    expect(recording.stopRecording).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls).toHaveLength(2);
    expect(JSON.stringify(root.toJSON())).toContain('Retry upload');
    expect(JSON.stringify(root.toJSON())).toContain('Download mic');
    expect(button(root, 'Start Recording').props.disabled).toBe(true);
    // Even a direct invocation of the handler cannot overwrite unsaved audio.
    await act(async () => button(root, 'Start Recording').props.onClick());
    expect(recording.startRecording).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await act(async () => button(root, 'Retry upload').props.onClick());
    expect(button(root, 'Start Recording').props.disabled).toBe(false);
    await act(async () => button(root, 'End Session').props.onClick());
    expect(fetchMock.mock.calls).toHaveLength(5);
    await act(async () => root.unmount());
  });

  it('does not commit an episode edit after an HTTP rejection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 })));
    let root: ReturnType<typeof create>;
    await act(async () => { root = create(createElement(DashboardHeader)); });
    await act(async () => button(root, 'EP-test').props.onClick());
    const input = () => root.root.findAll((node: Node) => node.type === 'input' && node.props.placeholder === 'Episode title')[0];
    await act(async () => input().props.onChange({ target: { value: 'Rejected title' } }));
    await act(async () => input().props.onBlur());
    expect(session.episode).toBe('EP-test');
    expect(dispatch).not.toHaveBeenCalled();
    expect(JSON.stringify(root.toJSON())).toContain('Could not save episode title (403)');
    await act(async () => root.unmount());
  });
});

it.each(['permission', 'recorder'] as const)('does not keep recording when host stops during guest %s startup', async stage => {
  participantRole = 'guest';
  session = { ...session, isRecording: true, recordingStart: 1000 };
  let resume!: () => void;
  const waiting = new Promise<void>(resolve => { resume = resolve; });
  if (stage === 'permission') {
    recording.requestMicPermission.mockImplementationOnce(async () => { await waiting; return true; });
  } else {
    recording.startRecording.mockImplementationOnce(async () => { recording.state.isRecording = true; await waiting; });
  }
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  let root: ReturnType<typeof create>;
  await act(async () => { root = create(createElement(DashboardHeader)); });
  await act(async () => button(root, 'Join Recording').props.onClick());
  await act(async () => remoteStop(1000, 3000));
  session = { ...session, isRecording: false, recordingStart: null };
  await act(async () => { resume(); await waiting; });
  expect(recording.state.isRecording).toBe(false);
  expect(dispatch.mock.calls.some(([action]) => action.type === 'JOIN_RECORDING')).toBe(false);
  if (stage === 'permission') {
    expect(recording.startRecording).not.toHaveBeenCalled();
  } else {
    expect(recording.stopRecording).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }
  await act(async () => root.unmount());
});
