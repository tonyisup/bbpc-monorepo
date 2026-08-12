import type { NextApiRequest, NextApiResponse } from 'next';
import { BlobServiceClient } from '@azure/storage-blob';

const CONTAINER_NAME = process.env.AZURE_STORAGE_CONTAINER_NAME_SOUNDERS || 'sounders';
const CONN_STR = process.env.AZURE_STORAGE_ACCOUNT_CONNECTION_STRING;

// ---------------------------------------------------------------------------
// GET /api/sounders/play?path=Intros/Base.mp3
// Streams a sounder blob from Azure, bypassing CORS
// ---------------------------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const blobPath = req.query.path as string;
  if (!blobPath) {
    return res.status(400).json({ message: 'Missing path' });
  }

  // Security: prevent path traversal
  if (blobPath.includes('..') || blobPath.startsWith('/')) {
    return res.status(400).json({ message: 'Invalid path' });
  }

  if (!CONN_STR) {
    return res.status(500).json({ message: 'Azure not configured' });
  }

  try {
    const svc = BlobServiceClient.fromConnectionString(CONN_STR);
    const containerClient = svc.getContainerClient(CONTAINER_NAME);
    const blobClient = containerClient.getBlobClient(blobPath);

    // Check blob exists
    const exists = await blobClient.exists();
    if (!exists) {
      return res.status(404).json({ message: 'Not found' });
    }

    // Get blob properties for headers
    const props = await blobClient.getProperties();

    // Set response headers
    res.setHeader('Content-Type', props.contentType || 'audio/mpeg');
    res.setHeader('Content-Length', props.contentLength || 0);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    // Handle range requests (for seeking / partial content)
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : (props.contentLength || 0) - 1;
      const chunkSize = end - start + 1;

      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${props.contentLength}`);
      res.setHeader('Content-Length', chunkSize);

      const stream = await blobClient.download(start, chunkSize);
      stream.readableStreamBody?.pipe(res);
    } else {
      const stream = await blobClient.download();
      stream.readableStreamBody?.pipe(res);
    }
  } catch (err) {
    console.error('[Sounders API] Play error:', err);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Playback failed' });
    }
  }
}
