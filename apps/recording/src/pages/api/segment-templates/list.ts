import type { NextApiRequest, NextApiResponse } from 'next';
import { recordingApi } from '@/lib/convex/api';
import { querySharedConvex } from '@/lib/convex/http';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const segmentTemplates = await querySharedConvex(recordingApi.templates.list, {});
    res.status(200).json({ segmentTemplates });
  } catch (err) {
    console.error('[SegmentTemplates] Error:', err);
    res.status(500).json({ message: 'Failed to load segment templates' });
  }
}
