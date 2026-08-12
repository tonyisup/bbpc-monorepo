# bbpc-recording — Implementation Plan

## Goal

Build the Phase 1 session dashboard: shared sounder board, timestamped notes/edit cues/segments, manifest export, and Audacity label track export. The dashboard runs alongside Google Meet during recording. After recording, export a `session-manifest.json` (pipeline input) and a `.txt` label file (Audacity import).

## Architecture

| Layer | Choice |
|---|---|
| Frontend | Next.js + React + TypeScript (existing scaffold) |
| Realtime sync | Pusher (already in bbpc-admin) |
| Storage | Azure Blob (reuse existing) |
| Auth | bbpc-admin auth (reuse existing) |
| Deployment | Vercel or existing Next.js host |

## File Map

```
bbpc-recording/
  src/
    types/
      index.ts                  ← existing: Manifest, EditCue, Segment, etc.
    lib/
      export-labels.ts          ← NEW: manifest → Audacity label text + download helpers
      export-labels.test.ts     ← NEW: unit tests for label generation
    components/
      ExportBar.tsx             ← NEW: export buttons (manifest JSON + labels)
      (dashboard components)    ← TODO: sounder board, notes, edit cues, segments
  plan.md                       ← THIS FILE
```

## Phase 1: Export Logic (this session)

### Step 1 — `src/lib/export-labels.ts`

Pure functions, no UI:

- `manifestToAudacityLabels(manifest: Manifest): string` — converts manifest to Audacity label format
- `downloadManifest(manifest: Manifest): void` — browser download of `session-manifest.json`
- `downloadLabels(manifest: Manifest): void` — browser download of labels `.txt`
- `uploadToPipeline(manifest: Manifest): Promise<void>` — POST to pipeline endpoint (Phase 2)

Audacity label format: tab-separated `start_sec\tend_sec\tlabel`, one per line, no header.

Mapping:
- Segments → region labels (`{label}`)
- Edit cues → region labels (`{type}: {reason}`)
- Notes → point labels as 0.5s regions (`📝 {text}`)
- Sounders → point labels (`🔊 {name}`)

### Step 2 — `src/lib/export-labels.test.ts`

Unit tests covering:
- Empty manifest → empty string
- Segments with null end_ms → skipped
- Edit cues with null end_ms → skipped
- Notes → 0.5s point labels
- Sounders → zero-width labels
- Mixed manifest → correct ordering and formatting
- Tab separation and 6-decimal precision

### Step 3 — `src/components/ExportBar.tsx`

React component with two buttons:
- "Download Manifest" → calls `downloadManifest`
- "Download Labels" → calls `downloadLabels`

## Phase 2: Dashboard UI (next session)

- Shared sounder board (grid of pads, Pusher-triggered playback)
- Session notes input (text field, author, timestamp)
- Edit cue buttons (doxx-bleep, network-drop, dmca-music, spoiler, other)
- Segment markers (tap to start/end)
- Session timer (ms since recording_start)
- Export bar (Phase 1 output)

## Phase 3: Pipeline Handoff (after Phase 2)

- Azure blob upload of manifest JSON
- Pipeline manifest parser → automated bleep/cut via ffmpeg
- Trigger existing bbpc-pipeline

## Out of Scope

- DAW / waveform editor (Phase 2 of vision doc, not now)
- WebRTC recording (Google Meet stays)
- Replacing Audacity (labels import into existing workflow)

## Key Constraints

- Session-relative timestamps only (no clock sync)
- Dashboard does not touch audio path
- Mobile-friendly (hosts use phones alongside call)
- Works on Safari/Chrome, macOS + Windows
