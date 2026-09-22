import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pending: [] as Array<{ id: string; blobName: string }>,
  failing: new Set<string>(),
  acknowledged: [] as string[][],
}));
vi.mock('server-only', () => ({}));
vi.mock('./storage', () => ({
  deleteRecordingBlob: vi.fn(async (blobName: string) => {
    if (mocks.failing.has(blobName)) throw new Error('storage unavailable');
  }),
}));
vi.mock('@/lib/convex/http', () => ({
  querySharedConvexAsUser: vi.fn(async (_query: unknown, { limit }: { limit: number }) => mocks.pending.slice(0, limit)),
  mutateSharedConvexAsUser: vi.fn(async (_mutation: unknown, { ids }: { ids: string[] }) => {
    mocks.acknowledged.push(ids);
    mocks.pending = mocks.pending.filter(item => !ids.includes(item.id));
    return ids.length;
  }),
}));

const { purgeDeletedRecordingBlobs } = await import('./purge');

afterEach(() => {
  mocks.pending = [];
  mocks.failing.clear();
  mocks.acknowledged = [];
});

describe('recording audio purge', () => {
  it('deletes queued audio in batches and acknowledges it', async () => {
    mocks.pending = Array.from({ length: 150 }, (_, index) => ({ id: `id-${index}`, blobName: `blob-${index}` }));
    await expect(purgeDeletedRecordingBlobs('token')).resolves.toEqual({ deleted: 150, failed: 0 });
    expect(mocks.acknowledged.map(ids => ids.length)).toEqual([100, 50]);
    expect(mocks.pending).toEqual([]);
  });

  it('keeps audio it could not delete queued for the next cleanup', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.pending = [{ id: 'a', blobName: 'blob-a' }, { id: 'b', blobName: 'blob-b' }];
    mocks.failing.add('blob-b');
    await expect(purgeDeletedRecordingBlobs('token')).resolves.toEqual({ deleted: 1, failed: 1 });
    expect(mocks.pending).toEqual([{ id: 'b', blobName: 'blob-b' }]);

    mocks.failing.add('blob-a');
    mocks.pending.unshift({ id: 'a', blobName: 'blob-a' });
    await expect(purgeDeletedRecordingBlobs('token')).resolves.toEqual({ deleted: 0, failed: 2 });
    expect(mocks.pending).toHaveLength(2);
  });
});
