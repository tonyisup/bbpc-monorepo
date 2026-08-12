import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const HELP = `
Usage:
  npm run merge-session -- --bundle ./EP-merge-bundle.json [options]

Options:
  --bundle=<path>       Required. Merge bundle JSON downloaded from the app.
  --out=<dir>           Output workspace directory. Defaults to ./merged/<session_id>.
  --format=<wav|mp3>    Final output format. Defaults to wav.
  --sounders=<mode>     auto, recorded, reconstruct, both, or none. Defaults to auto.
  --dry-run             Download/write files and merge plan, but do not run ffmpeg.
  --force               Re-download existing assets and overwrite output.
  --help                Show this help.

Sounder modes:
  auto          Use recorded sounder tracks if present; otherwise reconstruct from sounder assets.
  recorded      Use uploaded sounder recordings only.
  reconstruct   Rebuild sounders from manifest.sounders_used and sounder_assets.
  both          Include uploaded sounder recordings and reconstructed sounder assets.
  none          Mix only participant mic tracks.
`;

function parseArgs(argv) {
  const args = new Map();
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') args.set('help', 'true');
    else if (arg === '--dry-run') args.set('dry-run', 'true');
    else if (arg === '--force') args.set('force', 'true');
    else if (arg.startsWith('--')) {
      const [key, ...rest] = arg.slice(2).split('=');
      args.set(key, rest.join('='));
    }
  }
  return args;
}

function requireString(value, message) {
  if (!value) throw new Error(message);
  return value;
}

function safeName(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'asset';
}

function extFromContentType(contentType) {
  if (contentType?.includes('mpeg')) return '.mp3';
  if (contentType?.includes('wav')) return '.wav';
  if (contentType?.includes('ogg')) return '.ogg';
  if (contentType?.includes('mp4')) return '.m4a';
  if (contentType?.includes('webm')) return '.webm';
  return '';
}

function extFromUrl(url, fallbackContentType) {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname);
    if (ext) return ext;
  } catch {
    // Relative or malformed URLs fall back to content type.
  }
  return extFromContentType(fallbackContentType) || '.bin';
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function downloadFile(url, targetPath, { force }) {
  if (!force && await exists(targetPath)) {
    return { path: targetPath, downloaded: false };
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed ${response.status} for ${url}`);
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(targetPath));
  return { path: targetPath, downloaded: true };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function resolveSounderMode(mode, recordings) {
  if (!['auto', 'recorded', 'reconstruct', 'both', 'none'].includes(mode)) {
    throw new Error('--sounders must be one of: auto, recorded, reconstruct, both, none');
  }

  if (mode !== 'auto') return mode;
  return recordings.some(recording => recording.trackType === 'sounders') ? 'recorded' : 'reconstruct';
}

function recordingDelayMs(bundle, recording) {
  const start = bundle.manifest.recording_start;
  if (typeof start !== 'number') return 0;
  return Math.max(0, Math.round(recording.startedAt - start));
}

function buildMergeWarnings(bundle) {
  const manifest = bundle.manifest ?? {};
  const recordings = bundle.recordings ?? [];
  const warnings = [...(bundle.merge_notes ?? []).filter(note => String(note).startsWith('Warning:'))];
  const micRecordingNames = new Set(
    recordings
      .filter(recording => recording.trackType === 'mic')
      .map(recording => recording.hostName),
  );
  const recordingParticipantIds = new Set((manifest.recording_participants ?? []).map(participant => participant.client_id));

  for (const participant of manifest.recording_participants ?? []) {
    if (!micRecordingNames.has(participant.name)) {
      warnings.push(`Warning: participant recording upload missing for ${participant.name}.`);
    }
  }

  for (const audioParticipant of manifest.audio_participants ?? []) {
    if (!recordingParticipantIds.has(audioParticipant.client_id)) {
      warnings.push(`Warning: ${audioParticipant.name} joined audio but was not recording.`);
    }
    if ((audioParticipant.disconnects ?? []).length > 0) {
      warnings.push(`Warning: ${audioParticipant.name} had ${audioParticipant.disconnects.length} audio disconnect interval(s).`);
    }
  }

  return Array.from(new Set(warnings));
}

function buildFfmpegArgs({ inputs, outputPath, format }) {
  const args = ['-y'];
  const filterParts = [];
  const labels = [];

  for (const [index, input] of inputs.entries()) {
    args.push('-i', input.path);
    const label = `a${index}`;
    const delay = Math.max(0, Math.round(input.delayMs));
    filterParts.push(`[${index}:a]adelay=${delay}:all=1,aresample=48000,asetpts=PTS-STARTPTS[${label}]`);
    labels.push(`[${label}]`);
  }

  filterParts.push(`${labels.join('')}amix=inputs=${labels.length}:duration=longest:dropout_transition=0,alimiter=limit=0.95[out]`);

  args.push('-filter_complex', filterParts.join(';'));
  args.push('-map', '[out]', '-ac', '2', '-ar', '48000');

  if (format === 'mp3') {
    args.push('-codec:a', 'libmp3lame', '-b:a', '192k');
  }

  args.push(outputPath);
  return args;
}

async function runFfmpeg(args) {
  const ffmpeg = spawn('ffmpeg', args, { stdio: 'inherit' });
  const exitCode = await new Promise(resolve => ffmpeg.on('close', resolve));
  if (exitCode !== 0) throw new Error(`ffmpeg exited with code ${exitCode}`);
}

const args = parseArgs(process.argv.slice(2));
if (args.has('help')) {
  console.log(HELP.trim());
  process.exit(0);
}

const bundlePath = requireString(args.get('bundle'), '--bundle is required');
const bundle = JSON.parse(await fs.readFile(bundlePath, 'utf8'));
const sessionId = requireString(bundle.session_id, 'Bundle is missing session_id');
const format = args.get('format') ?? 'wav';
if (!['wav', 'mp3'].includes(format)) throw new Error('--format must be wav or mp3');

const force = args.has('force');
const dryRun = args.has('dry-run');
const outDir = path.resolve(args.get('out') ?? path.join('merged', safeName(sessionId)));
const recordingsDir = path.join(outDir, 'recordings');
const soundersDir = path.join(outDir, 'sounders');
const outputPath = path.join(outDir, `${safeName(bundle.episode ?? sessionId)}-merged.${format}`);

await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, 'bundle.json'), JSON.stringify(bundle, null, 2));
await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(bundle.manifest, null, 2));
await fs.writeFile(path.join(outDir, bundle.labels?.filename ?? 'labels.txt'), bundle.labels?.text ?? '');

const sounderMode = resolveSounderMode(args.get('sounders') ?? 'auto', bundle.recordings ?? []);
const shouldUseRecordedSounders = sounderMode === 'recorded' || sounderMode === 'both';
const shouldReconstructSounders = sounderMode === 'reconstruct' || sounderMode === 'both';

const mixInputs = [];
const downloadedRecordings = [];
const downloadedSounders = [];

for (const recording of bundle.recordings ?? []) {
  if (recording.trackType === 'sounders' && !shouldUseRecordedSounders) continue;
  if (recording.trackType !== 'sounders' && recording.trackType !== 'mic') continue;

  const extension = extFromUrl(recording.url, recording.contentType);
  const filename = `${safeName(recording.hostName)}-${recording.trackType}-${recording.startedAt}${extension}`;
  const targetPath = path.join(recordingsDir, filename);
  const result = await downloadFile(recording.url, targetPath, { force });
  downloadedRecordings.push({ ...recording, localPath: result.path, downloaded: result.downloaded });
  mixInputs.push({
    kind: 'recording',
    id: recording.id,
    path: result.path,
    delayMs: recordingDelayMs(bundle, recording),
  });
}

if (shouldReconstructSounders) {
  const assetsById = new Map((bundle.sounder_assets ?? []).map(asset => [asset.id, asset]));

  for (const [index, used] of (bundle.manifest.sounders_used ?? []).entries()) {
    const asset = assetsById.get(used.id);
    if (!asset) {
      console.warn(`[merge] Missing sounder asset for ${used.id} (${used.name})`);
      continue;
    }

    const extension = extFromUrl(asset.downloadUrl, asset.contentType);
    const filename = `${String(index).padStart(4, '0')}-${safeName(asset.id)}${extension}`;
    const targetPath = path.join(soundersDir, filename);
    const result = await downloadFile(asset.downloadUrl, targetPath, { force });
    downloadedSounders.push({ ...asset, localPath: result.path, downloaded: result.downloaded });
    mixInputs.push({
      kind: 'sounder',
      id: used.id,
      path: result.path,
      delayMs: used.played_at_ms,
    });
  }
}

if (mixInputs.length === 0) {
  throw new Error('No audio inputs found. Check bundle.recordings, sounder_assets, and --sounders mode.');
}

const ffmpegArgs = buildFfmpegArgs({ inputs: mixInputs, outputPath, format });
const warnings = buildMergeWarnings(bundle);
const mergePlan = {
  session_id: sessionId,
  episode: bundle.episode,
  output: outputPath,
  format,
  sounderMode,
  inputs: mixInputs,
  downloadedRecordings,
  downloadedSounders,
  warnings,
  ffmpeg: {
    command: 'ffmpeg',
    args: ffmpegArgs,
  },
};

await fs.writeFile(path.join(outDir, 'merge-plan.json'), JSON.stringify(mergePlan, null, 2));
await fs.writeFile(
  path.join(outDir, 'merge.sh'),
  `#!/usr/bin/env bash\nset -euo pipefail\nffmpeg ${ffmpegArgs.map(shellQuote).join(' ')}\n`,
  { mode: 0o755 },
);

if (dryRun) {
  console.log(`Prepared merge workspace: ${outDir}`);
  console.log(`Dry run: ${path.join(outDir, 'merge.sh')}`);
  for (const warning of warnings) console.warn(`[merge] ${warning}`);
  process.exit(0);
}

const ffmpegCheck = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
if (ffmpegCheck.status !== 0) {
  throw new Error(`ffmpeg is not available. Install ffmpeg or run the generated script later: ${path.join(outDir, 'merge.sh')}`);
}

await runFfmpeg(ffmpegArgs);
for (const warning of warnings) console.warn(`[merge] ${warning}`);
console.log(`Merged audio written to ${outputPath}`);
