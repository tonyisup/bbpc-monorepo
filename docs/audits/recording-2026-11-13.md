# BBPC Recording follow-up audit — November 13, 2026

Follow-up to the [September 21 baseline](recording-baseline-2026-09-21.md), whose findings were all marked fixed on September 22. Audited at `9d4f0ca`: no recording changes since September 26. Scope: `apps/recording` and `packages/convex-backend/convex/recording`. Remediated on November 18, 2026 (see Remediation status).

## Baseline at audit time

| Check | Result |
| --- | --- |
| Recording app tests | 120 passed, 31 files |
| Shared recording backend tests | 41 passed, 5 files |
| Recording lint, TypeScript, production build | Pass |
| Production site | Serves `/api/time`, so the September fixes are deployed |
| Dependency advisories | **Fail**: Next.js 16.3.6 matched 10 advisories (2 critical, 2 high), all fixed in 16.4.1. The app uses no `next/image`, `use cache` or Server Actions, which the critical and high ones name. |
| Real-device rehearsal ([runbook](../recording-rehearsal.md)) | **No recorded result** |

The review read the capture, upload, sync, timeline, merge and server-boundary code, and executed the reducer, exporter and merge CLI (with ffmpeg) on synthetic data and the Azure SDK's blob-name handling with a fake key. Nothing ran in a real browser, on an iPhone, or against live Azure or Convex.

## Findings

| ID | Severity | Finding | Evidence |
| --- | --- | --- | --- |
| N01 | P1 | **Merged loudness changed between runs.** The merge CLI's `amix` normalised by the inputs still running, and a delayed input counts from the start, so identical runs differed by about 6 dB and reconstructed sounders pushed voices down further until they ended. | Executed with ffmpeg; `merge-session-bundle.mjs` |
| N02 | P1 | **A failed clock sync silently misplaced a take.** The offset starts at 0, Start did not wait for a sync, and a later successful sync shifted the take's markers away from its audio. A 3-second device error put a guest 3 seconds late. | Executed through the reducer and exporter; `clock.ts` |
| N03 | P1 | **The R06 fix was incomplete.** `saveUpload` checked only a prefix and a substring of the blob name. A name containing the caller's namespace plus `..` segments, which the Azure SDK collapses, signed to another session's blob. | Probed with a fake account key; `recordings.ts` |
| N04 | P2 | **Stop could fail to reach guests.** If a "recovered audio" offer finished loading after the host pressed Start, Stop threw before broadcasting, so guests kept recording. | Read; `DashboardHeader.tsx`, `useRecordingUpload.ts` |
| N05 | P2 | **Upload and event caps were reachable.** 100 upload rows per session meant four people hit the cap on the 13th Start, and later takes uploaded to Azure but never reached the bundle. At 2,000 events, the host's Stop was dropped as a permanent rejection; one guest could fill the log quickly. Event times were unbounded, so one guest event could make the merge build an impossible mix. | Read; executed the unbounded-time case with the CLI |
| N06 | P2 | **Admin cleanup usually deleted no audio on the first run.** Sessions with about 23 or more events used the whole first transaction's budget before reaching uploads, so the purge that followed found an empty queue. | Read; `cleanup/route.ts`, `sessions.ts` |
| N07 | P2 | **Invite links joined on any GET.** Each cookie-less visit (link unfurlers, crawlers) added a participant; 11 visits filled the 12 places permanently. The README called the invite "one-time". | Read; `join/[inviteToken]/route.ts` |
| N08 | P2 | **`/api/sounders/play` took any path and an unchecked Range header.** Repeated `path` parameters threw outside the handler's `try`, and `bytes=-500` or `bytes=abc` produced `NaN` ranges. | Read; `pages/api/sounders/play.ts` |
| N09 | P2 | Call audio does not recover after a network change or reload: no ICE restart, and a failed peer connection is never rebuilt. Local recording continues. | Reported, not verified |
| N10 | P2 | iOS backgrounding may leave a silent or short take while REC shows: nothing watches the audio context for suspension. | Reported; needs a real iPhone |
| N11 | P3 | Docs and dead code: `plan.md` and `vision.md` described a Google Meet companion; `manifest/upload` and its store had no caller; the README pointed at a separate Convex repository. | Read |

Smaller items not addressed here: renaming the episode while a guest's upload is pending strands that upload (it fails with CONFLICT on every retry); the merge CLI reuses a partially downloaded file without `--force`; active sessions never expire; there are no security headers; `/api/sounders/play` and the sounder and template lists need no sign-in.

## Product decision

The app is the show's call platform, not a companion to Google Meet. The companion scope documents and the `NEXT_PUBLIC_RTC_AUDIO_ENABLED=false` fallback are removed.

## Remediation status

As of November 18, 2026. Each fix has a test that fails on the audited code unless noted.

| Finding | Status |
| --- | --- |
| Next.js advisories | Fixed. Next.js 16.4.6; `pnpm audit --prod` reports only a low `fast-xml-parser` match for recording, held at 5.10.1 by the workspace override. |
| N01 | Fixed. The mix sums tracks at their recorded level (`normalize=0`), with the limiter catching overlapping peaks. The CLI test measures each run's level. |
| N02 | Fixed. Start Recording and Join Recording wait for a clock sync from the last 10 minutes, or a fresh one, and refuse with an error if the server cannot be reached. Concurrent syncs share one request. |
| N03 | Fixed. The upload route and the backend share `recordingTakeBlobName` from the contracts package, and `saveUpload` accepts only that exact name for the caller's take. Signing also refuses names with empty, `.` or `..` segments. |
| N04 | Fixed. Start and Join wait for the device check for earlier takes. If a take saved on the device and a new take still meet, whichever is saved on the device waits there and is offered again after the other uploads. Stop broadcasts even if retaining the take fails. The wait before Start has no dedicated test. |
| N05 | Fixed. Uploads: 200 rows per participant, 1,000 per session. Events: 800 per participant; the last 100 places in the 2,000-event log are reserved for the owner's Start and Stop; payloads are at most 4 KiB, and session-relative times must fall within 7 days. Note, cue and segment inputs have length limits. |
| N06 | Fixed. Deletion removes a session's uploads first, and cleanup keeps purging until no new audio has arrived for 2 seconds (at most 15). The deletion order has no dedicated test, and there is still no scheduled cleanup. |
| N07 | Fixed. Opening an invite shows a Join page; only its same-origin POST adds a participant. A browser that already joined still goes straight to the session. |
| N08 | Fixed. The path must be one catalog-shaped audio file name; Range parsing handles suffix ranges and answers 416 when unsatisfiable. The route still needs no sign-in, because the merge CLI downloads sounders from it. |
| N09, N10 | Open. Verify in the rehearsal before deciding on ICE restarts or audio-context handling. |
| N11 | Fixed. Companion docs and the RTC-off fallback removed; dead manifest route, store, cookie writer and microphone-permission helper removed; README and TURN docs corrected. |

A test that assumed no Web Locks API now removes it explicitly: since the Next.js upgrade the test environment can provide `navigator.locks`.

## Before relying on the app as the only copy of an episode

1. Deploy the backend to staging (the guarded staging workflow), then the app. Production backend deployment keeps its separate approval and runbook.
2. Run the [rehearsal](../recording-rehearsal.md) and commit its results. It is the only check of N09, N10, real-device permission and autoplay, TURN, and long-take drift.
3. Confirm the production recordings container is private (README, "Audio Privacy and Retention").
