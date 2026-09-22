// @vitest-environment node
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildMergeWarnings, manifestToAudacityLabels, placeRecordingsOnTimeline } from './export-labels';
import { applySessionSyncEvents, createInitialState, sessionStateToManifest } from './session-state';
import type { RecordingUploadMetadata, SessionMergeBundle, SessionSyncEvent } from '@/types';

const CLI = path.resolve(__dirname, '../../scripts/merge-session-bundle.mjs');
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0
  && spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;

const host = { clientId: 'client_host', name: 'Host', role: 'owner' as const };
// Audit R04: two two-second takes starting at 1000 and 4000.
const events: SessionSyncEvent[] = [1_000, 4_000].flatMap((startedAt): SessionSyncEvent[] => [
  { kind: 'recording-started', startedAt, startedByRole: 'owner', participant: { ...host, joinedAt: startedAt } },
  { kind: 'recording-stopped', startedAt, durationMs: 2_000, stoppedByRole: 'owner', participant: { clientId: host.clientId, leftAt: startedAt + 2_000, reason: 'host-stopped' } },
]);

// Async, so the in-process HTTP server can answer the CLI's downloads.
function runCli(args: string[]): Promise<{ status: number | null; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CLI, ...args]);
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => resolve({ status, stderr }));
  });
}

let workDir: string;
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'merge-cli-'));
  for (const [name, frequency] of [['take-1', 440], ['take-2', 880]] as const) {
    const file = path.join(workDir, `${name}.wav`);
    if (hasFfmpeg) {
      execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=2`, file]);
    } else {
      await fs.writeFile(file, 'not audio; ffmpeg is unavailable');
    }
  }
  server = http.createServer(async (request, response) => {
    // Storage refuses a signed link after it expires.
    if (request.url?.includes('expired')) {
      response.statusCode = 403;
      response.end();
      return;
    }
    try {
      response.end(await fs.readFile(path.join(workDir, path.basename(request.url ?? ''))));
    } catch {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
  await fs.rm(workDir, { recursive: true, force: true });
});

async function writeBundle(urlFor = (index: number) => `${baseUrl}/take-${index + 1}.wav`): Promise<string> {
  const manifest = sessionStateToManifest(applySessionSyncEvents(createInitialState('EP-CLI', '2026-09-22', 'Host'), events), 'sess_cli');
  const recordings: RecordingUploadMetadata[] = [1_000, 4_000].map((startedAt, index) => ({
    id: `upload-${index + 1}`,
    publicSessionId: 'sess_cli',
    clientId: host.clientId,
    episode: 'EP-CLI',
    hostName: host.name,
    trackType: 'mic',
    startedAt,
    blobName: `sess_cli/${startedAt}/Host-${host.clientId}-mic.wav`,
    url: urlFor(index),
    size: 1,
    contentType: 'audio/wav',
    uploadedAt: startedAt + 2_000,
  }));
  const bundle: SessionMergeBundle = {
    bundle_version: '1.1',
    generated_at: '2026-09-22T00:00:00.000Z',
    session_id: 'sess_cli',
    episode: 'EP-CLI',
    manifest,
    labels: { format: 'audacity', filename: 'EP-CLI-labels.txt', text: manifestToAudacityLabels(manifest) },
    recordings: placeRecordingsOnTimeline(manifest, recordings),
    sounder_assets: [],
    merge_notes: buildMergeWarnings(manifest, recordings),
  };
  const bundlePath = path.join(workDir, 'EP-CLI-merge-bundle.json');
  await fs.writeFile(bundlePath, JSON.stringify(bundle));
  return bundlePath;
}

describe('merge-session CLI', () => {
  it('accepts the documented space-separated options and lays takes end to end', async () => {
    const bundlePath = await writeBundle();
    const outDir = path.join(workDir, 'dry-run');
    // pnpm forwards its `--` separator, as in the README's command.
    const result = await runCli(['--', '--bundle', bundlePath, '--out', outDir, '--sounders', 'none', '--dry-run']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    const plan = JSON.parse(await fs.readFile(path.join(outDir, 'merge-plan.json'), 'utf8'));
    expect(plan.inputs.map((input: { delayMs: number; maxDurationMs: number }) => [input.delayMs, input.maxDurationMs])).toEqual([[0, 2_000], [2_000, 2_000]]);
    expect(plan.ffmpeg.args).toContain('[0:a]atrim=duration=2.000,adelay=0:all=1,aresample=48000,asetpts=PTS-STARTPTS[a0];[1:a]atrim=duration=2.000,adelay=2000:all=1,aresample=48000,asetpts=PTS-STARTPTS[a1];[a0][a1]amix=inputs=2:duration=longest:dropout_transition=0,alimiter=limit=0.95[out]');
    expect(plan.warnings).toEqual([]);
  }, 15_000);

  it('explains an expired recording link without printing its signature', async () => {
    const bundlePath = await writeBundle(index => `${baseUrl}/expired-${index}.wav?sv=2024&sig=SECRET`);
    const result = await runCli(['--bundle', bundlePath, '--out', path.join(workDir, 'expired'), '--sounders', 'none', '--dry-run', '--force']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('download a new merge bundle');
    expect(result.stderr).not.toContain('SECRET');
  }, 15_000);

  it('rejects an option that is missing its value', async () => {
    const result = await runCli(['--bundle']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--bundle needs a value');
  }, 15_000);

  it.skipIf(!hasFfmpeg)('produces one four-second timeline from two two-second takes', async () => {
    const bundlePath = await writeBundle();
    const outDir = path.join(workDir, 'merged');
    const result = await runCli(['--bundle', bundlePath, '--out', outDir, '--sounders', 'none']);
    expect(result.status, result.stderr).toBe(0);

    const duration = Number(execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0',
      path.join(outDir, 'EP-CLI-merged.wav'),
    ], { encoding: 'utf8' }));
    expect(duration).toBeGreaterThan(3.95);
    expect(duration).toBeLessThan(4.1);
  }, 30_000);
});
