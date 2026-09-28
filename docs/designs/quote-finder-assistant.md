# Quote Finder assistant

Date: 2026-09-26
Status: Proposal. Gemini approved as the provider (2026-09-26). The spike passed on
2026-09-28 (88% of starts within 2 s; see "Spike results"). The spend limit is settled
at $5 a month, and no decisions are open.

Listeners already type the quote and the movie or show before opening the Quote
Finder. Today they then search YouTube, pick a video, scrub to the line, and drag the
start and end handles. Subtitles would make the last step precise, but listeners
rarely have an SRT or WebVTT file for the exact clip. The assistant does the search,
pick, and scrub: one action proposes a video, a start and end, and the line as
actually spoken. The listener previews it, nudges the handles if needed, and submits
with the existing form.

## What decides the design

Isolating a line needs timed text or something that can hear the video. The options:

- **Official captions.** The YouTube caption download API needs permission to edit
  the video (see the quote player design). Not available.
- **Scraping YouTube's caption endpoint.** Requests from cloud IPs (Vercel runs on
  AWS) are blocked or return empty without a per-video token. The workarounds are
  rotating residential proxies or a third-party transcript API that does the scraping.
  Both are fragile and outside YouTube's terms. Rejected.
- **Downloading audio to transcribe.** Contradicts the finder's rule that it never
  downloads video. Rejected.
- **A text-only model (Claude, GPT).** Good at recovering exact wording, writing a
  better search query, and picking the likely result. None of them accepts video or
  audio input, so none can say where a line is in a video. Useful later, but it can't
  do the core step.
- **Gemini video understanding.** The Gemini API accepts a public YouTube URL as
  video input. Google fetches the video, so nothing is downloaded on our side. It
  processes the audio and one frame per second, and it answers in MM:SS timestamps.
  This is the only option found that works on arbitrary public videos within the
  provider's terms.

Recommendation: use Gemini for the locate step and keep everything else as it is.

## Flow

1. The finder shows **Find it for me** once the form has a quote and a source.
   It never runs on its own, so every call is a deliberate spend.
2. The client runs the existing search (`/api/youtube/search`, existing budget) with
   the suggested query. If the finder already holds results for that query, it reuses
   them instead of spending another search.
3. The client posts the quote, source, and up to six result IDs to a new
   authenticated route, `/api/quote-finder/locate`. The route:
   - reserves one assistant run from a new Convex budget (per listener and
     site-wide token buckets, both checked before either is spent, as
     `reserveVideoSearch` does);
   - calls `videos.list` once (1 quota unit for all IDs) for durations and
     descriptions. It drops videos over 3 minutes (full films, compilations, and
     the costliest scene uploads; see the budget) and picks the best remaining
     candidate by rank and duration;
   - asks Gemini, with JSON-schema output, whether the line is spoken in that video.
     The answer is `found`, `startSeconds`, `endSeconds`, `spokenText`, and
     `confidence`;
   - validates the answer. Times are finite and `0 <= start < end <= duration`,
     spans are at most 60 s, and the spoken text fits `MAX_QUOTE_TEXT_LENGTH`. A
     loose text similarity between `spokenText` and the listener's quote gates a
     confident result; below it, the result is shown as a possible match;
   - pads the range (about -0.5 s / +0.75 s, clamped to the video) and returns the
     video, range, spoken text, and confidence. If nothing is found, it returns
     "not found" with the remaining candidates.
4. The finder loads that video in `QuoteClipEditor` with the suggested range in place
   of today's 10-second default seed. It shows the heard line with three actions:
   - **Use exact wording** replaces the quote. It is explicit, like the transcript
     lane, so the listener's own text is kept until they choose.
   - **Not it, try the next video** spends one more run on the next candidate.
   - The manual search and paste tools stay available.
   Nothing is submitted. The form's Submit button remains the confirmation.

Each run checks one video, so a click has a known cost. Trying two videos in parallel
would halve the wait on misses but double the spend on every hit.

## Accuracy and failure handling

- Timestamps are approximate: frames are sampled at 1 fps and the model estimates
  the times. The quote player already treats YouTube boundaries as approximate. The
  padding, preview/repeat, and handles cover the gap.
- The model can claim a line that isn't there, or place it several seconds off. In
  the spike, neither the confidence label nor the spoken-text match separated these
  misses from hits, so the listener's own preview is the check that matters. Present
  every range as a suggestion to play before submitting.
- Trailers, reaction videos, and fan edits are the likely wrong picks. The duration
  filter helps, and **Not it** moves on.
- Paraphrased or misremembered quotes are the common case. The spoken text shows
  the real wording.
- Scene descriptions ("the diner shootout") may work, because the model also sees
  frames, but they get no quality bar in v1.
- Age-restricted or otherwise unreadable videos come back as not found for that
  candidate.
- Provider errors never reach the client (same rule as the search route). A missing
  key or budget hides or disables the button with the route's reason.

## Cost, budget, and latency

- Video input costs about 90 tokens per second of clip at low media resolution,
  audio included (the API reports it all as video). The spike's clips averaged about
  a minute: 5,600 input and 440 output and thinking tokens, or $0.006 per run at
  `gemini-3.8-flash`'s introductory $0.75 / $3.75 per 1M tokens. Prices double on
  2027-01-01, to about $0.012 per run.
- Video length, not the number of runs, decides the bill. At 2027 prices a run costs
  about $0.004 plus $0.00014 per second of video: about $0.03 for a 3-minute video
  and $0.09 for a 10-minute one. The spike's clips were chosen by listeners (median
  31 s, 3 of 34 over 3 minutes). The search results the assistant picks from are
  often longer, full-scene uploads, which the spike didn't measure.
- Budget: at most $5 a month. Three limits keep it there:
  - The prepaid balance on the Google project is the hard stop. Keep auto-reload
    off, so Google can't charge past what is loaded. When the balance is empty,
    every request fails with HTTP 402 and the route shows the assistant as out of
    budget until it is topped up.
  - The route skips videos over 3 minutes, so a typical run costs at most about
    $0.03.
  - Token buckets in `convex/games/limits.ts`, shaped like the video search ones.
    Site-wide: 30 burst plus 4 a day, at most about 150 runs in 30 days. That is
    about $4.50 if every video ran the full 3 minutes and about $1.80 at the spike's
    lengths. Per listener: 10 burst plus 2 a day, which allows one 10-run session
    and then about one every five days, so no single player can use up the month.

  Each assistant session also spends normal video searches. The existing buckets
  still cap those, and they cost YouTube quota, not money.
- Use a paid key. The free tier caps YouTube input at 8 hours a day, and free-tier
  prompts may be used to improve Google's products.
- The spike measured a median of 3.5 s per run and a 90th percentile of 10 s, but
  one of 34 requests took 40 s and one timed out at 120 s. Show progress, let the
  listener cancel (abort the request, as search does), cap the request well below
  the route's `maxDuration`, and treat a timeout as "not found, try again".
- Optional: cache results in Convex by video ID and normalized quote, so reopening
  the finder or a repeat quote doesn't pay twice.

## Configuration and rollout

- Add an optional server-only `GEMINI_API_KEY` to `apps/web` (`env.mjs`,
  `.env.example`), sent as a header, never `NEXT_PUBLIC_`. When it is absent the
  assistant is unavailable and the manual finder is unchanged.
- The rate limits and the reservation mutation are an additive backend change. The
  route fails closed against an older backend, like search. The production backend
  deploy needs its usual separate approval.
- Consider a PostHog flag so the assistant can go to a few listeners first.

## Spike before building the UI

A local script runs the locate step on past Quotabunga entries that have a YouTube
link, and measures the found rate, start and end error, latency, and cost. The bar
to ship: at least 70% found, with the start within 2 s. Those entries are
production-derived, so the evaluation set stays out of the repository.

The spike is `apps/web/local-tools/quote-locate` (see its README). It uses the same
prompt, request and answer checks as the future route, from
`apps/web/src/server/quoteLocate.mjs`, with `gemini-3.8-flash` as the default model.

### Spike results (2026-09-28)

Listeners' saved starts turned out not to mark the line. Of the 17 entries with one,
10 were at 0–2 s: the listener kept the video's start or the start of the scene.
Scored against saved starts, the model hit only 24%, mostly because of those. So the
start and end of all 34 entries with a YouTube link were labeled by hand, where the
first and last words are spoken, with the spike's local labeling page (`label.mjs`).
That includes the 17 entries that had no saved start.

Against those labels, `gemini-3.8-flash` at low media resolution and default thinking:

- found the line in 32 of 33 answered runs (one request timed out and is not scored);
- put the start within 2 s in 29 of 33 (88%, roughly 73–95% at 95% confidence), and
  within 5 s in 30;
- was off at the start by 0.4 s at the median and 1.4 s at the 90th percentile,
  0.3 s late on balance, and off at the end by 0.4 s at the median, 0.3 s early on
  balance. The current padding (-0.5 s / +0.75 s) covers that bias;
- missed the same four entries in two separate runs (one not found, and starts off
  by -3.4 s, +5.6 s and +12.4 s), so retrying a miss is unlikely to fix it;
- answered "high" confidence every time, and its spoken text matched the listener's
  quote just as closely on misses as on hits;
- was never blocked for recitation, so the heard line can be shown.

Limits: one person labeled one export of 34 entries, and only low media resolution
and default thinking were tried.

## Smaller wins that need no model

- When subtitles are loaded, preselect the cue range that best matches the typed
  quote, for the listener to confirm. This is cheap and deterministic, but only helps
  listeners who have subtitles.
- Add `snippet/description` to the search `fields` (no extra quota), which gives the
  locate step and the results list more context.

## Decisions

- Google (Gemini) is approved as a second paid API vendor for this feature
  (2026-09-26).
- The assistant may spend at most $5 a month. That sets the 3-minute video limit
  and the run caps under "Cost, budget, and latency" (2026-09-28).
- A later version will add a text model with web search before the YouTube search,
  for "I only half-remember it" quotes. It is not part of v1 (2026-09-28).

References: [Gemini video understanding](https://ai.google.dev/gemini-api/docs/video-understanding),
[Gemini media resolution](https://ai.google.dev/gemini-api/docs/media-resolution),
[caption download API](https://developers.google.com/youtube/v3/docs/captions/download),
[cloud IP blocking of transcript scrapers](https://github.com/jdepoix/youtube-transcript-api/issues/593).
