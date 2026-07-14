import type { NextApiRequest, NextApiResponse } from 'next';
import { BlobServiceClient } from '@azure/storage-blob';
import { fetchMutation, fetchQuery } from 'convex/nextjs';
import { api } from '../../../../convex/_generated/api';
import { sessionAdminSecret } from '@/lib/sessions/store';

const CONTAINER_NAME = process.env.AZURE_STORAGE_CONTAINER_NAME_SOUNDERS || 'sounders';
const CONN_STR = process.env.AZURE_STORAGE_ACCOUNT_CONNECTION_STRING;

interface SounderMetadata {
  id: string;
  blobName: string;
  name: string;
  category: string;
  url: string;
  duration: number;
  size: number;
  contentType: string;
}

function getBlobServiceClient() {
  if (!CONN_STR) throw new Error('AZURE_STORAGE_ACCOUNT_CONNECTION_STRING not set');
  return BlobServiceClient.fromConnectionString(CONN_STR);
}

function estimateDurationMs(sizeBytes: number, contentType: string): number {
  if (contentType?.includes('wav') || contentType?.includes('x-wav')) {
    return (sizeBytes / 176400) * 1000;
  }
  if (contentType?.includes('ogg')) {
    return (sizeBytes / 14000) * 1000;
  }
  return (sizeBytes / 16000) * 1000;
}

async function discoverAzureSounders(): Promise<SounderMetadata[]> {
  const blobServiceClient = getBlobServiceClient();
  const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
  const sounders: SounderMetadata[] = [];

  for await (const blob of containerClient.listBlobsFlat()) {
    const ct = blob.properties.contentType || '';
    const ext = blob.name.split('.').pop()?.toLowerCase() || '';
    const isAudio =
      ct.includes('audio') || ct.includes('mpeg') || ct.includes('wav') ||
      ct.includes('ogg') || ct.includes('mp4') || ct.includes('x-m4a') ||
      ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'wma'].includes(ext);

    if (!isAudio) continue;
    if (blob.name.startsWith('.') || blob.name.includes('/.')) continue;

    const parts = blob.name.split('/');
    const category = parts.length > 1 ? parts[0] : 'Uncategorized';
    const fileName = parts[parts.length - 1];
    const name = fileName
      .replace(/\.[^.]+$/, '')
      .replace(/[-_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    sounders.push({
      id: blob.name.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase(),
      blobName: blob.name,
      name,
      category,
      url: `/api/sounders/play?path=${encodeURIComponent(blob.name)}`,
      duration: Math.round(estimateDurationMs(blob.properties.contentLength || 0, ct)),
      size: blob.properties.contentLength || 0,
      contentType: ct,
    });
  }

  return sounders.sort((a, b) => {
    const catCmp = a.category.localeCompare(b.category);
    if (catCmp !== 0) return catCmp;
    return a.name.localeCompare(b.name);
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const refreshRequested = req.query.refresh === '1';
    if (refreshRequested && req.headers['x-admin-secret'] !== sessionAdminSecret()) {
      return res.status(403).json({ message: 'Administrative access required' });
    }
    const refresh = refreshRequested;
    let sounders = await fetchQuery(api.sounders.list, {});

    if (refresh || sounders.length === 0) {
      sounders = await discoverAzureSounders();
      await fetchMutation(api.sounders.replaceAll, {
        adminSecret: sessionAdminSecret(),
        sounders,
        updatedAt: Date.now(),
      });
    }

    res.status(200).json({
      sounders,
      total: sounders.length,
      source: refresh ? 'azure-refresh' : 'convex',
    });
  } catch (err) {
    console.error('[Sounders API] Error:', err);
    res.status(500).json({ message: 'Failed to list sounders' });
  }
}
