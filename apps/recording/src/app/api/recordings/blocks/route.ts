import { NextResponse } from 'next/server';
import { recordingParticipantFor } from '@/lib/recordings/access';
import { getRecordingsContainer, recordingBlobName, recordingBlockId } from '@/lib/recordings/storage';
import { MAX_RECORDING_BLOCKS, RECORDING_BLOCK_BYTES, parseRecordingTakeInput } from '@/lib/recordings/upload';

/**
 * Stages one block of a take's track. Each request stays under the hosting
 * body limit, and staging the same block again is harmless, so an interrupted
 * upload resumes from the blocks it has not confirmed.
 */
export async function PUT(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const take = parseRecordingTakeInput(params);
  const index = Number(params.index);
  if (!take || !Number.isSafeInteger(index) || index < 0 || index >= MAX_RECORDING_BLOCKS) {
    return NextResponse.json({ message: 'Invalid recording block' }, { status: 400 });
  }
  const access = await recordingParticipantFor(request, take.sessionId);
  if (!access) return NextResponse.json({ message: 'Session access denied' }, { status: 403 });

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength === 0 || body.byteLength > RECORDING_BLOCK_BYTES) {
    return NextResponse.json({ message: 'Recording blocks must contain 1 byte through 3 MiB' }, { status: 413 });
  }

  try {
    const blob = (await getRecordingsContainer()).getBlockBlobClient(
      recordingBlobName({ ...take, clientId: access.participant.clientId }),
    );
    await blob.stageBlock(recordingBlockId(index), body, body.byteLength);
    return NextResponse.json({ ok: true, index });
  } catch (error) {
    console.error('[Recording Upload] Block staging failed:', error);
    return NextResponse.json({ message: 'Block upload failed' }, { status: 502 });
  }
}
