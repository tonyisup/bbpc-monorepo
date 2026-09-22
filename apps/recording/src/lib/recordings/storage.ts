import 'server-only';

import { BlobSASPermissions, BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import { recordingExtension, safeBlobSegment } from './upload';

const CONTAINER_NAME = process.env.AZURE_STORAGE_CONTAINER_NAME_RECORDINGS || 'recordings';

function recordingsContainerClient(): ContainerClient {
  const connectionString = process.env.AZURE_STORAGE_ACCOUNT_CONNECTION_STRING;
  if (!connectionString) throw new Error('AZURE_STORAGE_ACCOUNT_CONNECTION_STRING not set');
  return BlobServiceClient.fromConnectionString(connectionString).getContainerClient(CONTAINER_NAME);
}

let container: Promise<ContainerClient> | null = null;

/** The recordings container, created on first upload if it does not exist. */
export function getRecordingsContainer(): Promise<ContainerClient> {
  container ??= (async () => {
    const client = recordingsContainerClient();
    // No public access: audio is read through short-lived signed URLs given
    // only to session participants. An existing container keeps its current
    // access level until an operator changes it (see the README).
    await client.createIfNotExists();
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

const DEFAULT_URL_TTL_HOURS = 24;

function urlTtlMs(): number {
  const hours = Number(process.env.RECORDING_URL_TTL_HOURS ?? DEFAULT_URL_TTL_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? Math.min(hours, 7 * 24) : DEFAULT_URL_TTL_HOURS) * 60 * 60 * 1000;
}

/**
 * A read-only URL for one recording that expires (24 hours by default, set
 * with RECORDING_URL_TTL_HOURS). Signed locally with the account key.
 */
export async function signedRecordingUrl(blobName: string, now = Date.now()): Promise<{ url: string; expiresAt: number }> {
  const expiresAt = now + urlTtlMs();
  const url = await recordingsContainerClient().getBlobClient(blobName).generateSasUrl({
    permissions: BlobSASPermissions.parse('r'),
    startsOn: new Date(now - 5 * 60 * 1000),
    expiresOn: new Date(expiresAt),
  });
  return { url, expiresAt };
}

/** Deletes a recording's audio. A blob that is already gone counts as deleted. */
export async function deleteRecordingBlob(blobName: string): Promise<void> {
  await recordingsContainerClient().getBlobClient(blobName).deleteIfExists({ deleteSnapshots: 'include' });
}
