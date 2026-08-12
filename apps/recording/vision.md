# bbpc-recording — Vision

## The Problem

We've been recording a podcast for over 10 years. Three remote hosts on Google Meet, stereo loopback mix into Audacity, live sounder board, Audacity label tracks for edit markers, compression → MP3 → metadata → SoundCloud + Azure → bbpc-pipeline. It works, but it's fragmented and slow.

The real bottleneck isn't recording quality — **it's coordination and annotation during the call**, plus the manual labor of translating live memories into Audacity label tracks afterward.

## The Vision

A **shared session dashboard** that runs alongside Google Meet (always-open tab). Not a call platform. Not replacing Audacity yet. Three things:

1. **Shared Sounder Board** — Everyone triggers sounders, not just one person. Grid of clickable pads, zero-delay playback, "now playing" indicators.
2. **Timestamped Session Notes + Edit Cues** — Click to flag, type a note → captured at session-relative timestamp. Live sync across all hosts. Edit cue types: doxx-bleep, network-drop, dmca-music, spoiler, other.
3. **Segment Markers / Chapters** — Tap to mark segment boundaries. Produces chapter markers automatically.

## The Output: Session Manifest

Every recording produces a `session-manifest.json` — structured data that:
- Phase 1: A local manifest viewer for post-processing (reference while editing in Audacity to jump to edit points)
- Phase 2+: Input for automated editing, bleep/cut operations, pipeline handoff

### Manifest Schema

```json
{
  "episode": "EP-2024-12",
  "date": "2024-12-01",
  "hosts": ["tony", "fonso", "harley"],
  "recording_start": 0,
  "recording_end": 7200000,
  "manifest_version": "1.0",
  "sounders_used": [
    { "id": "theme-intro", "name": "Theme Song Intro", "played_at_ms": 10000, "played_by": "tony" }
  ],
  "notes": [
    { "timestamp_ms": 5240, "text": "Bob's intro had feedback — note for edit", "author": "alice", "id": "note-1" }
  ],
  "segments": [
    { "id": "seg-1", "start_ms": 0, "end_ms": 120000, "type": "intro", "label": "Opening Theme (with sounder)" },
    { "id": "seg-2", "start_ms": 120000, "end_ms": 180000, "type": "segment", "label": "News" }
  ],
  "edit_cues": [
    { "id": "edit-1", "start_ms": 245000, "end_ms": 252000, "type": "doxx-bleep", "reason": "address drop", "author": "tony" }
  ]
}
```

## Design Principles

- **Session-relative time** — no clock-sync headaches. Start point is all you align.
- **Low risk to recording** — dashboard doesn't touch the audio path. Stereo mix → Audacity stays exactly as-is for Phase 1.
- **Real-time shared state** — all hosts see the same session, same notes, same sounder triggers.
- **Mobile-friendly** — hosts can use their phones alongside the call.
- **macOS + Windows** — web app. Works on Safari/Chrome.

## Architecture (Phase 1)

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | Next.js + React | Already in codebase (bbpc-admin), TypeScript |
| Realtime sync | Pusher | Already have Pusher setup from WebRTC PoC |
| Storage | Azure Blob | Reuse existing audio/sounder storage |
| Auth | bbpc-admin auth | Reuse existing user system |
| Deployment | Vercel or existing Next.js host | |

## Phases

### Phase 1: Session Dashboard + Manifest Viewer (MVP)
- Dashboard always open during recording alongside Google Meet
- Shared sounder board (multi-host trigger)
- Session notes + edit cues with session-relative timestamps
- Segment/chapter markers
- Local manifest export + viewer (for Audacity post-process)
- ~8-13 days part-time

### Phase 2: Post-Production Editor
- Waveform visualizer loading stereo Audacity recording
- Import session manifest → annotations layered on waveform
- One-click operations: bleep, cut, silence
- Compression presets for the show
- MP3 export + metadata tags
- Trigger bbpc-pipeline

### Phase 3: Per-Host Recording (Maybe)
- WebRTC PoC exists in bbpc-admin
- Only if stereo mix causes real quality problems
- This is the Zencastr problem — expensive

## Tech Decisions Made

- **Web app** — 2 macOS + 1 Windows, everyone already has a browser open during calls
- **Not a WebRTC call platform** — Google Meet stays, dashboard is a companion
- **Not a DAW** — waveform editor comes in Phase 2 only after Phase 1 is validated
- **Pusher for real-time sync** — already used in bbpc-admin

## Open Questions

- Sounder trigger permissions during recording (everyone or just Tony?)
- "Now Playing" sync delay between hosts (acceptable?)
- Manifest viewer: standalone tab in the app, or download + external tool?

---

*Started 2026-04-01. Author: Tony + JuiceBox bot.*
