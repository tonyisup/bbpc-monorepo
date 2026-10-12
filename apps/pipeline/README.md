# BBPC pipeline

Local operator tool, run by hand on the podcast Mac. It is Python, so it is not a
pnpm workspace package and is never deployed.

Podcast content-factory pipeline for BBPC (cult-classic movie podcast). Ingests weekly episodes, transcribes them, extracts reviewed movies, generates SEO metadata, renders vertical video clips with AI backgrounds and burned subtitles, and publishes through the least-privilege Convex service API.

## Pipeline Stages

```
transcribe → import_transcript → movies → review_clip → parse → clip → thumbnail → publish
```

| # | Stage | Module | Description |
|-------|--------|--------|-------------|
| 1 | `transcribe` | `lib/transcriber.py` | Parakeet (default) or faster-whisper transcription with resume support and progress tracking |
| 2 | `import_transcript` | `lib/transcript_importer.py` | Imports completed transcripts into Convex search using the guarded monorepo CLI |
| 3 | `movies` | `lib/movie_extractor.py` | Adopts Cowork's reviewed movies and matches them to Convex movie IDs |
| 4 | `review_clip` | `lib/review_clipper.py` | Cuts audio clips around movie-review evidence windows |
| 5 | `parse` | `lib/parser.py` | Adopts Cowork's SEO metadata and clip candidates |
| 6 | `clip` | `lib/clipper.py` | Renders vertical 9:16 video with AI backgrounds, Ken Burns zoom, ASS subtitles |
| 7 | `thumbnail` | `lib/thumbnail.py` | Generates 1920x1920 episode thumbnail from reviewed movie and TV show extra posters + BBPC logo |
| 8 | `publish` | `lib/publisher.py` | Idempotently publishes SEO metadata to Convex |

## Quick Start

```bash
cd apps/pipeline
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt -c constraints.txt   # the versions the pipeline is known to work with
mkdir -p ~/src/bbpc/bbpc-pipeline-data
cp .env.example ~/src/bbpc/bbpc-pipeline-data/.env   # then fill in the values
```

Run every command below from `apps/pipeline`.

### Data directory

Episodes, transcripts, and output live outside the checkout, in
`BBPC_PIPELINE_DATA_DIR` (default `~/src/bbpc/bbpc-pipeline-data`), so every worktree
shares them and no git command can delete them. Relative entries under `paths`
in `config.json`, and `settings.cowork_outputs_dir`, resolve against that
directory; `episodes/20260405.mp3` in the examples means that file inside it.
The pipeline refuses to start when the directory is missing rather than begin an
empty one and reprocess every episode.

`.env` is read from `apps/pipeline/.env` and then `$BBPC_PIPELINE_DATA_DIR/.env`;
both are loaded when both exist. A variable already set in the shell, or by the
first file, is never replaced, so `apps/pipeline/.env` can set
`BBPC_PIPELINE_DATA_DIR` to choose the second. Neither depends on the working
directory. Keeping secrets in the data directory shares one copy across worktrees.

### Run full pipeline for an episode

```bash
python pipeline.py episodes/20260405.mp3
```

### Run a single stage

```bash
python pipeline.py episodes/20260405.mp3 --only clip
```

### Transcription engine

Set `settings.transcription_engine` in `config.json`:

- **`parakeet`** (default) — NVIDIA Parakeet TDT via `parakeet-mlx` on the Apple
  Silicon GPU; model from `settings.parakeet_model`. Apple Silicon only.
- **`faster-whisper`** — Whisper on the CPU; model from `settings.whisper_model`.

On an M4 Pro, a 112-minute episode took about 1.6 minutes with Parakeet versus
an estimated 32 minutes with faster-whisper `large-v3-turbo`. Long faster-whisper
runs can also lose punctuation and split into one- or two-word segments partway
through, which hurts movie matching.

Parakeet transcripts also store word timings: each segment may carry
`words: [{start, end, text}]`, and no segment runs longer than about 15 s (long
ones are split at their largest pauses). Every stage and the Convex importer
ignore the extra field; only the clip captions use it. Parakeet does not produce
Whisper's hallucinated "Thank you." lines over trailing silence, so a transcript
ends where speech ends.

### Automatic transcript import

A full run imports the completed transcript immediately after transcription, before
movie extraction and video generation. `--only transcribe` stays transcription-only.
The pipeline stops on interrupted/failed transcription, empty output, timestamps
past the source duration, segment starts out of order, or coverage below 95%. It
preserves the JSON for resume or review. Coverage is measured to the end of
speech: ffmpeg `silencedetect` (-50 dB, 5 s) finds trailing silence and its start
is used in place of the file length, so an episode ending in 30 minutes of
silence still passes when the transcript covers all of the speech.
The standalone transcriber retains its existing partial-save behavior; pipeline
runs opt into strict completion checking.

The importer requires Node.js **22.6.0+** and a completed `pnpm install` at the
repository root; set `BBPC_NODE_BINARY` for an explicit Node executable. It invokes
this checkout's `packages/convex-backend/local-tools/transcripts/pipeline.mjs` as a
CLI, so the pipeline and the importer always change together, and reuses
the existing passage builder, authenticated inspection, atomic replacement,
content hashing, retry behavior, and conflict checks. No backend deployment is run.

In `.env`, pin `BBPC_EXPECTED_CONVEX_URL` to the intended `CONVEX_URL` and set
`BBPC_EXPECTED_CONVEX_DEPLOYMENT` to its deployment name for remote targets.
These independent pins must be changed deliberately when switching environments.
Any existing `BBPC_FORBIDDEN_CONVEX_DEPLOYMENT` remains enforced. Target and local
CLI checks run before transcription begins. Authentication reuses
`CLERK_MACHINE_SECRET_KEY` or `CONVEX_PIPELINE_TOKEN`; a fresh short-lived JWT is
minted at import time when using the machine secret, and is passed only through
the child process environment.

The default mapping uses the exact `YYYYMMDD.mp3` audio filename date, even with
an overridden transcript output path. Missing/ambiguous dates and filenames with
suffixes fail with instructions to supply a verified `--episode-id`; the importer
never creates an episode or guesses by nearby dates or episode numbers.

To import an existing transcript after reviewing it, without regenerating clips:

```bash
# Read-only validation and inspection first.
python pipeline.py episodes/20260908.mp3 --only import_transcript --confirm-complete --dry-run
# Import; identical content is a no-op.
python pipeline.py episodes/20260908.mp3 --only import_transcript --confirm-complete
# For a reviewed mapping that cannot be resolved by filename date:
python pipeline.py episodes/20260908.mp3 --only import_transcript --confirm-complete --episode-id CANONICAL_CONVEX_EPISODE_ID
```

`--confirm-complete` is your assertion that the existing transcript is complete;
file existence alone is not confirmation. The original JSON is never modified by
import. `--episode-id` affects transcript import only; existing movie/SEO stages
retain their own date-based episode lookup.

### Backfill batch processing

```bash
python backfill.py --dry-run
python backfill.py --date-after 20260401
```

## Configuration

`config.json` controls paths, models, and thresholds. Environment variables (`.env`) store secrets:

Judgment (reviewed movies, SEO, clip choice) comes only from Cowork; the
pipeline makes no text-model calls. The only hosted model is the clip-background
image model, configured through `settings.visuals_provider`.

| Variable | Purpose |
|----------|---------|
| `BBPC_PIPELINE_DATA_DIR` | Directory holding `episodes/`, `transcripts/`, and `output/`; defaults to `~/src/bbpc/bbpc-pipeline-data` |
| `AZURE_STORAGE_CONNECTION_STRING` | Azure Blob Storage |
| `CONVEX_URL` | Convex deployment Functions API URL |
| `CONVEX_PIPELINE_TOKEN` | Pre-minted Clerk M2M JWT for a one-off local probe; mutually exclusive with the machine secret |
| `CLERK_MACHINE_SECRET_KEY` | Preferred long-running-job credential; mints cached short-lived JWTs for the pipeline machine's configured scopes |
| `CLERK_M2M_AUDIENCE` | Clerk machine ID for the scoped `BBPC Convex` receiver; must appear in the JWT `aud` array |
| `CLERK_M2M_TOKEN_TTL_SECONDS` | JWT lifetime; defaults to 900 seconds, allowed range 60–3600 |
| `CLERK_M2M_REFRESH_MARGIN_SECONDS` | Refresh lead time; defaults to 60 seconds and must be below the TTL |
| `CONVEX_TIMEOUT_SECONDS` | Functions API timeout; defaults to 30 seconds |
| `CONVEX_MAX_ATTEMPTS` | Bounded query/idempotent-write attempts; defaults to 3, maximum 5 |
| `OPENROUTER_API_KEY` | OpenRouter image generation when `visuals_provider` is `openrouter` |
| `OPENAI_API_KEY` | Direct OpenAI image generation when `visuals_provider` is `openai` (optional) |

## Cowork hand-off (movies + SEO)

Claude Cowork writes `output/cowork/<stem>.movies.json` and `<stem>.seo.json`
from the full transcript, and the `movies`/`parse` stages consume them. There is
no fallback: a new episode stops after `import_transcript` with exit code 75
(`awaiting_cowork` in `output/cowork/state.json`), and the next unattended run
resumes with `--from movies` once both files exist. Details and the authoring
rules Cowork follows:
[`docs/cowork-handoff.md`](docs/cowork-handoff.md). Show knowledge (hosts, rating
scale, segments, what Tony publishes) lives in [`docs/show-format.md`](docs/show-format.md).

```bash
python pipeline.py episodes/20260914.mp3 --from movies      # resume after Cowork
python3 scripts/validate_cowork_outputs.py --pending        # what is waiting on Cowork
python3 scripts/validate_cowork_outputs.py 20260914         # check one episode's files (hard rules + warnings)
```

## Publish decisions

After reviewing an episode's rendered clips, record what happened to each one.
Decisions go to `output/publish-decisions.json` in the data directory and are
the record of which picks became Shorts; the clip-picking review and any
future rubric read them. Standard library only, no venv needed:

```bash
python3 scripts/publish_decisions.py list 20261005                     # rendered clips + candidates
python3 scripts/publish_decisions.py publish 20261005 2 https://youtube.com/shorts/ID
python3 scripts/publish_decisions.py skip 20261005 rest --reason "too long"
python3 scripts/publish_decisions.py publish 20261005 c7 https://youtu.be/ID   # a candidate that wasn't rendered
python3 scripts/publish_decisions.py report
```

Clip numbers are the `NN-` prefix of the rendered file. Decisions copy the
clip's window and headline, so they survive deleting the rendered files.

## Recurring phrases

`scripts/scan_phrases.py` scans every `transcripts/<YYYYMMDD>.json` for phrases
that recur across episodes: catchphrases, running gags (a burst over
consecutive episodes), and pre-recorded drops and rituals (long identical
passages). It is the starting list for T-shirt ideas; deciding what is
original versus a movie quote, and what belongs on a shirt, stays a human or
Cowork call. Standard library only; about 20 s and 550 MB for 340 transcripts.

```bash
python3 scripts/scan_phrases.py               # rescan everything after a backfill
python3 scripts/scan_phrases.py --top 200     # longer lists in the report
```

It writes `output/phrases/recurring-phrases.md` (readable lists, plus what is
new since the previous scan) and `recurring-phrases.json` (every phrase with
its episodes and timestamped examples). Ordinary English that slips through
(the scan has no outside English baseline) goes in `output/phrases/ignore.txt`,
one phrase per line; later scans skip it. A passage is skipped when a line
matches its whole text (case and punctuation don't matter). The "Staples" section is where the
show's biggest catchphrases and everyday English look alike, so review it once.

## Movies without a transcript

If the transcript file is missing, the `movies` stage writes the episode's
Convex assignment and extra-review movies as `db_assigned` rows (extractor mode
`db_only`, no evidence). It fails only when Convex has no movies for the episode.

## Visuals

Configurable via `settings.visuals_provider`:

- **`openrouter`** — image-capable OpenRouter chat model; default: `google/gemini-3.1-flash-image`
- **`openai`** — gpt-image-1 via direct OpenAI API
- **`local`** — Stable Diffusion XL Turbo via `scripts/generate_local_visual.py`

OpenRouter images are requested with the chat-completions image modality and
written from their base64 data URL as normal PNG backgrounds before the existing
crop, logo, subtitle, and ffmpeg stages run. Remote image URLs are rejected to
avoid provider-response-driven network requests. Set
`settings.openrouter_visual_model` to select another OpenRouter image-output
model. Set `settings.visual_timeout_seconds` to override the image-request
timeout (otherwise the provider default applies).

Brand logo overlay is composited onto clip backgrounds when `settings.brand_logo_enabled` is `true`.

## Testing

```bash
python -m pytest tests/ -v
```

The suite covers the Cowork hand-off (validation, state, movies and parse
stages), clip rendering, review clipping, laughter detection, runtime config, dependency
declarations, the Clerk M2M/Convex boundary, visual-prompt safety, and backfill
error handling.

## Read-only pipeline identity probe

After configuring exactly one pipeline credential, mint or load its JWT and
print only the identity metadata required to pre-provision the local Convex
service principal:

```bash
python scripts/convex_m2m_probe.py --claims-only
```

The probe never prints the JWT or machine secret. After the principal has been
pre-provisioned with only `pipeline:publish`, verify its capabilities and,
optionally, one exact episode context without printing any episode or movie
fields:

```bash
python scripts/convex_m2m_probe.py
python scripts/convex_m2m_probe.py --date YYYY-MM-DD
```

These commands perform queries only. Mutation, expiry, disable/revocation, and
S3/S4 write-gate checks remain separately controlled acceptance steps.

## Output Structure

Inside the data directory:

```
output/
├── clips/<episode>/          # Rendered vertical .mp4 clips
├── visuals/<episode>/        # AI-generated background images
├── movies/<episode>.movies.json  # Extracted movie data
├── seo/<episode>.seo.json    # SEO metadata
├── publish-decisions.json    # published/skipped per rendered clip (scripts/publish_decisions.py)
├── phrases/                  # recurring-phrases.{md,json} + ignore.txt (scripts/scan_phrases.py)
├── review-clips/<episode>/   # Audio clips from review segments
├── laughter/                 # laughter_autotune.py results
├── thumbnails/<episode>.png  # Episode thumbnail (posters + logo)
```

## Architecture Notes

- **Transcriber** uses Parakeet (MLX) by default or `faster-whisper` with int8 quantization, with resume support and a trailing-silence-aware coverage gate
- **Movie extractor** matches Cowork's titles (and original titles) to the Convex catalog, preferring the episode's assigned movies
- **Laughter detector** (`lib/laughter_detector.py`) is not called by any stage today; it is kept so its timestamps can be handed to Cowork as audio evidence
- **Clipper** uses ffmpeg with ASS subtitle burn-in and Ken Burns zoom; requires `ffmpeg-full` (Homebrew) for libass support. Captions are cut into chunks of at most two lines (measured in Arial Bold, 32 characters max) on word timings and punctuation; transcripts without `words` get proportional timings, which also merges Whisper's one- and two-word fragments
- **Convex client** uses the documented Functions API with bearer authentication, runtime response validation, typed errors, bounded retries, and cached Clerk M2M JWT refresh
- **Pipeline identity** must be pre-provisioned with `pipeline:publish`; the Clerk pipeline machine must be scoped to the receiver machine configured as `CLERK_M2M_AUDIENCE`
- **Backfill** processes Azure Blob episodes with a Rich dashboard and idempotent Convex episode creation from MP3 ID3 tags
