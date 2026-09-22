import { RECORDING_BLOCK_BYTES } from './upload';
import type { TrackType } from './durable-store';

export interface TrackUpload {
  sessionId: string;
  episode: string;
  trackType: TrackType;
  startedAt: number;
  blob: Blob;
  /** Blocks already staged, from an earlier attempt or page load. */
  uploadedBlocks: ReadonlySet<number>;
  onBlockUploaded?: (index: number) => void | Promise<void>;
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
}

async function failure(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => null) as { message?: unknown } | null;
  return new Error(typeof body?.message === 'string' ? body.message : `${fallback} (${response.status})`);
}

/**
 * Uploads one track in blocks small enough for any hosting request limit,
 * skipping blocks already staged, then commits them into a single blob.
 * Storage discards uncommitted blocks after a week, so if the commit fails
 * after skipping blocks, every block is sent again once.
 */
export async function uploadTrackInBlocks(upload: TrackUpload): Promise<void> {
  const { blob } = upload;
  if (blob.size === 0) return;
  const take = {
    sessionId: upload.sessionId,
    trackType: upload.trackType,
    startedAt: String(upload.startedAt),
    contentType: blob.type,
  };
  const blockCount = Math.ceil(blob.size / RECORDING_BLOCK_BYTES);

  const stageBlocks = async (skipUploaded: boolean) => {
    let uploadedBytes = 0;
    for (let index = 0; index < blockCount; index += 1) {
      const block = blob.slice(index * RECORDING_BLOCK_BYTES, (index + 1) * RECORDING_BLOCK_BYTES);
      if (!skipUploaded || !upload.uploadedBlocks.has(index)) {
        const response = await fetch(`/api/recordings/blocks?${new URLSearchParams({ ...take, index: String(index) })}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: block,
        });
        if (!response.ok) throw await failure(response, `Could not upload ${upload.trackType} audio`);
        await upload.onBlockUploaded?.(index);
      }
      uploadedBytes += block.size;
      upload.onProgress?.(uploadedBytes, blob.size);
    }
  };
  const commit = () => fetch('/api/recordings/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...take, startedAt: upload.startedAt, episode: upload.episode, blockCount, size: blob.size }),
  });

  // Before staging: the caller may add to uploadedBlocks as blocks succeed.
  const skippedAny = Array.from({ length: blockCount }, (_, index) => index).some(index => upload.uploadedBlocks.has(index));
  await stageBlocks(true);
  let response = await commit();
  if (!response.ok && response.status >= 500 && skippedAny) {
    await stageBlocks(false);
    response = await commit();
  }
  if (!response.ok) throw await failure(response, `Could not finish uploading ${upload.trackType} audio`);
}
