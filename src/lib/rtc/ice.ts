import crypto from 'node:crypto';

export interface IceConfigResponse {
  iceServers: RTCIceServer[];
  expiresAt: number;
}

export function parseIceUrls(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(url => url.trim())
    .filter(Boolean);
}

export function createTurnCredential({
  clientId,
  staticAuthSecret,
  ttlSeconds,
  nowMs = Date.now(),
}: {
  clientId: string;
  staticAuthSecret: string;
  ttlSeconds: number;
  nowMs?: number;
}) {
  const safeTtlSeconds = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : 3600;
  const expiresAtUnixSeconds = Math.floor(nowMs / 1000) + safeTtlSeconds;
  const username = `${expiresAtUnixSeconds}:${clientId}`;
  const credential = crypto
    .createHmac('sha1', staticAuthSecret)
    .update(username)
    .digest('base64');

  return {
    username,
    credential,
    expiresAt: expiresAtUnixSeconds * 1000,
  };
}

export function buildIceConfig({
  clientId,
  turnUrls,
  stunUrls,
  staticAuthSecret,
  ttlSeconds,
  nowMs = Date.now(),
}: {
  clientId: string;
  turnUrls: string[];
  stunUrls: string[];
  staticAuthSecret?: string;
  ttlSeconds: number;
  nowMs?: number;
}): IceConfigResponse {
  const iceServers: RTCIceServer[] = [];
  let expiresAt = nowMs + ttlSeconds * 1000;

  if (stunUrls.length > 0) {
    iceServers.push({ urls: stunUrls });
  }

  if (turnUrls.length > 0 && staticAuthSecret) {
    const turn = createTurnCredential({ clientId, staticAuthSecret, ttlSeconds, nowMs });
    expiresAt = turn.expiresAt;
    iceServers.push({
      urls: turnUrls,
      username: turn.username,
      credential: turn.credential,
    });
  }

  return { iceServers, expiresAt };
}
