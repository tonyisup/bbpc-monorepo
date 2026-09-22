import 'server-only';

import { BBPC_CLIENT_API_VERSION, recordingApi } from '@/lib/convex/api';
import { mutateSharedConvexAsUser, querySharedConvexAsUser } from '@/lib/convex/http';
import { deleteRecordingBlob } from './storage';

const BATCH = 100;
// Bounded per request; the next cleanup picks up where this one stopped.
const MAX_BATCHES = 10;

/**
 * Deletes the audio of recording sessions whose data was deleted. Only blobs
 * that storage confirms deleted are removed from the queue, so failures are
 * retried by the next cleanup.
 */
export async function purgeDeletedRecordingBlobs(token: string): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const pending = await querySharedConvexAsUser(recordingApi.recordings.listPendingBlobDeletions, { limit: BATCH }, token);
    if (pending.length === 0) break;
    const results = await Promise.allSettled(pending.map(item => deleteRecordingBlob(item.blobName)));
    const done = pending.filter((_, index) => results[index].status === 'fulfilled').map(item => item.id);
    failed += pending.length - done.length;
    if (done.length === 0) {
      console.error('[Recording Admin] Could not delete recording audio:', results.find(result => result.status === 'rejected'));
      break;
    }
    await mutateSharedConvexAsUser(recordingApi.recordings.acknowledgeBlobDeletions, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      ids: done,
    }, token);
    deleted += done.length;
    if (done.length < pending.length) break;
  }
  return { deleted, failed };
}
