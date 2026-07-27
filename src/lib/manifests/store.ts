import {
  BBPC_CLIENT_API_VERSION,
  recordingApi,
} from '@/lib/convex/api';
import {
  mutateSharedConvex,
  querySharedConvex,
} from '@/lib/convex/http';
import type { Manifest } from '@/types';
import type { SessionAccessGrant } from '@/lib/sessions/types';

export async function saveManifest(manifest: Manifest, grant: SessionAccessGrant): Promise<string> {
  if (!manifest.session_id) {
    throw new Error('Manifest is missing session_id');
  }

  return await mutateSharedConvex(recordingApi.manifests.save, {
    clientApiVersion: BBPC_CLIENT_API_VERSION,
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
  const saved = await querySharedConvex(recordingApi.manifests.getBySession, {
    publicSessionId: sessionId,
    clientId: grant.clientId,
    accessToken: grant.accessToken,
  });

  return saved?.manifest as Manifest | null;
}
