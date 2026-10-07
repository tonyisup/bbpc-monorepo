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
(`BBPC_PIPELINE_DATA_DIR`, default `~/bbpc-pipeline-data`), not in the checkout.

## Modes (`settings.cowork_mode`, or `--cowork-mode` per run)

| mode | behaviour |
|---|---|
| `require` (shipped) | `movies`/`parse` use Cowork files; if missing, stop with exit 75 and mark the episode `awaiting_cowork` |
| `prefer` | use Cowork files when present, otherwise the heuristic/LLM stages |
| `off` | ignore Cowork files entirely (old behaviour) |

To process an episode without Cowork: `python pipeline.py episodes/X.mp3 --cowork-mode off`.

`output/cowork/state.json` is owned by the pipeline. On first use it treats
every episode that already has `output/seo/<stem>.seo.json` as `done`.
Unattended runs (no episode argument) skip `done` episodes and resume
`awaiting_cowork` ones once both Cowork files exist.

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

### Show format (what to look for)

- Hosts: **Fonzo** (Mike Lowry), **Tony** (a.k.a. MCB/MCP), **Harley**.
- Structure: intro banter → extras (movies a host watched on their own) →
  games (Mount Rushmore, **Quotabunga** quote bracket) → **Homework**
  (the assigned movie) → listener rating predictions → **Extra credit** →
  predictions → the wheel spin picks next week's homework/extra credit →
  weekends → outro.
- Rating scale, best to worst: **Slater**, **Dollar** ("I'd buy that for a
  dollar"), **Waste of Time**, **Pile of Shit**. Transcription often garbles
  these ("a palace" = a pile of shit).
- Ratings are best confirmed from the prediction scoring that follows each
  review: each correct guess is 10 points and "pain train" means every guess
  was wrong. Use that arithmetic to confirm who gave what.
- **Not reviews:** Quotabunga quote clips, studio logos, next week's
  assignments, comparisons ("feels like Evil Dead"). List them as
  `rejected` candidates with a `note`.

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
    "reviewType": "homework | extra_credit | extra_review", "pickedBy": "Fonzo",
    "hostRatings": {"Fonzo": "Slater", "Harley": "Waste of Time", "MCB": "Dollar"},
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
- Favour hot takes on new releases, bits that work without knowing the show,
  and genuine laughs. Avoid stretches that are mostly copyrighted movie or
  music audio playing, and anything about people outside the show.
- `imagePrompt`: an abstract cinematic metaphor for what is being said:
  symbolic objects, surreal setting, light and palette. Never people
  podcasting, studios, microphones or headphones; no text, logos, posters or
  recognizable characters/artwork from the films.
- `why`: why this works as a short-form clip.
