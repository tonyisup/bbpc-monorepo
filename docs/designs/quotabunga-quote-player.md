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
discarded when the dialog closes. An entry that reloads or is restored from a
discarded tab never steps back over a history entry left by the earlier page load.

## Clip times

The start and end fields are the source of truth. Picking a video in the finder
suggests a 10-second range from the link's time; opening the finder on a saved clip
never invents an end. Switching to a different YouTube video resets the times, while
typing or editing a link, other hosts, and returning to the same video keep what the
listener entered. A first link with its own `t=` fills the start; a bare first link
keeps a start typed beforehand. Submitted YouTube clips are stored as
`watch?v=ID&t=<start>s`, so hosts land on the quote from admin, recording and the
listener view. A watch link cannot stop at the end, so the end is shown as text
beside the link; the recording panel also plays the marked range in place (see
"Admin clip marker and recording playback").

## Find a video

The search field suggests the entered source and quote, but only requests results
on Search or Enter. Results are compact rows with a thumbnail, title, and channel.
Use video fills the clip link and collapses the results so the player is visible;
Show search results restores the same results without another API call. Selecting
a different video resets old timing and transcript state while preserving the
listener's quote. The query is frozen while the finder is open, so using transcript
text as the quote doesn't rewrite the search. Search supports six results per page,
up to 24 before refinement.

The authenticated Next.js route calls YouTube Data API v3 using a server-only
`YOUTUBE_API_KEY`, sent in the `X-Goog-Api-Key` header so it never appears in URLs
that Next's fetch tracing or cache metadata record. It filters for embeddable and
syndicated videos, caches public provider results for five minutes, validates input
and responses, and hides upstream diagnostics.

Each search costs 100 of the key's default 10,000 daily quota units, so the route
first spends from a budget kept in Convex (`games.quotes.reserveVideoSearch`,
convex-helpers token buckets in the `rateLimits` table): a burst of 6 then 12 a day
per listener, and 45 then 50 a day across the site. A token bucket admits at most
capacity plus rate in any 24 hours, so the site stays under 100 searches however
Google's reset lines up. Both buckets are checked before either is spent. Over
budget returns 429 with `Retry-After` and a plain retry time; if the budget can't be
checked (for example an older backend), search fails closed as unavailable. Raise
the constants in `convex/games/limits.ts` if the key's quota is raised. Missing credentials, provider failures, and quota exhaustion
show the route's own reason rather than pretending there were no matches. Changing a
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
changing either clears the stale end. Explicit null clears it. The new web and
admin clients omit the argument when there is no end to set or clear, so they keep
writing through a backend that predates clip ranges. Host/admin screens display
(rounded to 0.1 s) and allow editing the saved end. Contract declarations were updated
locally and rebuilt without contacting a Convex deployment.

## Admin clip marker and recording playback

Before a recording, admins clean up clip times on the Quotabunga page. **Mark clips**
steps through the unscored YouTube entries in the current view, and an entry's
**Clip** button opens just that one. In the marker, S and E set the start and end at
the playhead, P plays the marked range, Enter saves and moves on, and J and K move
between clips. The arrow keys step 1 s (5 s with Shift), and comma and period step
0.2 s. Times can also be typed to the tenth of a second. The marker's Keyboard and
tips panel lists every shortcut.

A save sends the entry's other fields back unchanged through the administrator
`updateContent`, and rewrites the link to `watch?v=ID&t=<start>s` as the listener
form does. A clip the admin didn't touch is not saved. The marker re-reads the entry
first (`getAdminById`) and refuses if it changed since the marker opened, then shows
the latest version, keeping the admin's marks unless the entry moved to another
video. Closing, reloading, or going Back with unsaved marks asks first.

On `/record`, **Play clip** opens a player inside the entry that starts at the marked
start and pauses at the marked end however playback starts; **Replay** starts it
over. Only one clip is open at a time, so the page holds a single YouTube player.
Entries without a saved start open where their link does, and entries without an end
play on. Randomized entries keep their bracket order; the rest follow in an order
seeded by the episode, stable across refreshes, never submission order.

Listener names stay hidden on both pages until the round's points are awarded: on
entry cards, in the marker, in delete prompts, in the reuse breakdown, and in search,
which stops matching names. **Show names** reveals them for the round on screen only.

The IFrame API loader and link helpers (`parseYouTubeUrl`, `youtubeWatchUrl`,
`MAX_CLIP_SECONDS`) live in the shared `@bbpc/youtube` package, used by both the web
Quote Finder and the admin app. The admin player hook is
`apps/admin/src/lib/useYouTubePlayer.ts`. None of this needs a backend change beyond
the clip-range deploy described below.

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
- The listener, admin, and backend test suites and app/backend typechecks passed,
  including tests for the search budget, the fail-closed route, focus return,
  history cleanup, and the clip-time rules.

Deploy the additive backend schema/functions (the optional end, the `rateLimits`
table and `reserveVideoSearch`) before merging, then the admin and listener apps.
Until the backend is deployed, Quote Finder search is unavailable (it fails closed)
and fractional start times from the finder are refused; manual whole-second entries
still save. The old admin parser rejects fractional start times, so reload admin
tabs opened before the admin deploy. Production deployment still needs its separate
approval and runbook. YouTube preview boundaries are approximate,
not frame-accurate; an uploaded or otherwise authorized source would be needed
for a future exact export workflow.

References: [YouTube player API](https://developers.google.com/youtube/iframe_api_reference),
[caption download API](https://developers.google.com/youtube/v3/docs/captions/download).
Search reference: [YouTube search.list](https://developers.google.com/youtube/v3/docs/search/list).
