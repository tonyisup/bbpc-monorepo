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

### Check before a run

```bash
venv/bin/python scripts/check_run.py                 # before an unattended run
venv/bin/python scripts/check_run.py --from clip     # before pipeline.py <episode> --from clip
```

The checks the dashboard's Runs tab makes: the data directory exists,
`check_configuration()` passes (the Convex target matches its pins, through the
Node importer), the credentials the run needs are set, ffmpeg has libass and
Node is 22.6 or newer. Credentials are listed by name, set or not set; no
`.env` value is printed. It exits 1 if a check fails.

`scripts/redacted_run.py -- <command>` runs a command with every `.env` value in
its output replaced by the value's name; the Runs tab starts the pipeline
through it so the log can be kept and shown.

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

## Dashboard

One local page over the data directory: what needs you, each episode's stages
and Cowork files, every setting, a Lab for trying a change to how clips look
on one clip, and pipeline runs. Standard library only, no venv needed to start it:

```bash
python3 -m dashboard                # then open http://127.0.0.1:8765/
python3 -m dashboard --port 9000
python3 -m dashboard --pipeline-python /path/to/venv/bin/python   # for the Lab and Runs, when ./venv is elsewhere
```

It listens on `127.0.0.1` only and refuses any request not addressed to
`127.0.0.1` or `localhost` on its own port. `config.json` and the data directory
are read again on every page load, so a reload shows the current state. It does
not read `.env`: the Runs tab's checks and runs read it in their own processes,
and only names and results come back.

Looking never writes. The dashboard changes only these, all but one in the
data directory:

- the Lab's test renders and drafts under `output/lab/`, and `config.json`
  when you apply a draft;
- publish decisions, `output/publish-decisions.json`;
- the T-shirt shortlist, `output/tshirt/ideas.json`;
- the phrase report under `output/phrases/`, when you press Rescan;
- a run's record and log under `output/runs/`, and whatever the pipeline run
  itself writes, Convex included, when you start one from the Runs tab.

Those requests need a token made when the server starts and must come from
the dashboard's own page.

- **Today**: what needs you (rendered clips with no publish decision, episodes
  waiting on Cowork with their validation result and last error, a phrase report
  older than `ignore.txt`, transcripts with no SEO file or state entry), archive
  figures, and the twelve most recent episodes with a bar per stage.
- **Episode**: the stage strip, the three Cowork files with the validator's
  result and warnings, the SEO title against its 60-character limit, and the
  movies with each host's rating. The episode's mp3 plays when it is in
  `episodes/`.
- **Clips**: one episode's rendered picks, each with a player, and Cowork's
  candidates that were not rendered, published ones first in each list.
  "Published…" takes the Short's YouTube URL or ID, "Skip…" an optional
  reason, and "Skip the rest…" skips every rendered clip still undecided;
  marking again replaces the earlier decision.
  A Short whose clip is gone can be recorded by its label. These are the calls
  `scripts/publish_decisions.py` makes (see
  [Publish decisions](#publish-decisions)); the page can do nothing the script
  cannot. A clip longer than every Short published so far is marked. "Open in
  Lab" puts the Lab on that pick or candidate when the episode's mp3 is in
  `episodes/`; a candidate has no still, so its test render needs a new
  background.
- **Shirts**: the T-shirt shortlist as a board (ideas, shortlisted, designing,
  done; rejected ones folded away) and the three places a phrase can come
  from: the recurring-phrase report by its lists, with each phrase's episode
  count and span; Cowork's picks in each episode's shirts file; and your own
  `output/tshirt/ideas.txt`, which is read and never changed. "Shortlist"
  copies a phrase to the list. "Ignore…" adds a phrase of the report to
  `output/phrases/ignore.txt` (not while a rescan runs); it is marked ignored
  until the next Rescan leaves it out. Each idea has the text to print, an origin
  (original, quote, not checked), the work a quote is from, and notes.
  Licensing flags are shown beside every phrase and idea; nothing is blocked
  (see [T-shirt shortlist](#t-shirt-shortlist)). "Hear it" plays the phrase
  when the episode's mp3 is in `episodes/`. "Rescan" runs
  `scripts/scan_phrases.py` (about 20 s).
- **Settings**: every setting with its value, default, where the value comes
  from, and the stage that reads it; a config check listing settings the code
  reads that `config.json` leaves out and keys nothing reads. Settings are
  changed in a **draft**: a named set of overrides that only the Lab uses.
  "Apply to config.json" writes a draft's values into `config.json` and shows
  `git diff -- config.json`; it never commits. A draft can hold only settings
  the clip stage reads, and never one that names a program to run.
- **Lab**: renders one clip with a draft and plays it beside the real clip.
  Pick an episode that has its mp3, a clip, and a draft. The render reuses the
  clip's real still, so it makes no image request and costs nothing; it takes
  about as long as the clip is short. The window can be changed for the test.
  "New background" asks the image model for a new still with the prompt you
  give it. With the `openrouter` or `openai` provider that is one paid request,
  and you are asked before it is sent. Past renders are listed with the draft
  that made them and can be deleted.
- **Runs**: starts `pipeline.py` and shows its log as it runs. Three kinds:
  unattended (no episode: the newest in Azure, as `scheduled_pipeline.sh` runs
  it), one local episode from a stage, and resume after Cowork (from `movies`,
  for an episode whose Cowork files are written, or any waiting episode when
  headless Cowork is on). Check runs the checks of `scripts/check_run.py`, plus
  "no other dashboard run is active"; Run makes them again, then asks you to
  confirm the exact command, because every run reaches `publish`, which writes
  to Convex. One run at a time. Exit 75 shows as handed to Cowork, never as a
  failure. Stop ends the run and everything it started. Each run is kept as
  `output/runs/<id>.json` and `<id>.log`; the log passes through
  `scripts/redacted_run.py`, so it holds no `.env` value. A run started in a
  terminal is not seen by these checks. The page runs the code of the checkout
  the dashboard was started from, so the importer's Node packages must be
  installed there (`pnpm install` at the repository root).

A Lab render is the pipeline's own clip stage: `pipeline.py <episode> --config
<run config> --only clip`, where the run config is `config.json` plus the draft
with every output path pointed at `output/lab/<run id>/`. That folder also
holds a one-clip SEO file, so the episode's real clip, SEO file and
`state.json` are never touched. Only the clip stage runs in the Lab;
`import_transcript` and `publish` are refused by the server.

Stage status is worked out from the files each stage leaves
(`lib/stage_status.py`). `import_transcript` and `publish` leave no local file,
so their last run in the stage journal decides: finished, or failed (with the
error). An episode with no journaled run of them, such as one processed before
the journal existed, falls back to `state.json`, drawn outlined rather than
solid. An episode `state.json` seeded from an existing SEO file shows `publish`
as unknown, since nothing recorded whether it was published. The Convex target
in the header is the result of the Runs tab's last check since the server
started, or "not checked".

### Stage journal

`pipeline.py` appends one line to `output/journal/<episode>.jsonl` as each
stage it runs ends (`lib/stage_journal.py`): the stage, `done`, `failed`,
`awaiting_cowork`, `dry_run` (an import with `--dry-run`) or `interrupted`
(Ctrl-C), when it started and finished, and for a failure the error, with every
`.env` value replaced by its name. A run that is killed, including by the Runs
tab's Stop, writes nothing for the stage it was in.
A journal that cannot be written prints a warning and never stops the run.

## Configuration

`config.json` controls paths, models, and thresholds. Every setting is declared
in `lib/settings_schema.py` with its type, default, limits, and the stage that
reads it; the stages take their defaults from there. How a rendered clip looks
is settings too: the `caption_*` settings (font, size, colour, outline,
margins, how words are grouped and timed, and whether they appear whole or word
by word) and `clip_zoom_amount`. Their
defaults are what the clipper always did. Environment variables (`.env`) store
secrets:

Judgment (reviewed movies, SEO, clip choice) comes only from Cowork; the
pipeline makes no text-model calls of its own. With `settings.cowork_headless`
on it starts that Cowork job itself through the Claude Code CLI (see below).
The only hosted model the pipeline calls is the clip-background image model,
configured through `settings.visuals_provider`.

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
resumes with `--from movies` once both files exist. Cowork also writes
`<stem>.shirts.json`, the episode's T-shirt phrases, each flagged as the
hosts' own words or a quote. That file is information for Tony: the validator
checks it, no stage reads it, and the pipeline never waits for it. Details and the authoring
rules Cowork follows:
[`docs/cowork-handoff.md`](docs/cowork-handoff.md).

`settings.cowork_headless` (on in `config.json`) makes the pipeline write those
files itself instead of stopping: before `movies` it runs `claude -p` with the
same instructions, limited to writing in `output/cowork/` and running the
validator, and continues when the files are there. It needs the Claude Code
CLI on `PATH`, signed in, and prints nothing while it works (the limit is
`settings.cowork_headless_timeout_seconds`). If the session fails, the run ends
with exit 75 as before.

Before the hand-off, by hand or headless, the pipeline listens to the
episode's mp3 for laughter (`lib/laughter_detector.py`, with the parameters
`scripts/laughter_autotune.py` kept) and writes the times to
`output/laughter/<stem>.laughter.json`. The headless session gets them in its
prompt; `--pending` lists the file for Cowork by hand. They mark stretches to
read closely, not clips: the detector hears loud, quick sound, and always
reports up to 20 moments. It runs once per episode (delete the file to run it
again), takes about 15 s and 8 GB of memory for a two-hour episode, and never
stops a run: without the mp3 or librosa, or when it fails, Cowork works
without it. `settings.cowork_laughter_hints` set to `false` turns it off. Show knowledge (hosts, rating
scale, segments, what Tony publishes) lives in [`docs/show-format.md`](docs/show-format.md).

```bash
python pipeline.py episodes/20260914.mp3 --from movies      # resume after Cowork
python3 scripts/validate_cowork_outputs.py --pending        # what is waiting on Cowork
python3 scripts/validate_cowork_outputs.py 20260914         # check one episode's files (hard rules + warnings)
                                                            # shirts: OK, FAIL, or "not written (optional)"
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
clip's window and headline, so they survive deleting the rendered files. In
`report`, `undecided` counts every pick with no decision and `toReview` counts
only those whose rendered file is still on disk.

`publish` needs the Short's address, and `rest` can only be skipped, since
each published Short has its own. The episode is its date (`20261005`).
`list` ends with how long the published Shorts have run so far. The
dashboard's Clips tab records the same decisions through the same function
(`publish_log.decide`).

## Recurring phrases

`scripts/scan_phrases.py` scans every `transcripts/<YYYYMMDD>.json` for phrases
that recur across episodes: catchphrases, running gags (a burst over
consecutive episodes), and pre-recorded drops and rituals (long identical
passages). It is the starting list for T-shirt ideas; deciding what is
original versus a movie quote, and what belongs on a shirt, stays a human or
Cowork call (Cowork's per-episode picks go in `output/cowork/<stem>.shirts.json`).
Standard library only; about 20 s and 550 MB for 340 transcripts.

```bash
python3 scripts/scan_phrases.py               # rescan everything after a backfill
python3 scripts/scan_phrases.py --top 200     # longer lists in the report
```

It writes `output/phrases/recurring-phrases.md` (readable lists, plus what is
new since the previous scan) and `recurring-phrases.json` (every phrase with
its episodes and timestamped examples). Ordinary English that slips through
(the scan has no outside English baseline) goes in `output/phrases/ignore.txt`,
one phrase per line; later scans skip it. A passage is skipped when a line
matches its whole text (case and punctuation don't matter). The Shirts tab's
"Ignore…" and `scripts/shirt_ideas.py ignore "<phrase>"` add a line for a
phrase of the report, keeping the lines and comments already there. The "Staples" section is where the
show's biggest catchphrases and everyday English look alike, so review it once.

## T-shirt shortlist

`scripts/shirt_ideas.py` keeps the phrases Tony is considering for shirts in
`output/tshirt/ideas.json`. The dashboard's Shirts tab is the same list; both
go through `lib/shirt_ideas.py`, and a change holds `.ideas.json.lock` beside it
so neither overwrites the other. Standard library only.

```bash
python3 scripts/shirt_ideas.py list                         # every idea, with its flags
python3 scripts/shirt_ideas.py add "Pain train" --print "PAIN TRAIN"
python3 scripts/shirt_ideas.py scan staples --find dollar   # browse the phrase report by its lists
python3 scripts/shirt_ideas.py add-scan "we ride together"  # shortlist a phrase from the report
python3 scripts/shirt_ideas.py ignore "first time"          # add it to output/phrases/ignore.txt
python3 scripts/shirt_ideas.py episode 20261012             # Cowork's picks for an episode
python3 scripts/shirt_ideas.py add-episode 20261012 3       # shortlist pick 3
python3 scripts/shirt_ideas.py notes                        # the lines of ideas.txt, by line number
python3 scripts/shirt_ideas.py add-note 6                   # add one (ideas.txt is never changed)
python3 scripts/shirt_ideas.py set 4 --status designing --origin quote --source "Bad Boys II"
python3 scripts/shirt_ideas.py remove 4
```

Each idea has the phrase as spoken, the text to print, an origin (`original`,
`quote`, or `unsure` until someone has checked), the work a quote is from, a
status (`idea`, `shortlisted`, `designing`, `done`, `rejected`), notes, and
where it came from (the phrase scan with its episode count and span, an
episode's shirts file, a line of `ideas.txt`, or typed in). A phrase is listed
once, whatever its case and punctuation, and an idea's number is never reused.

Lines starting with `!` are licensing flags. They are information; nothing is
blocked and the decision is Tony's:

- **Quote**: the idea is recorded as someone else's line, with its source.
- **Origin not checked**: nobody has looked yet. The scan cannot tell a
  catchphrase from a movie quote, so everything promoted from it starts here.
- **Known quote**: the words match a line `docs/show-format.md` credits to a
  film ("I'd buy that for a dollar", *RoboCop*). The list is `KNOWN_QUOTES`
  in `lib/shirt_ideas.py`.
- **Names a real person**: the phrase or the text to print contains `Slater`
  or `Goldblum` (also "gold bloom", as transcripts spell it). Both rating
  names are real people's surnames.
- **Likely title or name**: the scan filed the phrase under titles and names.

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
declarations, the Clerk M2M/Convex boundary, visual-prompt safety, backfill
error handling, the settings schema (every key the code reads is declared), stage
status, the Lab (drafts, run folders, what it refuses), a pinned copy of the
default caption file and ffmpeg command, publish decisions and their script,
the T-shirt shortlist and its script, the checks before a run and the wrapper
that keeps `.env` values out of its log, run records, and the dashboard's views
and server. Runs are tested with stand-in commands; no test starts `pipeline.py`.

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
├── tshirt/                   # ideas.json, the shortlist (scripts/shirt_ideas.py); ideas.txt, Tony's notes
├── review-clips/<episode>/   # Audio clips from review segments
├── laughter/                 # <episode>.laughter.json for Cowork; laughter_autotune.py results
├── lab/                      # dashboard Lab: drafts/ and one folder per test render
├── runs/                     # dashboard Runs: <id>.json and <id>.log per pipeline run
├── journal/<episode>.jsonl   # one line per stage pipeline.py ran (lib/stage_journal.py)
├── thumbnails/<episode>.png  # Episode thumbnail (posters + logo)
```

## Architecture Notes

- **Transcriber** uses Parakeet (MLX) by default or `faster-whisper` with int8 quantization, with resume support and a trailing-silence-aware coverage gate
- **Movie extractor** matches Cowork's titles (and original titles) to the Convex catalog, preferring the episode's assigned movies
- **Laughter detector** (`lib/laughter_detector.py`) runs before the Cowork hand-off; `lib/laughter_hints.py` writes the times it hears for Cowork
- **Clipper** uses ffmpeg with ASS subtitle burn-in and Ken Burns zoom; requires `ffmpeg-full` (Homebrew) for libass support. Captions are cut into chunks of at most two lines (measured in the caption font, 32 characters max; all `caption_*` settings) on word timings and punctuation; transcripts without `words` get proportional timings, which also merges Whisper's one- and two-word fragments. `caption_style` picks how a caption appears: `chunk` (whole, the default), `pop` (each word fades in, in its final place, as it is said) or `highlight` (whole, with the word being said in `caption_highlight_color`); try one on a clip in the Lab before changing `config.json`
- **Convex client** uses the documented Functions API with bearer authentication, runtime response validation, typed errors, bounded retries, and cached Clerk M2M JWT refresh
- **Pipeline identity** must be pre-provisioned with `pipeline:publish`; the Clerk pipeline machine must be scoped to the receiver machine configured as `CLERK_M2M_AUDIENCE`
- **Backfill** processes Azure Blob episodes with a Rich dashboard and idempotent Convex episode creation from MP3 ID3 tags
