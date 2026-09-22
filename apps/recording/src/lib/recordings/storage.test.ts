// @vitest-environment node
import { ContainerClient } from '@azure/storage-blob';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// A synthetic account key: signing is local and nothing reaches Azure.
const CONNECTION = `DefaultEndpointsProtocol=https;AccountName=bbpctest;AccountKey=${Buffer.from('synthetic-key-for-tests').toString('base64')};EndpointSuffix=core.windows.net`;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('AZURE_STORAGE_ACCOUNT_CONNECTION_STRING', CONNECTION);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('recording storage privacy', () => {
  it('gives out read-only links that expire after 24 hours', async () => {
    const { signedRecordingUrl } = await import('./storage');
    const now = Date.UTC(2026, 8, 22, 12);
    const { url, expiresAt } = await signedRecordingUrl('sess_1/take/take-client_a-mic.webm', now);
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://bbpctest.blob.core.windows.net/recordings/sess_1/take/take-client_a-mic.webm');
    expect(parsed.searchParams.get('sp')).toBe('r');
    expect(parsed.searchParams.get('sig')).toBeTruthy();
    expect(new Date(parsed.searchParams.get('se')!).getTime()).toBe(expiresAt);
    expect(expiresAt - now).toBe(24 * 60 * 60 * 1000);
  });

  it('caps the configured link lifetime at a week', async () => {
    vi.stubEnv('RECORDING_URL_TTL_HOURS', '10000');
    const { signedRecordingUrl } = await import('./storage');
    const { expiresAt } = await signedRecordingUrl('blob.webm', 0);
    expect(expiresAt).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('creates the container without public access', async () => {
    // Audit: the upload route created the container with public blob access.
    const create = vi.spyOn(ContainerClient.prototype, 'createIfNotExists').mockResolvedValue({ succeeded: true } as never);
    const { getRecordingsContainer } = await import('./storage');
    await getRecordingsContainer();
    expect(create).toHaveBeenCalledWith();
  });
});
