# Podcast Clip Automation Project Plan

## Goal
Automate the production of 5 high-energy "Hormozi-style" vertical clips (30-60s) from weekly podcast episodes, featuring AI-generated backgrounds and automatic captions.

## Tech Stack
- **Transcription:** `faster-whisper-large-v3-turbo` with resume support.
- **Analysis:** Claude Cowork reads the full transcript and writes reviewed movies, SEO, clip choices, and T-shirt phrases (`docs/cowork-handoff.md`); the pipeline makes no text-model calls.
- **Visuals:** Gemini Flash Image via OpenRouter by default; direct OpenAI and local SDXL-Turbo remain supported alternatives.
- **Rendering:** Python (Pillow) for caption burn-in and FFMPEG for final encoding.
- **Storage:** Azure Blob Storage for raw episodes.
- **Application data:** Convex through the least-privilege pipeline service API.

## Current Status
- ✅ **Infrastructure:** Azure Blob and authenticated Convex boundaries integrated, including short-lived Clerk M2M JWT refresh.
- ✅ **Transcription:** Full-length transcription with resume logic and coverage tracking.
- ✅ **Movie Extraction:** Cowork judgment matched to Convex movie IDs (heuristic/LLM extraction retired).
- ✅ **Review Clipping:** Audio clip generation from movie-review evidence windows.
- ✅ **SEO Analysis + Clip Selection:** Cowork writes titles, descriptions, keywords, and 20 clip candidates.
- ✅ **Clip Generation:** Fully automated rendering of vertical videos with AI backgrounds and dynamic captions.
- ✅ **Metadata Sync:** Idempotent SEO metadata updates through Convex.
- ✅ **Backfill:** Batch processing with retry logic and Rich dashboard.
- ✅ **Brand Logo:** Composited onto clip backgrounds.
- ✅ **Laughter Detection:** Run before the Cowork hand-off; its timestamps go to Cowork as places to read closely (`output/laughter/<stem>.laughter.json`).
- ✅ **Thumbnail Generation:** 1920x1920 episode thumbnails from reviewed movie posters + BBPC logo.
- ✅ **Dashboard:** Local page (`python3 -m dashboard`) with Today, Episode, Clips, Shirts, the clip Lab (which can publish a clip to YouTube), Runs and Settings.
- ✅ **T-shirt shortlist:** `output/tshirt/ideas.json`, kept by `scripts/shirt_ideas.py` and the dashboard's Shirts tab, with licensing flags.

## Completed Tasks
- [x] Implement `lib/transcriber.py` with resume support.
- [x] Implement `lib/parser.py` with clip analysis and image prompt generation.
- [x] Implement `lib/clipper.py` with Pillow-based frame rendering and ffmpeg animation.
- [x] Implement `lib/publisher.py` for exact, idempotent Convex SEO updates.
- [x] Implement `backfill.py` for batch processing with retry logic and dashboard.
- [x] Implement `lib/movie_extractor.py` — heuristic + LLM movie extraction.
- [x] Implement `lib/review_clipper.py` — review evidence clip generation.
- [x] Implement `lib/laughter_detector.py` — audio laughter detection.
- [x] Implement brand logo overlay in clipper.
- [x] Implement MP3 ID3 tag reading for backfill episode insertion.
- [x] Implement `lib/thumbnail.py` — episode poster thumbnails from bounded Convex poster lookups + logo overlay.
- [x] Add `thumbnail` pipeline stage to `pipeline.py`.

## Next Steps / Backlog
- [x] Retire the heuristic/LLM fallback and the diarize placeholder; Cowork is the only judgment path.
- [x] Record publish decisions (`scripts/publish_decisions.py`), seeded with the Shorts published through ep 794.
- [x] Recurring-phrase scanner across all transcripts (`scripts/scan_phrases.py`), re-run after backfills.
- [x] **T-shirt finder:** per-episode Cowork phrases with original/quote flags (`output/cowork/<stem>.shirts.json`, checked by the validator, never gates the pipeline).
- [x] **Headless Cowork:** with `settings.cowork_headless` on, the pipeline runs the hand-off itself through `claude -p` (`lib/cowork_headless.py`) instead of stopping with exit 75.
- [x] **Dashboard, change 1:** read-only server, Today, Episode and Settings tabs; settings schema (`lib/settings_schema.py`) and stage status from local files (`lib/stage_status.py`).
- [x] **Dashboard, change 2 (Lab):** settings drafts and one-clip test renders under `output/lab/`; the caption rules and the zoom are settings (`caption_*`, `clip_zoom_amount`).
- [x] **Dashboard, change 3 (Shirts):** shortlist file (`lib/shirt_ideas.py`, `scripts/shirt_ideas.py`) and a board over the phrase scan, the per-episode shirts files and `ideas.txt`; Rescan button; licensing flags.
- [x] **Dashboard, change 4 (Clips):** review rendered clips and record publish decisions from the page, through `publish_log.decide`, the function the script now uses too.
- [x] **Dashboard, change 5 (Runs):** start and watch pipeline runs, checked first (`scripts/check_run.py`), one at a time, logged under `output/runs/` through `scripts/redacted_run.py`; the only part that can write to Convex.
- [x] **Stage journal:** `pipeline.py` records each stage it runs in `output/journal/<episode>.jsonl` (`lib/stage_journal.py`), so `import_transcript` and `publish` status is known rather than inferred from `state.json`.
- [ ] **T-shirt report:** shirts files for past episodes, so the Shirts tab has Cowork's picks for the back catalogue. (The cross-episode list joined with the phrase scan is the Shirts tab.)
- [x] **Shirts tab, ignore from the page:** "Ignore…" on a phrase of the report, and `scripts/shirt_ideas.py ignore`, add it to `output/phrases/ignore.txt` (`phrase_scan.add_ignored`); the next Rescan leaves it out.
- [x] **Laughter → Cowork:** before the hand-off the pipeline writes the detector's times to `output/laughter/<stem>.laughter.json` (`lib/laughter_hints.py`); the headless prompt carries them and `--pending` lists the file.
- [x] **Advanced Captions:** `caption_style` `pop` (each word appears as it is said) and `highlight` (the word being said in `caption_highlight_color`) follow the word timings; `chunk` stays the default, and a Lab draft can try either.
- [x] **YouTube upload:** the Lab's "Publish to YouTube" uploads a finished test render as a private video (`lib/youtube_upload.py`, `scripts/youtube_upload.py`, one-time sign-in with `scripts/youtube_auth.py`) and records it as published.
- [ ] **Social Upload:** TikTok and Instagram.
- [ ] **Web Integration:** Sync clip paths to the Next.js frontend content directory.

## Maintenance
- Ensure `.env` is used for all secrets.
- Monitor OpenRouter and direct OpenAI image usage for cost control.
- Episodes, transcripts, and output live in `BBPC_PIPELINE_DATA_DIR`, outside the repository; never commit them.
