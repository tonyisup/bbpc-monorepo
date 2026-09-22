import { describe, expect, it } from 'vitest';
import { isRecordingPortableId } from '@tonyisup/bbpc-convex-api/contracts';

import { createEventId } from '@/hooks/useSessionSync';
import { createRtcId } from '@/lib/rtc/mesh';
import { createClientId } from '@/lib/sessions/ids';
import { createPortableId } from './portable-ids';

// The backend validates these with the same shared pattern (audit R01), and
// limits event and signal IDs to 160 characters.
const BACKEND_ID_LIMIT = 160;

function expectBackendAccepts(id: string) {
  expect(isRecordingPortableId(id), id).toBe(true);
  expect(id.length).toBeLessThanOrEqual(BACKEND_ID_LIMIT);
}

describe('browser-generated recording identifiers', () => {
  it('produces event IDs the backend accepts', () => {
    expectBackendAccepts(createEventId());
  });

  it('produces RTC signal and disconnect IDs the backend accepts', () => {
    const local = createClientId();
    const remote = createClientId();
    for (const type of ['offer', 'answer', 'ice-candidate', 'renegotiate']) {
      expectBackendAccepts(createRtcId(local, 'to', remote, type));
    }
    expectBackendAccepts(createRtcId('disconnect', local, remote));
    expectBackendAccepts(createRtcId('hidden', local));
  });

  it('replaces characters outside the portable alphabet', () => {
    const id = createPortableId('sess:one', 'a->b', 'x y');
    expectBackendAccepts(id);
    expect(id.startsWith('sess-one-a--b-x-y-')).toBe(true);
  });

  it('never repeats, so separate tabs get separate event sources', () => {
    const ids = new Set(Array.from({ length: 100 }, () => createPortableId('sess')));
    expect(ids.size).toBe(100);
  });
});
