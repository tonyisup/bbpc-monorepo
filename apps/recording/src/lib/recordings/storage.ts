import 'server-only';

import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import { recordingExtension, safeBlobSegment } from './upload';

const CONTAINER_NAME = process.env.AZURE_STORAGE_CONTAINER_NAME_RECORDINGS || 'recordings';

let container: Promise<ContainerClient> | null = null;

export function getRecordingsContainer(): Promise<ContainerClient> {
  container ??= (async () => {
    const connectionString = process.env.AZURE_STORAGE_ACCOUNT_CONNECTION_STRING;
    if (!connectionString) throw new Error('AZURE_STORAGE_ACCOUNT_CONNECTION_STRING not set');
    const client = BlobServiceClient.fromConnectionString(connectionString).getContainerClient(CONTAINER_NAME);
    await client.createIfNotExists({ access: 'blob' });
    return client;
  })().catch(error => {
    container = null;
    throw error;
  });
  return container;
}

/**
 * Blob name for one track of one take. It depends only on values fixed for
 * the take, so every block and the commit agree even if the participant
 * renames mid-upload, and it sits in the participant's namespace, which the
 * backend requires.
 */
export function recordingBlobName(input: {
  sessionId: string;
  clientId: string;
  startedAt: number;
  trackType: 'mic' | 'sounders';
  contentType: string;
}): string {
  const timestamp = new Date(input.startedAt).toISOString().replace(/[:.]/g, '-');
  const extension = recordingExtension(input.contentType);
  if (!extension) throw new Error('Unsupported recording content type');
  return `${input.sessionId}/${timestamp}/take-${safeBlobSegment(input.clientId)}-${input.trackType}.${extension}`;
}

/** Azure block IDs must be base64 and the same length within a blob. */
export function recordingBlockId(index: number): string {
  return Buffer.from(`block-${String(index).padStart(6, '0')}`).toString('base64');
}
