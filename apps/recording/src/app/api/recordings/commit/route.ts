import { NextResponse } from 'next/server';
import { BBPC_CLIENT_API_VERSION, recordingApi } from '@/lib/convex/api';
import { mutateSharedConvex } from '@/lib/convex/http';
import { recordingParticipantFor } from '@/lib/recordings/access';
import { getRecordingsContainer, recordingBlobName, recordingBlockId } from '@/lib/recordings/storage';
import { MAX_RECORDING_BLOCKS, MAX_RECORDING_BYTES, parseRecordingTakeInput } from '@/lib/recordings/upload';

/**
 * Joins a take's staged blocks into one blob, checks its size, and records
 * the upload. Committing the same take again gives the same result.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const take = body && parseRecordingTakeInput(body);
  const blockCount = body?.blockCount;
  const size = body?.size;
  const episode = typeof body?.episode === 'string' ? body.episode.trim().slice(0, 80) : '';
  if (
    !take
    || !episode
    || typeof blockCount !== 'number' || !Number.isSafeInteger(blockCount) || blockCount < 1 || blockCount > MAX_RECORDING_BLOCKS
    || typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1 || size > MAX_RECORDING_BYTES
  ) {
    return NextResponse.json({ message: 'Invalid recording commit' }, { status: 400 });
  }
  const access = await recordingParticipantFor(request, take.sessionId);
  if (!access) return NextResponse.json({ message: 'Session access denied' }, { status: 403 });
  const { grant, participant } = access;

  const blobName = recordingBlobName({ ...take, clientId: participant.clientId });
  let url: string;
  try {
    const blob = (await getRecordingsContainer()).getBlockBlobClient(blobName);
    await blob.commitBlockList(
      Array.from({ length: blockCount }, (_, index) => recordingBlockId(index)),
      {
        blobHTTPHeaders: { blobContentType: take.contentType },
        metadata: {
          sessionId: take.sessionId,
          clientId: participant.clientId,
          trackType: take.trackType,
          startedAt: String(take.startedAt),
        },
      },
    );
    const { contentLength } = await blob.getProperties();
    if (contentLength !== size) {
      return NextResponse.json({ message: `Uploaded ${contentLength ?? 0} of ${size} bytes` }, { status: 409 });
    }
    url = blob.url;
  } catch (error) {
    // A block that was never staged fails the commit; the client resumes.
    console.error('[Recording Upload] Commit failed:', error);
    return NextResponse.json({ message: 'Recording commit failed' }, { status: 502 });
  }

  try {
    const recordingId = await mutateSharedConvex(recordingApi.recordings.saveUpload, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      publicSessionId: take.sessionId,
      clientId: grant.clientId,
      accessToken: grant.accessToken,
      episode,
      hostName: participant.displayName,
      trackType: take.trackType,
      startedAt: take.startedAt,
      blobName,
      url,
      size,
      contentType: take.contentType,
      uploadedAt: Date.now(),
    });
    return NextResponse.json({ ok: true, recordingId, blobName, url, size });
  } catch (error) {
    console.error('[Recording Upload] Metadata save failed:', error);
    return NextResponse.json({ message: 'Recording metadata could not be saved' }, { status: 502 });
  }
}
