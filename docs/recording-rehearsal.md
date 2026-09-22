# Recording rehearsal runbook

The last open item from the [September 21 recording audit](audits/recording-baseline-2026-09-21.md): prove a complete recording on the devices the show uses before trusting the app as the only copy of an episode. Automated tests cannot cover live Clerk, Convex, Azure, TURN, real microphones or iPhone WebKit; this rehearsal does.

Run it against staging, not production. Allow about 45 minutes with four people.

## Before the rehearsal

- Staging runs a build with #34, #35, #36 and this runbook's PR. Deploy the backend first, then the app.
- The recordings container is private (README, "Audio Privacy and Retention"), and TURN is configured (`TURN_URLS`, `TURN_STATIC_AUTH_SECRET`).
- The operator has `ffmpeg` and `ffprobe` installed, and a checkout to run the merge CLI.

| Seat | Device | Setup |
| --- | --- | --- |
| Host | Windows Chrome | Signed in to Clerk with a host account |
| Guest A | Windows Chrome | Set the system clock **20 seconds fast** (turn off automatic time) |
| Guest B | iPhone Chrome | Cellular data, not Wi-Fi |
| Guest C | Any Chrome | Opens the session with `?rtc=relay` appended, so its calls use TURN only |

Keep a written log with the wall time of each numbered step below.

## Script

1. **Create and invite.** Host creates a session, copies the invite, and opens it in the same browser. *Pass:* the host stays owner (Invite and Start Recording still shown).
2. **Join.** Guests open the invite and select Join Audio. *Pass:* everyone hears everyone; the iPhone plays audio at once, or after one press of "Tap to enable audio".
3. **Relay check.** On Guest C, open `chrome://webrtc-internals`. *Pass:* the selected candidate pair is `relay`.
4. **Start.** Host starts recording; guests select Join Recording. *Pass:* every header shows REC, and none shows "Not saved on this device".
5. **Count-off.** In turn, Host, A, B and C each say their seat name and the time on the host's timer. This is the alignment marker for the merge.
6. **Markers.** Host adds a note, starts a News segment, switches to the Sounders tab and back, triggers a sounder, then ends the segment. Guest A starts and ends a Spoiler edit cue. *Pass:* End controls survive the tab switch.
7. **Mic switch.** Guest A changes microphone in the header and keeps talking. *Pass:* REC stays, no error.
8. **Leave and rejoin audio.** Guest C selects Leave Audio, waits 20 s, rejoins, and keeps talking throughout. *Pass:* recording continues on Guest C.
9. **Backgrounding.** Guest B locks the iPhone for 30 s, unlocks, and returns to Chrome. Note whether REC, audio and the call recover.
10. **Pause.** Host stops recording, waits 60 s, and resumes. *Pass:* the header shows PAUSED at the stopped time and Resume Recording; after resuming, the timer continues from there. Guests rejoin the recording.
11. **Crash.** Guest A reloads the page mid-take. *Pass:* the page offers "Recovered audio from a recording that was interrupted"; Guest A uploads it and rejoins.
12. **Long take.** Talk normally for at least 20 minutes, with a second count-off (step 5) at the end.
13. **Stop and end.** Host stops recording. *Pass:* everyone sees "Audio uploaded". Host ends the session.
14. **Relay after end.** On any device, open `/api/sessions/<id>/rtc/ice`. *Pass:* 409, no credentials.

## After the rehearsal

1. Host downloads the merge bundle, then runs:

   ```bash
   pnpm --filter bbpc-recording run merge-session -- --bundle ./EP-merge-bundle.json --out ./rehearsal
   ```

2. **Warnings.** Audio disconnect warnings from steps 8, 9 and 11 are expected. There should be no "participant recording upload missing" or "fits no recording run" warning.
3. **Timing.** In `rehearsal/merge-plan.json`, compare each input's `audioDurationMs` with `maxDurationMs`. A take that covered its whole run should be within about 1 second of its window; a larger shortfall means lost audio or clock drift. Note the difference for the long take.
4. **Listen.** Import the merged file and `EP-labels.txt` into Audacity.
   - Both count-offs are in order with natural gaps and no overlap, including Guest A despite the 20 s clock error.
   - The pause leaves no dead air, and a "⏸ Paused" label sits at the resume point.
   - Notes, the News segment, the Spoiler cue and the sounder line up with what was said.
   - Guest A's voice continues across the mic switch and the reload (a short gap at the reload is expected); Guest C's across Leave Audio.
5. **Privacy.** Open one recording's URL from the bundle without its `?…` query. *Pass:* 403 or 404.

Keep the merge bundle private: its links grant access to the audio until they expire (24 hours by default).

## Recording results

For each step, write pass, fail or notes, and file an issue per failure with the step number, device, and the evidence: screenshots, `merge-plan.json`, and the timestamps in the merged audio. The app is ready to be the only copy of an episode when every step passes on these devices and the long-take timing difference is acceptable to whoever edits the show.
