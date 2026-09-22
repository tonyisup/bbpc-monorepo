import { createRequire } from 'node:module';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from '@/lib/session-state';

const state = {
  ...createInitialState('EP', '2026-09-22', 'Host'),
  editCues: [{ id: 'cue-open', start_ms: 1_000, end_ms: null, type: 'spoiler' as const }],
};
const dispatch = vi.fn();
vi.mock('./SessionProvider', () => ({ useSession: () => ({ state, dispatch, elapsedMs: 4_000 }) }));

const { EditCuePanel } = await import('./EditCuePanel');
const { act, create } = createRequire(import.meta.url)('react-test-renderer');
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('EditCuePanel', () => {
  it('labels and ends the open cue restored from session state', async () => {
    let root!: { root: { findAll: (predicate: (node: { type: string; children: unknown[] }) => boolean) => Array<{ props: { onClick: () => void } }> }; unmount: () => void };
    await act(async () => { root = create(createElement(EditCuePanel)); });
    // The selected type defaults to doxx-bleep; the open cue is a spoiler.
    const [end] = root.root.findAll(node => node.type === 'button' && node.children.join('') === 'END SPOILER CUE');
    expect(end).toBeDefined();
    await act(async () => end.props.onClick());
    expect(dispatch).toHaveBeenCalledWith({ type: 'UPDATE_EDIT_CUE', id: 'cue-open', end_ms: 4_000 });
    await act(async () => root.unmount());
  });
});
