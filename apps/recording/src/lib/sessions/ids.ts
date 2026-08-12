import { randomBytes } from 'crypto';

function randomToken(byteLength: number): string {
  return randomBytes(byteLength).toString('base64url');
}

export function createSessionId(): string {
  return `sess_${randomToken(12)}`;
}

export function createInviteToken(): string {
  return `inv_${randomToken(24)}`;
}

export function createClientId(): string {
  return `client_${randomToken(12)}`;
}

export function createAccessToken(): string {
  return `access_${randomToken(24)}`;
}
