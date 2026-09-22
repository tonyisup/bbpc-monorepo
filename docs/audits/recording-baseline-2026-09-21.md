# BBPC Recording baseline audit — September 21, 2026

**Verdict: useful prototype with substantial reusable work; not ready to trust with an irreplaceable recording. Recommend targeted replacement of the recording/synchronization/timeline internals, preserving the shared backend and dashboard.**

Audited commit: `ce99b98`. Still current at `2b2c209` (September 22, 2026): no changes to `apps/recording` or `packages/convex-backend/convex/recording` in between. Scope: `apps/recording`, its shared Convex recording functions, recording tests, export CLI, relevant CI/configuration and prior remediation. This was a report-only audit. No application source, production rows, credentials or deployed services were changed.

## What the baseline establishes

| Check | Result |
| --- | --- |
| Recording app tests | **50 passed**, 13 files |
| Shared recording backend tests | **37 passed**, 5 files |
| Recording lint and TypeScript | **Pass** |
| Shared generated API build | **Pass** |
| Next.js production build | **Pass**, with synthetic public Clerk/Convex settings |
| Browser UI | Actual dashboard components exercised in Chromium with synthetic services; desktop and 390px mobile inspected |
| Browser recorder | Native MediaRecorder exercised with generated tones, no physical microphone |
| Export | Actual reducer, CLI, ffmpeg and ffprobe exercised with synthetic takes |
| Auth/storage boundaries | Isolated Convex mutation and actual join-route probes |
| Dependency advisories | **Fail**; recording's Next.js 16.2.10 has known advisory matches |
| Live end-to-end recording | **Not established** |

The checkout has no recording `.env.local`. The actual Next server returned 500 with: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and NEXT_PUBLIC_CONVEX_URL are required`. This is a missing local configuration, not a new application defect. The browser harness imported the actual dashboard, hooks, CSS and recording engine, replaced Convex/HTTP services with synthetic doubles, and used the actual backend identifier validator. It does **not** validate live Clerk, Convex subscriptions, Azure, TURN or deployed configuration.

Initial dependency installation, local serving and Turbopack needed sandbox escalation; they subsequently worked. Those initial sandbox errors are not counted as project defects.

## Why green tests are insufficient

The frontend synchronization tests mock mutations, while the backend tests supply manually invented valid IDs. Neither tests the actual browser-generated payload against its server boundary. The one mesh-hook test checks callback changes without establishing a peer connection. Recorder tests mock MediaRecorder and its stream lifecycle. Export tests cover individual label formatting but not a recording with multiple takes.

These gaps explain several confirmed failures below. Test count and compile success currently overstate recording readiness.

## Highest-priority findings

### R01 · P1 · Browser-generated IDs prevent all event sharing and audio signaling

**Confidence 10/10; executed real generators against real validator.**

[useSessionSync.ts:22](../../apps/recording/src/hooks/useSessionSync.ts#L22) returns `${sessionId}:${from ?? 'client'}:${Date.now()}:${randomPart}`. [mesh.ts:7](../../apps/recording/src/lib/rtc/mesh.ts#L7) similarly generates colon-delimited signal IDs. The backend [validator:33](../../packages/convex-backend/convex/recording/validators.ts#L33) accepts only `/^[A-Za-z0-9][A-Za-z0-9_-]*$/u`; [appendSessionEvent:681](../../packages/convex-backend/convex/recording/sessions.ts#L681) and [sendSignal:339](../../packages/convex-backend/convex/recording/rtc.ts#L339) enforce it.

Both generated examples returned `VALIDATION_FAILED`, `retryable:false`. Notes, sounder triggers and recording transport cannot reach other browsers; RTC offers/candidates cannot negotiate calls. The first invalid event stays at the front of the queue. In the UI harness, starting a segment immediately produced “Changes not saved” and disabled Start Recording.

**Repair:** use a shared portable ID contract and integration tests with actual generated inputs. Preserve backend validation.

### R02 · P1 · Separate participants can identify one another's events as their own

**Confidence 9/10; deterministic React SSR identity collision reproduced, complete two-browser deployment not exercised.**

[SessionProvider:106](../../apps/recording/src/components/SessionProvider.tsx#L106) constructs `sess-${reactId}` using React `useId` and skips matching `event.from`. [useRecordingSync:28](../../apps/recording/src/hooks/useRecordingSync.ts#L28) does the same with `rec-`. These are component-tree IDs, not globally unique participant instances. Two independent server renders returned the identical `sess-_R_0_`.

After R01 is fixed, identical rendered trees still risk suppressing remote notes/sounders and host stop commands. A same-tree reload can also suppress historical self-originated notes.

**Repair:** separate authenticated participant identity, unique browser-instance identity and event identity; replay saved history independently of live self-echo filtering.

### R03 · P1 · Switching microphone silently stops microphone capture while REC continues

**Confidence 10/10; reproduced twice in Chromium using native MediaRecorder.**

[useRecordingEngine:185](../../apps/recording/src/hooks/useRecordingEngine.ts#L185) records the borrowed mic stream directly. [useMeshAudioRoom:480](../../apps/recording/src/hooks/useMeshAudioRoom.ts#L480) stops its tracks when switching input, but only replaces the peer-connection track. The recorder is never connected to the replacement stream. Leaving audio also stops the borrowed stream at line 341. Header controls allow these actions during recording.

Observed after changing input:

```json
{"microphoneRecorder":"inactive","microphoneTrack":"ended","sounderRecorder":"recording","dashboard":"REC; timer advancing"}
```

The app handles neither an unexpected recorder stop nor recorder errors as a recording-state transition. A participant can keep talking into a working call with no continuing microphone recording.

**Repair:** give recording an explicit stream lifecycle, handle unexpected termination, and either switch capture safely or prevent input changes until the take is finalized.

Screenshot (not retained in the repository): `recorder-stopped-ui-rec.png`; see [Local evidence](#local-evidence).

### R04 · P1 · A second take corrupts the exported timeline

**Confidence 10/10; actual ffmpeg output checked with ffprobe.**

[session-state:245](../../apps/recording/src/lib/session-state.ts#L245) replaces `recordingStart` on each Start but preserves old notes, markers and intervals. The export includes every session upload. [merge CLI:116](../../apps/recording/scripts/merge-session-bundle.mjs#L116) aligns all files to the latest start and clamps negative delays to zero.

Two separate two-second tones, beginning at timestamps 1000 and 4000, produced:
- Manifest origin: 4000.
- Input delays: `[0,0]`.
- Final audio duration: **2 seconds**, with the takes mixed together.
- Both takes' labels at 0.5 seconds; no warning.

**Repair:** define take identity and per-take exports, or define a persistent session timeline with explicit pause semantics. Merely removing the clamp does not repair markers already stored relative to different origins.

### R05 · P1 · Testing your own invitation removes owner access from the browser

**Confidence 10/10; actual route executed with controlled cookie/store doubles.**

[Invite route:18](../../apps/recording/src/app/join/%5BinviteToken%5D/route.ts#L) calls `joinSessionByInviteToken` before reading the existing grants. The [store:89](../../apps/recording/src/lib/sessions/store.ts#L89) always generates a new participant. Route lines 31–35 replace the existing session grant with the new guest grant.

Opening the owner's own invite replaces the cookie holding their owner capability and invite token. Repeated guest visits also create extra participants against the 12-participant lifetime cap.

**Repair:** verify/reuse existing membership before issuing a new participant grant, with explicit recovery for an owner.

### R06 · P1 · A guest can replace another participant's recording URL

**Confidence 10/10; reproduced with convex-test.**

The public [saveUpload mutation:179](../../packages/convex-backend/convex/recording/recordings.ts#L179) checks only that an existing blob name belongs to the same session, then patches that recording row. It stores no authoritative participant ID for ownership. Session participants can enumerate blob names.

A synthetic guest supplied the owner's blob name and an arbitrary HTTPS URL using the guest's valid capability. The mutation returned the owner's existing recording ID and replaced its name and URL. This corrupts the merge bundle; it does not establish the ability to overwrite the actual Azure audio bytes.

**Repair:** bind recording metadata to authenticated participant/take identity and approved storage provenance; permit retries only for the appropriate owner or explicitly authorized administrator.

### R07 · P1 · Normal peer-disconnect events violate the server contract and jam later saves

**Confidence 10/10; source-traced client/server contradiction. This becomes reachable after R01 is repaired.**

[useMeshAudioRoom:237](../../apps/recording/src/hooks/useMeshAudioRoom.ts#L237) reports a disconnect using `clientId: remoteClientId`. [sessions:730](../../packages/convex-backend/convex/recording/sessions.ts#L730) permits disconnect events only for the authenticated caller. The event receives FORBIDDEN. [useSessionSync:134](../../apps/recording/src/hooks/useSessionSync.ts#L134) retains it at the front of the ordered queue, preventing subsequent notes and stop events from saving.

**Repair:** distinguish the observer from the disconnected subject within an authorized contract; surface permanently rejected events without endlessly blocking unrelated valid work. Do not relax the current identity check indiscriminately.

## Other confirmed product defects

| ID / severity | Finding and evidence | Direction |
| --- | --- | --- |
| R08 / P2 / 10⁄10 | Switching away from Segments/Edit Cues unmounts the panel ([DashboardApp:75](../../apps/recording/src/components/dashboard/DashboardApp.tsx#L75)); its local active ID is lost ([SegmentPanel:22](../../apps/recording/src/components/SegmentPanel.tsx#L22), [EditCuePanel:22](../../apps/recording/src/components/EditCuePanel.tsx#L22)). Browser reproduction leaves an open marker with no End control. | Derive open intervals from session state and permit closing them after remount/reconnect. |
| R09 / P2 / 10⁄10 | Stop leaves open markers unfinished. [SessionProvider:154](../../apps/recording/src/components/SessionProvider.tsx#L154) supplies `elapsedMs: 0` when stopped. Export omits null ends; closing afterward generates reversed ranges such as `0.500000\t0.000000\tNews`. Executed real reducer/exporter. | Finalize open markers at the stop boundary or provide explicit post-stop editing with validated ranges. |
| R10 / P2 / 10⁄10 | At 390px, the header extends to 849px; Start Recording begins at x=691. Body overflow is hidden. Reproduced in clean and error states. [Header:519](../../apps/recording/src/components/DashboardHeader.tsx#L519). | Make transport and recording status fit a narrow screen, with secondary controls in a separate area. |
| R11 / P2 / 10⁄10 | [README:58](../../apps/recording/README.md#L58) documents `--bundle path --out path`; [CLI:30](../../apps/recording/scripts/merge-session-bundle.mjs#L30) accepts only `--key=value`. Exact documented pnpm invocation exits 1: “--bundle is required.” | Support documented arguments and exercise the public command in an integration test. |
| R12 / P2 / 9⁄10 | [Cookie upsert:47](../../apps/recording/src/lib/sessions/cookies.ts#L47) accumulates grants indefinitely. Actual generated token lengths yielded 3,947 bytes for 16 owner grants and 4,192 for 17, beyond common 4,096-byte browser cookie limits. No browser rejection probe was run. | Bound cookie storage with a deliberate access-recovery design, preferably a small server-side session reference. |
| R13 / P2 / 10⁄10 | [Export completeness:111](../../apps/recording/src/lib/export-labels.ts#L111) and CLI match uploads by display name. Removing a second take still produces zero warnings because an earlier upload shares its name. Executed CLI reproduction. | Validate completeness by participant ID and take/recording interval, not display name. |

Screenshots (not retained in the repository): `segment-before-tab-switch.png`, `segment-after-tab-switch.png`, `cue-after-tab-switch.png`, `dashboard-mobile-clean.png`; see [Local evidence](#local-evidence).

## Architecture and operational readiness

These are established implementation limits or conditional deployment risks; they are not claims about observed production incidents.

| Priority | Limitation | Evidence and implication |
| --- | --- | --- |
| Before trusting primary capture | Audio is durable only after a completed upload/download | Recording chunks live in refs; [recoveries:23](../../apps/recording/src/hooks/useRecordingUpload.ts#L23) is an in-memory Map. A reload, browser crash or lost tab destroys unsaved audio. The September 10 remediation explicitly documents this limitation. A beforeunload warning is useful but is not durable recovery. |
| Before hosted recording | Whole-file base64 upload is unsuitable for the documented Vercel option | [Upload hook:37](../../apps/recording/src/hooks/useRecordingUpload.ts#L37) copies complete blobs to bytes, strings and JSON; the route's 150 MB body-parser setting cannot raise Vercel's 4.5 MB request limit. About 3.4 MB of binary already reaches that limit after base64, before JSON overhead. This is conditional on hosting; deployment was not inspected. [Vercel limits](https://vercel.com/docs/functions/limitations). |
| Before private use | Audio privacy and retention differ from session privacy | [Upload route:60](../../apps/recording/src/pages/api/recordings/upload.ts#L60) creates a container with `access: 'blob'` and returns unsigned URLs. [Cleanup:917](../../packages/convex-backend/convex/recording/sessions.ts#L917) removes metadata but does not delete Azure blobs. Existing container ACLs and external lifecycle policies were not inspected. |
| Before long remote sessions | Timeline assumes synchronized device clocks | Local `Date.now()` from each recorder is subtracted from the host origin. No offset calibration was found. With RTC disabled the timestamp is also set before asynchronous mic acquisition. Real-device skew, startup delay and long-session drift are unmeasured. |
| Before public exposure | Framework dependencies require security maintenance | Registry audit matches Next 16.2.10 to 11 advisory rows: 2 critical, 4 high, 5 moderate. These are version matches, not 11 demonstrated exploits. Scope-specific triage below. |
| P2 | Ended sessions can continue requesting TURN credentials | [ICE route:13](../../apps/recording/src/app/api/sessions/%5BsessionId%5D/rtc/ice/route.ts#L) checks participant membership but not active lifecycle; ended membership intentionally remains valid for export. RTC join/signaling do enforce active status. Scope ICE issuance to active sessions. |

For capture reliability, durable local chunks plus resumable storage uploads and an explicit finalization state should replace the single in-memory take followed by a whole-file request. The app should distinguish “capturing,” “saved locally,” “uploaded,” and “all participants complete.”

### Dependency triage

`pnpm audit --prod --json` found 18 advisory rows across the monorepo. Eleven include `apps__recording>next`; other application findings are outside this audit.

The two critical Next advisories are [Windows-hosted server RCE](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36) and [AVIF image optimization RCE](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4); both list 16.3.3 as patched. The Windows condition is about the **server**, not Windows participants. No `next/image` imports or custom image remote patterns were found in this app. Its configuration also does not set the single locale required by the [proxy-bypass advisory](https://github.com/vercel/next.js/security/advisories/GHSA-6gpp-xcg3-4w24). Do not infer exposed RCE from the scanner alone.

Upgrade to an appropriate patched supported Next release, review compatible Clerk/React versions, and re-run the app checks. Also revisit the root sharp override when addressing the workspace findings; a top-level override can keep an old transitive dependency installed after a framework update. No dependency versions were changed during this audit.

## What is worth keeping

- Shared Convex API package and independently deployable application boundary.
- Hashed capability tokens, owner/administrator checks and fail-closed write/target controls.
- Recipient-scoped RTC signaling, bounded queries and batched deletion that revokes access first.
- Pure session reducer and explicit typed manifest: good seams for repairing take semantics.
- Separate microphone and sounder tracks, plus inspectable ffmpeg plans.
- Recent upload retry/download recovery, MIME preservation and resource teardown fixes.
- Existing deterministic tests and root CI checks, extended with real contract and browser scenarios.

The September 5 audit identified earlier recording failures; the [September 10 remediation](slop-remediation-2026-09-10.md) repaired several of them. This baseline inspected the repaired implementation and does not count those fixed issues again. In-memory durability remains an explicitly known limitation.

The 799-line header and 697-line mesh hook mix several responsibilities. Their size alone is not the problem; microphone ownership, transport state, remote state and persistence can contradict one another, as R03 demonstrates.

## Repair versus restart

The [vision](../../apps/recording/vision.md) describes a Google Meet companion and explicitly defers per-host recording. The [current README](../../apps/recording/README.md) and RTC specification describe a different, larger product. Both scope documents remain in the project. Which experience should ship first is the main product decision.

| Intended first release | Recommended approach |
| --- | --- |
| Sounders, notes and edit markers alongside Meet/Audacity | Preserve dashboard/backend, repair synchronization and annotation/export behavior, and introduce a genuine companion mode. The existing RTC flag only hides room audio; it still records locally and is not a complete companion-mode implementation. |
| Reliable guest calls and per-person recordings | Preserve session/auth/catalog/backend infrastructure. Rework capture persistence, track lifecycle, client identities, event contracts and take/export semantics as one coherent subsystem. Then prove a complete recording on supported devices. |
| Entire application rewritten from zero | Not justified by this baseline. It would recreate already useful authorization, catalog integration, export formats and regression coverage while still requiring the same audio lifecycle design and hardware tests. |

Recommended order:

1. Repair actual client/server contracts and event identities (R01/R02/R07), invite reuse and recording metadata ownership (R05/R06). Update vulnerable dependencies.
2. Establish durable capture, explicit take identity, accurate recorder status and resumable upload/finalization (R03/R04 plus architecture limits).
3. Repair marker continuity, mobile transport, merge CLI, cookie bounds and completeness reporting (R08–R13).
4. Validate the complete target workflow before using it as the only copy of an episode.

## Remediation status

As of September 22, 2026. Each fix has a regression test that fails on the audited code.

| Finding | Status |
| --- | --- |
| R01 | Fixed. Browser event, signal and disconnect IDs use the shared `RECORDING_PORTABLE_ID_PATTERN` from the contracts package, which the backend validator also uses. |
| R02 | Fixed. Each mounted tab uses a random event source instead of `useId`. |
| R03 | Fixed. The mic recorder records the audio graph, so switching input or leaving call audio swaps its source instead of ending the take; an unplugged device falls back to the default microphone or shows an error. Where the audio context cannot run, input changes are locked until Stop. An unexpected recorder stop finalizes the take for recovery. Checked in Chromium with the synthetic-tone harness. |
| R04 | Fixed, as one session timeline with pauses (product decision). Manifest 1.2 records each Start/Stop run; paused time is excluded; bundle 1.1 gives each upload its timeline offset and run length, and the CLI places and trims by them. Two 2-second takes now merge to 4 seconds. |
| R05 | Fixed. The invite route resolves the invited session first and reuses a still-valid grant. |
| R06 | Fixed. Uploads record their participant; `saveUpload` refuses another participant's row or blob-name namespace. The recording URL host is still not verified. |
| R07 | Fixed. Observers may report a disconnect of another participant in the same session. The event queue also drops and counts permanently rejected events instead of blocking on them. |
| R08 | Fixed. The open segment or edit cue is derived from session state. |
| R09 | Fixed. Ranges cannot end before they start, markers made while paused sit at the pause point, and open markers export to the end of the timeline with a warning. |
| R10 | Fixed. The header wraps at narrow widths with transport controls first; at 390px nothing is off-screen. |
| R11 | Fixed. The CLI accepts `--option value`, and an integration test runs the documented command. |
| R12 | Fixed. The grants cookie evicts the oldest guest, then owner, grants to stay under 4 KB, and a signed-in owner can recover a lost grant from the session page. Recovery replaces the owner's token (one device per owner) and, for an active session, adds an invite link rather than revoking shared ones. |
| R13 | Fixed. Completeness is checked per participant and run by client ID. |
| Durable capture | Fixed. Each recorder chunk is written to IndexedDB as captured, with a Web Lock marking live takes; after a crash or reload the session offers the take for upload, download or discard. Checked in Chromium: a take interrupted by reload recovered 9 seconds of decodable audio and uploaded. |
| Whole-file upload limit | Fixed. Uploads go in 3 MiB blocks with a separate commit, resume from staged blocks, and never exceed the hosting body limit. The old base64 route is removed, and the per-recording cap is 1 GiB. |
| Next.js advisories | Fixed. Recording upgraded to Next.js 16.3.6; `pnpm audit --prod` reports no recording matches. |

Still open: audio privacy and retention, clock-skew calibration, TURN credentials for ended sessions, and the real-device rehearsal.

## Acceptance baseline for the next iteration

- Two independent browsers create/join one session and exchange real notes, sounders, start/stop and disconnect events through the actual backend.
- Owner can reopen their invite and retain owner access; repeated guest visits reuse membership.
- A guest cannot alter another participant's upload metadata.
- Microphone switch, Leave Audio, device unplug and recorder error never leave a false REC indication; finalized audio remains recoverable.
- Interrupted upload and browser reload recover captured chunks; a realistically long recording uploads without a whole-file function limit.
- Start/stop/start exports two deliberate takes or a correct continuous timeline, with missing intervals identified.
- Markers survive tab changes and recording stop; exported ranges are valid.
- Critical recording controls remain visible at 390px.
- Run the specified four-person rehearsal on real Windows Chrome and iPhone Chrome, including TURN-only connectivity, a disconnect/rejoin, mobile backgrounding and listening to the final merged output.

An overall numerical health score is intentionally not assigned: live auth/storage/relay paths and target hardware were not tested, and several fundamental workflow failures outweigh a cosmetic average. **Audit status: DONE_WITH_CONCERNS. Release readiness: blocked by confirmed defects.**

## Local evidence

The audit harness, screenshots, browser measurements, dependency results and command summary were written to the git-ignored `.gstack/qa-reports/recording-2026-09-21/` directory of the auditing checkout. The reproductions below were temporary files under `/tmp`. None of them is committed, and they may no longer exist:

- Generator/validator and SSR collision probe: `rtc-sync-contract-repro.cjs`
- Two-take ffmpeg reproduction: `export-repro.mjs`
- Export edge cases: `export-edge-repros.mjs`
- Cross-participant metadata overwrite probe: `audit.test.ts`
- Invite-route grant replacement probe: `join.test.ts`

These probes contain synthetic data only; they are not a committed regression suite. Repairs should land with equivalent committed tests. Durable lesson: test browser-generated recording contracts against the real backend, and assert native recorder state rather than trusting UI state or permissive media mocks.
