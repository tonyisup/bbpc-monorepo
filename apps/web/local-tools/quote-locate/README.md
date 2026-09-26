# Quote locate spike

Measures whether Gemini can find a Quotabunga quote in its YouTube clip, before the
Quote Finder assistant is built (see `docs/designs/quote-finder-assistant.md`). For
each past entry with a YouTube link and a saved start time, it asks Gemini where the
quote is spoken in the listener's own clip. It then compares the answer with the start
and end the listener saved. The prompt, request, and answer checks live in
`src/server/quoteLocate.mjs`, which the assistant's route will use, so the spike
measures what would ship.

The video is always sent as a bare watch link. Saved clip links carry the listener's
`t=` start, which would give the answer away.

## Keep the data out of the repository

Exports and results contain listeners' production entries. Keep both outside the
repository. The script refuses input or output paths inside it, writes results readable
only by you, and never overwrites an earlier run.

## Export past entries

This is a read-only query against production. Run it from the repository root:

```sh
mkdir -p ~/bbpc-quote-spike
pnpm --filter @tonyisup/bbpc-convex-api exec convex data quoteSubmissions \
  --prod --limit 1000 --format jsonLines > ~/bbpc-quote-spike/quotes.jsonl
```

Export everything. The script keeps only entries with a YouTube clip link and a start
time, and counts the rest by reason.

## Check the selection first

```sh
node --env-file=apps/web/.env.local apps/web/local-tools/quote-locate/spike.mjs \
  --input ~/bbpc-quote-spike/quotes.jsonl --dry-run
```

This needs only `YOUTUBE_API_KEY` (one quota unit per 50 videos). It prints how many
rows would run, why the others are skipped (unavailable, private, over 10 minutes,
live), and a rough input-token count. It makes no Gemini requests.

## Run

Add a paid-tier `GEMINI_API_KEY` to `apps/web/.env.local`, which is gitignored. Then:

```sh
node --env-file=apps/web/.env.local apps/web/local-tools/quote-locate/spike.mjs \
  --input ~/bbpc-quote-spike/quotes.jsonl --input-price <usd> --output-price <usd>
```

The script runs the first 25 runnable rows, one request at a time, and prints a line
per row. Take prices per 1M tokens from Google's pricing page for the model; without
them, the summary reports tokens only. Thinking tokens are billed as output. Audio
input can be priced differently from video and text, and the summary splits input
tokens by type so you can adjust.

`--help` lists the options: `--limit`, `--model` (default `gemini-3.8-flash`),
`--media-resolution`, `--thinking`, `--max-video-seconds`, `--timeout-seconds`, and
`--output`. Every run writes a new results file next to the input, so runs with
`--thinking low` or `--media-resolution medium` can be compared side by side.

## Reading the summary

- **Start within 2 s** is the headline: a hit is a located start within 2 seconds of
  the listener's saved start. The design's bar is 70% of answered rows.
- Saved starts are the listener's choice. They are often a beat before the line or
  rounded to a whole second, so some error is expected. The **median signed** start
  error shows the bias; use it to set the padding.
- **Found misses** are answers that land well away from the saved start. Read those
  rows: the line may be spoken twice, or the saved start may include a long lead-in.
- **Quote match** is the share of the listener's wording that appears in the heard
  line. Compare the value on hits with the value on misses to choose where the
  assistant should say "possible match" instead of a confident one.
- **Confidence** shows hits per level, which tells you whether the model's own
  confidence can be trusted.
- **blocked RECITATION** means Gemini declined to repeat copyrighted dialogue. If this
  is common, the assistant must work from times alone, without the heard line.
- **Request errors** (HTTP failures, timeouts) are listed but not scored. Rerun if
  there are many.

Each results line has the entry ID, video, the saved and located times, the padded
range, the heard line, confidence, errors in seconds, quote match, latency, token
usage, and the model version that answered.
