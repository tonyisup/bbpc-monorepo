import type { NextApiRequest, NextApiResponse } from 'next';
import { recordingApi } from '@/lib/convex/api';
import { querySharedConvex } from '@/lib/convex/http';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    if (req.query.refresh === '1') {
      return res.status(409).json({
        message: 'Sounder refresh now requires the authenticated BBPC administrator workflow.',
      });
    }
    const sounders = await querySharedConvex(recordingApi.sounders.list, {});

    res.status(200).json({
      sounders,
      total: sounders.length,
      source: 'convex',
    });
  } catch (err) {
    console.error('[Sounders API] Error:', err);
    res.status(500).json({ message: 'Failed to list sounders' });
  }
}
