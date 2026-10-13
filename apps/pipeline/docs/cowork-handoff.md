# Cowork hand-off: movies + SEO

Claude (Cowork) replaces the two judgment stages of the pipeline — `movies`
(reviewed-movie extraction) and `parse` (SEO + clip selection). Everything
else stays in Python.

```
run ─► pipeline.py ─► transcribe ─► import_transcript ─► movies ✋ (exit 75, state: awaiting_cowork)
Cowork ─► reads transcript ─► writes output/cowork/<stem>.movies.json + <stem>.seo.json
run ─► pipeline.py ─► (resumes --from movies) ─► review_clip … publish (state: done)
```

`output/` and the transcripts are in the pipeline data directory
(`BBPC_PIPELINE_DATA_DIR`, default `~/src/bbpc/bbpc-pipeline-data`), not in the checkout.

Cowork also writes a third file, `output/cowork/<stem>.shirts.json`: the
episode's T-shirt phrases. It is information for Tony. No stage reads it, and
the pipeline neither waits for it nor stops when it is missing or invalid.

## No fallback

Cowork is the only source of judgment. If a Cowork file is missing, `movies`
or `parse` stops with exit 75 and marks the episode `awaiting_cowork`; there is
no heuristic or model-based path to fall back to. (Older configs may still
carry `settings.cowork_mode`; it is ignored.)

`output/cowork/state.json` is owned by the pipeline. On first use it treats
every episode that already has `output/seo/<stem>.seo.json` as `done`.
Unattended runs (no episode argument) skip `done` episodes and resume
`awaiting_cowork` ones once the movies and SEO files exist.

## Instructions for Cowork

Cowork needs two folders: `apps/pipeline` (to run the validator) and the data
directory (to read transcripts and write its files). Run the validator from
`apps/pipeline` with `BBPC_PIPELINE_DATA_DIR` set to wherever the data
directory is mounted; it stops if that directory is missing. It prints the
exact transcript and output paths to use.

1. `python3 scripts/validate_cowork_outputs.py --pending` lists episodes to
   work on (transcript path, output paths, and any `lastError` from a
   previous rejected file). Nothing listed → stop.
2. Read the **entire** transcript (`[{start, end, text, words?}]`). Do not
   sample. Speakers are not labelled; infer from context. Parakeet segments
   are sentences of at most ~15 s; the optional `words` list holds word
   timings for captions and can be ignored when reading.
3. Write the two files below, then run
   `python3 scripts/validate_cowork_outputs.py <stem>` and fix anything it
   reports. Never edit `state.json`.
4. Write `<stem>.shirts.json` (format below) with the episode's T-shirt
   phrases, or an empty `phrases` list when nothing is shirt-worthy. Run the
   validator again and fix anything it reports under `shirts`. The pipeline
   does not wait for this file, so write it after the two above.

### What the validator enforces

`FAIL` lines block the pipeline (exit 75, the reason lands in `lastError`);
`warning` lines are printed but never block. With the transcript available:

| Rule | Level |
|---|---|
| Required keys present and non-empty; clip and evidence windows numeric, ordered, inside the transcript | FAIL |
| `candidateClips`: exactly 20 | FAIL |
| `clipAnalysis`: exactly 3 distinct picks, each with the same `start`, `end` and `headline` as a candidate (`why` may add the selection reason) | FAIL |
| Every clip and evidence window starts on a segment `start` and ends on a segment `end` | FAIL |
| `hostRatings` keys are `Fonso`, `Harley`, `Tony`; values are `Slater`, `Dollar`, `Waste`, `Goldblum` | FAIL |
| Clip length 20–90 s | warning |
| Evidence window length 60–180 s | warning |
| `title` ≤ 60 characters; `metaDescription` about 160 (120–170); `highlights` 3–5 | warning |
| Shirts: `episode.stem`, `generatedAt`, `phrases` and every phrase's `phrase`, `start`, `end`, `speaker`, `origin`, `source`, `why` present with the right type | FAIL |
| Shirts: at most 10 phrases, no phrase repeated (ignoring case) | FAIL |
| Shirts: `speaker` is `Fonso`, `Harley`, `Tony`, `Drop` or `Unknown`; `origin` is `original`, `quote` or `unsure`; `source` names the work for a `quote` and is `null` otherwise | FAIL |
| Shirts: window numeric, ordered, inside the transcript, starting on a segment `start` and ending on a segment `end` | FAIL |
| Shirts: the phrase's words (lowercased, punctuation ignored) appear in order in the window's transcript text | FAIL |
| Shirts: phrase ≤ 60 characters; window ≤ 30 s | warning |

The same checks run inside the `movies` and `parse` stages, so a file the
validator passes is a file the pipeline accepts.

The shirts rules are checked by the validator only. A shirts `FAIL` makes the
validator exit 1 but does not block the pipeline or write `lastError`. A
missing shirts file is reported as `not written (optional)`.

### Show format (what to look for)

Read [`show-format.md`](show-format.md) first: hosts and their aliases, the
episode structure, the rating scale, how prediction scoring confirms ratings,
what is *not* a review, common transcription garbles, and which kinds of bits
Tony has actually published as Shorts. That file is the only copy of show
knowledge; this one covers the file formats.

### `<stem>.movies.json`

```json
{
  "episode": {"stem": "20260914", "date": "2026-09-14", "dbEpisodeNumber": 792,
              "dbEpisodeId": null, "dbEpisodeTitle": null},
  "extractor": {"version": "cowork_v1", "llmEnabled": true, "llmUsed": true,
                "mode": "cowork_full_transcript", "generatedAt": "<ISO-8601>"},
  "movies": [{
    "matchedMovieId": null,
    "title": "Cemetery Man", "originalTitle": "Dellamorte Dellamore", "year": 1994,
    "confidence": 0.97, "status": "accepted",
    "reviewType": "homework | extra_credit | extra_review", "pickedBy": "Fonso",
    "hostRatings": {"Fonso": "Slater", "Harley": "Waste", "Tony": "Dollar"},
    "ratingSource": "how the ratings were confirmed",
    "signals": ["exact_title", "strong_review_context", "host_ratings_scored"],
    "evidence": [{"windowIndex": 4801, "start": 5613.3, "end": 5698.1,
                  "text": "…", "windowType": "review"}]
  }],
  "unmatchedTitles": [],
  "candidates": [ "…every movie row above plus rejected mentions, each with score/confidence/status/note…" ]
}
```

- Leave `matchedMovieId` null; the pipeline fills it from Convex by title/year
  and adds any Convex-assigned movie you missed as `db_assigned`.
- `evidence` windows drive the audio review clips: give 1–3 windows per
  reviewed movie, each covering an actual review (60–180 s), snapped to
  segment starts/ends.

### `<stem>.seo.json`

Keys: `title` (≤60 chars), `metaDescription` (~160 chars), `keywords`
(ranked by search intent), `highlights` (3–5, `"HH:MM:SS"` strings),
`candidateClips` (exactly 20), `clipAnalysis` (the 3 you would post first,
copied from `candidateClips`), `notableWorks`, `callToAction`.

Clips (`start`/`end` in float seconds, on segment boundaries):

- Episodes can end in long silence (794 has ~33 min). Parakeet transcripts
  stop where speech stops, with no hallucinated "Thank you." lines, so every
  clip must end before the trailing silence.
- 20–90 s, self-contained, with a hook in the first few seconds and a payoff.
  Roughly 5 per quarter of the runtime.
- Favour single bits that work without knowing the show, genuine laughs, and
  hot takes on new releases. See "What gets published" in `show-format.md`
  for the bits Tony actually posted. Avoid stretches that are mostly copyrighted movie or
  music audio playing, and anything about people outside the show.
- `imagePrompt`: an abstract cinematic metaphor for what is being said:
  symbolic objects, surreal setting, light and palette. Never people
  podcasting, studios, microphones or headphones; no text, logos, posters or
  recognizable characters/artwork from the films.
- `why`: why this works as a short-form clip.

### `<stem>.shirts.json`

```json
{
  "episode": {"stem": "20261005"},
  "generatedAt": "<ISO-8601>",
  "phrases": [
    {"phrase": "Never trust a big booty", "start": 812.4, "end": 819.9,
     "speaker": "Harley", "origin": "original", "source": null,
     "why": "Recurring sign-off; funny with no context"}
  ]
}
```

What belongs on a shirt, and how to choose between `original`, `quote` and
`unsure`, is in [T-shirt phrases](show-format.md#t-shirt-phrases) in
`show-format.md`. The format:

- `phrases`: at most 10. An empty list is a valid answer.
- `phrase`: the line as spoken. Case and punctuation are yours, and filler
  words may be dropped, but every word must be in the window's transcript
  text, in order. Keep the transcript's spelling of a garbled word and give
  the intended spelling in `why`.
- `start`/`end`: float seconds on segment boundaries, covering the segment or
  segments where the line is said. Usually one segment; over 30 s is a
  warning.
- `speaker`: `Fonso`, `Harley`, `Tony`, `Drop` (a pre-recorded drop) or
  `Unknown`.
- `origin`: `original`, `quote` or `unsure`.
- `source`: the movie, song or show when `origin` is `quote`; otherwise
  `null`.
- `why`: why a fan would wear it.
