# Quote Finder assistant

Date: 2026-09-26
Status: Proposal. Gemini approved as the provider (2026-09-26). Spike written, not yet
run; the other decisions at the end are still open.

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
     descriptions. It drops videos over about 10 minutes (full films, compilations)
     and picks the best remaining candidate by rank and duration;
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
- The model can claim a line that isn't there. The spoken-text check, the confidence
  label, and the listener's own preview catch this before anything is saved.
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

- Video input costs about 100 tokens per second at low media resolution (66 per
  frame plus 32 per second of audio). A 3-minute scene clip is about 18k input
  tokens. On a Flash-tier model that is a small cost per run; confirm current
  prices at spike time.
- Budget: new token buckets in `convex/games/limits.ts` (starting point: 3 burst,
  6/day per listener, 60/day site-wide), plus a spend alert on the Google project.
  Each assistant session also spends normal video searches, which stay capped by
  the existing buckets.
- Use a paid key. The free tier caps YouTube input at 8 hours a day, and free-tier
  prompts may be used to improve Google's products.
- Expect roughly 10–30 s per run. Show progress, let the listener cancel (abort the
  request, as search does), and set the route's `maxDuration` to cover it.
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

Write a local script that runs the locate step on about 25 past Quotabunga entries
that have a YouTube link and a start time, plus an end where one was set. Measure the
found rate, start and end error, latency, and cost. A reasonable bar to ship: at
least 70% found, with the start within 2 s. Those entries are production-derived, so
the evaluation set stays out of the repository.

The spike is `apps/web/local-tools/quote-locate` (see its README). It uses the same
prompt, request and answer checks as the future route, from
`apps/web/src/server/quoteLocate.mjs`, with `gemini-3.8-flash` as the default model.

## Smaller wins that need no model

- When subtitles are loaded, preselect the cue range that best matches the typed
  quote, for the listener to confirm. This is cheap and deterministic, but only helps
  listeners who have subtitles.
- Add `snippet/description` to the search `fields` (no extra quota), which gives the
  locate step and the results list more context.

## Decisions needed

1. Per-listener and site-wide daily caps for assistant runs.
2. Whether a later version should use a text model with web search before searching
   YouTube, for "I only half-remember it" quotes.

Settled: Google (Gemini) is approved as a second paid API vendor for this feature.

References: [Gemini video understanding](https://ai.google.dev/gemini-api/docs/video-understanding),
[Gemini media resolution](https://ai.google.dev/gemini-api/docs/media-resolution),
[caption download API](https://developers.google.com/youtube/v3/docs/captions/download),
[cloud IP blocking of transcript scrapers](https://github.com/jdepoix/youtube-transcript-api/issues/593).
