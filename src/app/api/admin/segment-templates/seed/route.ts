import { NextResponse } from 'next/server';

import { DEFAULT_SEGMENT_TEMPLATES } from '@/lib/catalog/templates';
import {
  BBPC_CLIENT_API_VERSION,
  recordingApi,
} from '@/lib/convex/api';
import {
  mutateSharedConvexAsUser,
} from '@/lib/convex/http';
import { getRequiredConvexToken } from '@/lib/convex/server';

export async function POST() {
  try {
    const token = await getRequiredConvexToken();
    if (token === null) {
      return NextResponse.json({ message: 'Sign in required' }, { status: 401 });
    }
    const result = await mutateSharedConvexAsUser(
      recordingApi.templates.upsertMany,
      {
        clientApiVersion: BBPC_CLIENT_API_VERSION,
        templates: DEFAULT_SEGMENT_TEMPLATES,
        updatedAt: Date.now(),
      },
      token,
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Recording Admin] Template seed failed:', error);
    return NextResponse.json(
      { message: 'Template seeding was not permitted or failed.' },
      { status: 409 },
    );
  }
}
