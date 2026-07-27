import { NextResponse } from 'next/server';

import {
  BBPC_CLIENT_API_VERSION,
  recordingApi,
} from '@/lib/convex/api';
import {
  mutateSharedConvexAsUser,
} from '@/lib/convex/http';
import { getRequiredConvexToken } from '@/lib/convex/server';
import { discoverAzureSounders } from '@/lib/catalog/sounders';

export async function POST() {
  try {
    const token = await getRequiredConvexToken();
    if (token === null) {
      return NextResponse.json({ message: 'Sign in required' }, { status: 401 });
    }
    const sounders = await discoverAzureSounders();
    const result = await mutateSharedConvexAsUser(
      recordingApi.sounders.replaceAll,
      {
        clientApiVersion: BBPC_CLIENT_API_VERSION,
        sounders,
        updatedAt: Date.now(),
      },
      token,
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Recording Admin] Sounder refresh failed:', error);
    return NextResponse.json(
      { message: 'Sounder refresh was not permitted or failed.' },
      { status: 409 },
    );
  }
}
