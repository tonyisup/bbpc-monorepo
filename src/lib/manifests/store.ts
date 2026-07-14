import { fetchMutation, fetchQuery } from 'convex/nextjs';
import { api } from '../../../convex/_generated/api';
import type { Manifest } from '@/types';
import type { SessionAccessGrant } from '@/lib/sessions/types';

export async function saveManifest(manifest: Manifest, grant: SessionAccessGrant): Promise<string> {
  if (!manifest.session_id) {
    throw new Error('Manifest is missing session_id');
  }

  return await fetchMutation(api.manifests.save, {
    publicSessionId: manifest.session_id,
    clientId: grant.clientId,
    accessToken: grant.accessToken,
    episode: manifest.episode,
    date: manifest.date,
    hosts: manifest.hosts,
    manifestVersion: manifest.manifest_version,
    manifest,
    updatedAt: Date.now(),
  });
}

export async function getManifestForSession(
  sessionId: string,
  grant: SessionAccessGrant,
): Promise<Manifest | null> {
  const saved = await fetchQuery(api.manifests.getBySession, {
    publicSessionId: sessionId,
    clientId: grant.clientId,
    accessToken: grant.accessToken,
  });

  return saved?.manifest as Manifest | null;
}
