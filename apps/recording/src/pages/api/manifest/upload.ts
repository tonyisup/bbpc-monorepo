import type { NextApiRequest, NextApiResponse } from 'next';
import type { Manifest } from '@/types';
import { readSessionGrantsFromRequest } from '@/lib/sessions/cookies';
import { hasSessionAccess } from '@/lib/sessions/store';
import { saveManifest } from '@/lib/manifests/store';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const manifest = req.body as Manifest;

  if (!manifest?.session_id || !manifest.episode) {
    return res.status(400).json({ message: 'Missing manifest session_id or episode' });
  }

  const grants = readSessionGrantsFromRequest(req);
  const grant = grants.find(candidate => candidate.sessionId === manifest.session_id);
  const canAccess = await hasSessionAccess(manifest.session_id, grant);

  if (!canAccess) {
    return res.status(403).json({ message: 'Session access denied' });
  }

  try {
    const id = await saveManifest(manifest, grant!);
    res.status(200).json({
      ok: true,
      id,
      storage: 'convex',
    });
  } catch (err) {
    console.error('[Manifest] Save error:', err);
    res.status(500).json({ message: 'Manifest save failed' });
  }
}
