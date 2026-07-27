import 'server-only';

import { BlobServiceClient } from '@azure/storage-blob';

import type { SounderCatalogItem } from '@/lib/convex/api';

const CONTAINER_NAME =
  process.env.AZURE_STORAGE_CONTAINER_NAME_SOUNDERS || 'sounders';
const CONNECTION_STRING =
  process.env.AZURE_STORAGE_ACCOUNT_CONNECTION_STRING;

function getBlobServiceClient() {
  if (!CONNECTION_STRING) {
    throw new Error('AZURE_STORAGE_ACCOUNT_CONNECTION_STRING is not configured');
  }
  return BlobServiceClient.fromConnectionString(CONNECTION_STRING);
}

function estimateDurationMs(sizeBytes: number, contentType: string): number {
  if (contentType.includes('wav') || contentType.includes('x-wav')) {
    return (sizeBytes / 176400) * 1000;
  }
  if (contentType.includes('ogg')) {
    return (sizeBytes / 14000) * 1000;
  }
  return (sizeBytes / 16000) * 1000;
}

export async function discoverAzureSounders(): Promise<SounderCatalogItem[]> {
  const containerClient =
    getBlobServiceClient().getContainerClient(CONTAINER_NAME);
  const sounders: SounderCatalogItem[] = [];

  for await (const blob of containerClient.listBlobsFlat()) {
    const contentType = blob.properties.contentType || '';
    const extension = blob.name.split('.').pop()?.toLowerCase() || '';
    const isAudio =
      contentType.includes('audio')
      || contentType.includes('mpeg')
      || contentType.includes('wav')
      || contentType.includes('ogg')
      || contentType.includes('mp4')
      || contentType.includes('x-m4a')
      || ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'wma'].includes(extension);

    if (!isAudio || blob.name.startsWith('.') || blob.name.includes('/.')) {
      continue;
    }

    const parts = blob.name.split('/');
    const fileName = parts.at(-1) ?? blob.name;
    const size = blob.properties.contentLength || 0;
    sounders.push({
      id: blob.name.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase(),
      blobName: blob.name,
      name: fileName
        .replace(/\.[^.]+$/, '')
        .replace(/[-_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
      category: parts.length > 1 ? parts[0] : 'Uncategorized',
      url: `/api/sounders/play?path=${encodeURIComponent(blob.name)}`,
      duration: Math.round(estimateDurationMs(size, contentType)),
      size,
      contentType,
    });
  }

  return sounders.sort((left, right) => {
    const category = left.category.localeCompare(right.category);
    return category === 0 ? left.name.localeCompare(right.name) : category;
  });
}
