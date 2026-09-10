import type { NextApiRequest, NextApiResponse } from 'next';
import { BlobServiceClient } from '@azure/storage-blob';
import { readSessionGrantsFromRequest } from '@/lib/sessions/cookies';
import { getParticipantForGrant } from '@/lib/sessions/store';
import {
  BBPC_CLIENT_API_VERSION,
  recordingApi,
} from '@/lib/convex/api';
import { mutateSharedConvex } from '@/lib/convex/http';
import {
  MAX_RECORDING_BYTES,
  estimatedBase64Bytes,
  parseRecordingUploadInput,
  safeBlobSegment,
  recordingExtension,
} from '@/lib/recordings/upload';

const CONTAINER_NAME = process.env.AZURE_STORAGE_CONTAINER_NAME_RECORDINGS || 'recordings';
const CONN_STR = process.env.AZURE_STORAGE_ACCOUNT_CONNECTION_STRING;

function getBlobServiceClient() {
  if (!CONN_STR) throw new Error('AZURE_STORAGE_ACCOUNT_CONNECTION_STRING not set');
  return BlobServiceClient.fromConnectionString(CONN_STR);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const upload = parseRecordingUploadInput(req.body);
    if (!upload) {
      console.error('[Recording Upload] Missing fields:', {
        bodyType: typeof req.body,
        bodyKeys: Object.keys(req.body || {}),
      });
      return res.status(400).json({ message: 'Missing required fields' });
    }
    const { sessionId, episode, hostName, trackType, startedAt, audioBase64, contentType } = upload;

    if (estimatedBase64Bytes(audioBase64) > MAX_RECORDING_BYTES) {
      return res.status(413).json({ message: 'Recording exceeds 100 MB upload limit' });
    }

    const grant = readSessionGrantsFromRequest(req).find(candidate => candidate.sessionId === sessionId);
    const participant = await getParticipantForGrant(sessionId, grant);

    if (!participant || !grant) {
      return res.status(403).json({ message: 'Session access denied' });
    }

    if (audioBase64.length === 0) {
      console.log('[Recording Upload] Empty audio, skipping:', { episode, hostName, trackType });
      return res.status(200).json({ ok: true, skipped: true, reason: 'empty audio' });
    }

    const svc = getBlobServiceClient();
    const containerClient = svc.getContainerClient(CONTAINER_NAME);
    await containerClient.createIfNotExists({ access: 'blob' });

    const timestamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-');
    const authoritativeHostName = participant.displayName;
    const blobName = `${sessionId}/${timestamp}/${safeBlobSegment(authoritativeHostName)}-${participant.clientId}-${trackType}.${recordingExtension(contentType)}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    const audioBuffer = Buffer.from(audioBase64, 'base64');
    if (audioBuffer.length > MAX_RECORDING_BYTES) return res.status(413).json({ message: 'Recording exceeds 100 MB upload limit' });
    console.log('[Recording Upload] Uploading', {
      blobName,
      sizeBytes: audioBuffer.length,
      episode,
      hostName: authoritativeHostName,
      trackType,
    });

    await blockBlobClient.upload(audioBuffer, audioBuffer.length, {
      blobHTTPHeaders: { blobContentType: contentType },
      metadata: {
        episode,
        sessionId,
        hostName: authoritativeHostName,
        trackType,
        startedAt: String(startedAt),
      },
    });

    console.log('[Recording Upload] Success:', { blobName, size: audioBuffer.length });

    const recordingId = await mutateSharedConvex(recordingApi.recordings.saveUpload, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      publicSessionId: sessionId,
      clientId: grant.clientId,
      accessToken: grant.accessToken,
      episode,
      hostName: authoritativeHostName,
      trackType,
      startedAt,
      blobName,
      url: blockBlobClient.url,
      size: audioBuffer.length,
      contentType: contentType,
      uploadedAt: Date.now(),
    });

    res.status(200).json({
      ok: true,
      url: blockBlobClient.url,
      blobName,
      size: audioBuffer.length,
      recordingId,
    });
  } catch (err) {
    console.error('[Recording Upload] Error:', err);
    res.status(500).json({ message: 'Upload failed' });
  }
}

// Increase body size limit for audio uploads (default is 1mb)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '150mb',
    },
  },
};
