# Quotabunga quote player

Date: 2026-09-25
Status: First implementation; local preview verified. Not deployed.

Listeners search YouTube or paste a link, select a time range under the embedded
player, preview or repeat that range, and submit the quote with its start and end
times from the existing submission form. The player uses the official YouTube IFrame
API. It does not download, edit, or export video files.

## Quote Finder overlay

The form keeps the simple clip link and start second fields (plus end second once
set). Use Quote Finder opens the search, player, timeline, and transcript tools in a
full-screen dialog so they get the whole viewport, including on phones. The dialog
edits the same form state, so the quote, source, and clip times are already in the
form when it closes; the form remains the only place an entry is submitted. While
open it adds a same-URL history entry, so the phone back gesture closes the finder
instead of leaving the episode. Done and Escape step back over that entry, and focus
returns to the Use Quote Finder button. Search results and transcript state are
discarded when the dialog closes.

## Find a video

The search field suggests the entered source and quote, but only requests results
on Search or Enter. Results are compact rows with a thumbnail, title, and channel.
Use video fills the clip link and collapses the results so the player is visible;
Show search results restores the same results without another API call. Selecting
a different video resets old timing and transcript state while preserving the
listener's quote. Search supports six results per page, up to 24 before refinement.

The authenticated Next.js route calls YouTube Data API v3 using a server-only
`YOUTUBE_API_KEY`, filtering for embeddable and syndicated videos. It caches public
provider results for five minutes, validates input and responses, and hides
upstream diagnostics. Missing credentials, provider failures, and quota exhaustion
show unavailable states rather than pretending there were no matches. Changing a
query aborts pending requests and suppresses stale results. YouTube's filters do
not guarantee that every video will play for every viewer; existing player error
handling remains necessary.

Configure the key in the web app's environment with YouTube Data API v3 enabled.
HTTP-referrer-restricted browser keys cannot authenticate this server-side flow.
Search behavior and route authentication are covered by tests, including selecting
a result from the submission form without submitting or overwriting its quote.

## Transcript lane

The initial version accepts SRT and WebVTT by local file or pasted text. It keeps
the supplied timing: ordinary subtitle cues appear as phrase blocks, and WebVTT
inline timestamps produce finer word blocks. It never guesses word timestamps.
Clicking a block seeks the video. Dragging across blocks, or using Enter followed
by Shift + Enter, selects a range. An explicit button copies the selected text
into the quote field, preserving manually entered text until that action.

The transcript is local editor state and is discarded when the editor closes.
Only the quote text, source URL, start, and end are saved. Import the exact clip's
subtitles again to resume transcript editing. Automatic transcript retrieval for
arbitrary YouTube URLs is not implemented; the official caption download API
requires permission to edit the source video.

## Range storage and compatibility

`quoteSubmissions.clipEndSeconds` is optional. Existing records read as a null end.
Both endpoints accept fractional seconds, with finite bounds from 0 to 86400.
An end requires a URL and a strictly earlier start. The client also checks the
known video duration. Member round locks, ownership, write gates, and scored-entry
restrictions remain enforced by the existing mutation wrappers.

Old clients that omit an end preserve it if the URL and start are unchanged;
changing either clears the stale end. Explicit null clears it. Host/admin screens
display and allow editing the saved end. Contract declarations were updated
locally and rebuilt without contacting a Convex deployment.

## Verification and rollout

- Backend tests cover persistence, invalid ranges, explicit clearing, and older
  clients editing an existing selection.
- UI tests cover transcript parsing, keyboard selection, explicit quote text
  replacement, preview stop/repeat, player cleanup, and embed failures.
- Local browser checks verified actual YouTube playback stopping at the selected
  end, handle dragging, keyboard transcript selection, and a 390px layout without
  horizontal overflow or console errors.
- Live YouTube search returned six results using the configured server-side key;
  selecting a result populated the player and preserved keyboard focus. Unavailable
  embedded videos showed the existing fallback message.
- The listener, admin, and backend test suites and app/backend typechecks passed.

Deploy the additive backend schema/functions, then the admin app, then the listener
app. The old backend rejects the new end-time argument, and the old admin parser
rejects fractional start times created by the updated listener. Production deployment still needs
its separate approval and runbook. YouTube preview boundaries are approximate,
not frame-accurate; an uploaded or otherwise authorized source would be needed
for a future exact export workflow.

References: [YouTube player API](https://developers.google.com/youtube/iframe_api_reference),
[caption download API](https://developers.google.com/youtube/v3/docs/captions/download).
Search reference: [YouTube search.list](https://developers.google.com/youtube/v3/docs/search/list).
