# Podcast Clip Automation Project Plan

## Goal
Automate the production of 5 high-energy "Hormozi-style" vertical clips (30-60s) from weekly podcast episodes, featuring AI-generated backgrounds and automatic captions.

## Tech Stack
- **Transcription:** `faster-whisper-large-v3-turbo` with resume support.
- **Analysis:** GPT-5.6 Terra (via OpenRouter) for SEO, clip segment identification, and LLM-assisted movie extraction.
- **Visuals:** Gemini Flash Image via OpenRouter by default; direct OpenAI and local SDXL-Turbo remain supported alternatives.
- **Rendering:** Python (Pillow) for caption burn-in and FFMPEG for final encoding.
- **Storage:** Azure Blob Storage for raw episodes.
- **Application data:** Convex through the least-privilege pipeline service API.

## Current Status
- ✅ **Infrastructure:** Azure Blob and authenticated Convex boundaries integrated, including short-lived Clerk M2M JWT refresh.
- ✅ **Transcription:** Full-length transcription with resume logic and coverage tracking.
- ✅ **Movie Extraction:** Heuristic + LLM hybrid extraction with evidence windows.
- ✅ **Review Clipping:** Audio clip generation from movie-review evidence windows.
- ✅ **SEO Analysis:** GPT-5.6 Terra generates titles, descriptions, and keywords.
- ✅ **Clip Selection:** AI identifies high-impact 30-60s segments with image-model prompts.
- ✅ **Clip Generation:** Fully automated rendering of vertical videos with AI backgrounds and dynamic captions.
- ✅ **Metadata Sync:** Idempotent SEO metadata updates through Convex.
- ✅ **Backfill:** Batch processing with retry logic and Rich dashboard.
- ✅ **Brand Logo:** Composited onto clip backgrounds.
- ✅ **Laughter Detection:** Audio-based laugh moment detection for clip candidates.
- ✅ **Parser Resilience:** Retry logic, timeout overrides, clip-transcript alignment.
- ✅ **Thumbnail Generation:** 1920x1920 episode thumbnails from reviewed movie posters + BBPC logo.

## Completed Tasks
- [x] Implement `lib/transcriber.py` with resume support.
- [x] Implement `lib/parser.py` with clip analysis and image prompt generation.
- [x] Implement `lib/clipper.py` with Pillow-based frame rendering and ffmpeg animation.
- [x] Implement `lib/publisher.py` for exact, idempotent Convex SEO updates.
- [x] Implement `backfill.py` for batch processing with retry logic and dashboard.
- [x] Implement `lib/movie_extractor.py` — heuristic + LLM movie extraction.
- [x] Implement `lib/movie_extractor_llm_ext.py` — LLM-only and hybrid full-transcript modes.
- [x] Implement `lib/review_clipper.py` — review evidence clip generation.
- [x] Implement `lib/laughter_detector.py` — audio laughter detection.
- [x] Implement brand logo overlay in clipper.
- [x] Implement stratified transcript sampling in parser.
- [x] Implement clip-to-transcript alignment in parser.
- [x] Implement per-operation LLM timeout overrides.
- [x] Implement MP3 ID3 tag reading for backfill episode insertion.
- [x] 60 tests passing across all modules.
- [x] Implement `lib/thumbnail.py` — episode poster thumbnails from bounded Convex poster lookups + logo overlay.
- [x] Add `thumbnail` pipeline stage to `pipeline.py`.

## Next Steps / Backlog
- [ ] **Diarization:** Implement speaker identification (currently placeholder).
- [ ] **Advanced Captions:** Move to word-level timestamps for more dynamic "pop-in" caption styles.
- [ ] **Social Upload:** Integrate automated upload to TikTok/Instagram/YouTube APIs.
- [ ] **Web Integration:** Sync clip paths to the Next.js frontend content directory.

## Maintenance
- Ensure `.env` is used for all secrets.
- Monitor OpenRouter and direct OpenAI image usage for cost control.
- Episodes, transcripts, and output live in `BBPC_PIPELINE_DATA_DIR`, outside the repository; never commit them.
