# BBPC pipeline

Local operator tool, run by hand on the podcast Mac. It is Python, so it is not a
pnpm workspace package and is never deployed.

Podcast content-factory pipeline for BBPC (cult-classic movie podcast). Ingests weekly episodes, transcribes them, extracts reviewed movies, generates SEO metadata, renders vertical video clips with AI backgrounds and burned subtitles, and publishes through the least-privilege Convex service API.

## Pipeline Stages

```
transcribe → import_transcript → movies → review_clip → diarize → parse → clip → thumbnail → publish
```

| # | Stage | Module | Description |
|-------|--------|--------|-------------|
| 1 | `transcribe` | `lib/transcriber.py` | Parakeet (default) or faster-whisper transcription with resume support and progress tracking |
| 2 | `import_transcript` | `lib/transcript_importer.py` | Imports completed transcripts into Convex search using the guarded monorepo CLI |
| 3 | `movies` | `lib/movie_extractor.py` | Heuristic + LLM movie extraction from transcript evidence windows |
| 4 | `review_clip` | `lib/review_clipper.py` | Cuts audio clips around movie-review evidence windows |
| 5 | `diarize` | `lib/diarizer.py` | Speaker identification (placeholder) |
| 6 | `parse` | `lib/parser.py` | LLM SEO analysis (`settings.seo_model`): titles, descriptions, keywords, clip candidates |
| 7 | `clip` | `lib/clipper.py` | Renders vertical 9:16 video with AI backgrounds, Ken Burns zoom, ASS subtitles |
| 8 | `thumbnail` | `lib/thumbnail.py` | Generates 1920x1920 episode thumbnail from reviewed movie posters + BBPC logo |
| 9 | `publish` | `lib/publisher.py` | Idempotently publishes SEO metadata to Convex |

## Quick Start

```bash
cd apps/pipeline
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt -c constraints.txt   # the versions the pipeline is known to work with
mkdir -p ~/bbpc-pipeline-data
cp .env.example ~/bbpc-pipeline-data/.env   # then fill in the values
```

Run every command below from `apps/pipeline`.

### Data directory

Episodes, transcripts, and output live outside the checkout, in
`BBPC_PIPELINE_DATA_DIR` (default `~/bbpc-pipeline-data`), so every worktree
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

The hosted LLM stages use OpenRouter:
`settings.seo_model` drives SEO/clip analysis and
`settings.movie_extractor_model` drives LLM-assisted movie extraction. Image
generation remains separately configured through `settings.visuals_provider`.

For reasoning-capable SEO models, `settings.seo_max_output_tokens` reserves a
completion budget for the full SEO/clip JSON payload (the shipped value is
`65536`), and `settings.seo_reasoning_effort` is forwarded to OpenRouter (the
shipped value is `low`). Keep the larger budget when the response includes
`candidateClips`, `clipAnalysis`, or `highlights`; a too-small budget can be
consumed by hidden reasoning before the model emits any JSON.

| Variable | Purpose |
|----------|---------|
| `BBPC_PIPELINE_DATA_DIR` | Directory holding `episodes/`, `transcripts/`, and `output/`; defaults to `~/bbpc-pipeline-data` |
| `AZURE_STORAGE_CONNECTION_STRING` | Azure Blob Storage |
| `CONVEX_URL` | Convex deployment Functions API URL |
| `CONVEX_PIPELINE_TOKEN` | Pre-minted Clerk M2M JWT for a one-off local probe; mutually exclusive with the machine secret |
| `CLERK_MACHINE_SECRET_KEY` | Preferred long-running-job credential; mints cached short-lived JWTs for the pipeline machine's configured scopes |
| `CLERK_M2M_AUDIENCE` | Clerk machine ID for the scoped `BBPC Convex` receiver; must appear in the JWT `aud` array |
| `CLERK_M2M_TOKEN_TTL_SECONDS` | JWT lifetime; defaults to 900 seconds, allowed range 60–3600 |
| `CLERK_M2M_REFRESH_MARGIN_SECONDS` | Refresh lead time; defaults to 60 seconds and must be below the TTL |
| `CONVEX_TIMEOUT_SECONDS` | Functions API timeout; defaults to 30 seconds |
| `CONVEX_MAX_ATTEMPTS` | Bounded query/idempotent-write attempts; defaults to 3, maximum 5 |
| `OPENROUTER_API_KEY` | OpenRouter LLM API |
| `OPENAI_API_KEY` | Direct OpenAI image generation when `visuals_provider` is `openai` (optional) |
| `OLLAMA_BASE_URL` | Local Ollama (optional) |

## Cowork hand-off (movies + SEO)

With `settings.cowork_mode = "require"` (the shipped setting), Claude Cowork
writes `output/cowork/<stem>.movies.json` and `<stem>.seo.json` from the full
transcript, and the `movies`/`parse` stages consume them instead of calling
OpenRouter. A new episode stops after `import_transcript` with exit code 75
(`awaiting_cowork` in `output/cowork/state.json`); the next unattended run
resumes with `--from movies` once both files exist. Use `--cowork-mode off` to
run the old LLM stages. Details and the authoring rules Cowork follows:
[`docs/cowork-handoff.md`](docs/cowork-handoff.md).

```bash
python pipeline.py episodes/20260914.mp3 --from movies      # resume after Cowork
python3 scripts/validate_cowork_outputs.py --pending        # what is waiting on Cowork
```

## Movie Extraction Modes

Configurable via `settings.movie_extractor_mode`:

- **`heuristic`** (default) — Rule-based scoring with keyword/pattern evidence windows
- **`llm_only`** — Full transcript sent to LLM for extraction
- **`hybrid_full_transcript`** — Heuristic scoring augmented by LLM full-transcript pass

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

The suite covers movie extraction (heuristic + LLM), parser resilience, clip
rendering, review clipping, laughter detection, runtime config, dependency
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
├── review-clips/<episode>/   # Audio clips from review segments
├── laughter/<episode>/       # Laughter detection results
├── thumbnails/<episode>.png  # Episode thumbnail (posters + logo)
```

## Architecture Notes

- **Transcriber** uses Parakeet (MLX) by default or `faster-whisper` with int8 quantization, with resume support and a trailing-silence-aware coverage gate
- **Movie extractor** builds multi-size evidence windows (1-5 segment merges) and scores candidates via keyword/pattern matching with configurable thresholds
- **Parser** uses stratified sampling (4 quartiles) to distribute LLM attention across full episode runtime
- **Clipper** uses ffmpeg with ASS subtitle burn-in and Ken Burns zoom; requires `ffmpeg-full` (Homebrew) for libass support. Captions are cut into chunks of at most two lines (measured in Arial Bold, 32 characters max) on word timings and punctuation; transcripts without `words` get proportional timings, which also merges Whisper's one- and two-word fragments
- **Convex client** uses the documented Functions API with bearer authentication, runtime response validation, typed errors, bounded retries, and cached Clerk M2M JWT refresh
- **Pipeline identity** must be pre-provisioned with `pipeline:publish`; the Clerk pipeline machine must be scoped to the receiver machine configured as `CLERK_M2M_AUDIENCE`
- **Backfill** processes Azure Blob episodes with a Rich dashboard and idempotent Convex episode creation from MP3 ID3 tags
