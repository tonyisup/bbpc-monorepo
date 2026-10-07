# Local Visuals Pipeline Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace hosted image generation in the clip stage with a local still-image workflow that generates 1–3 vertical backgrounds per clip and animates them into short-form video with captions.

**Architecture:** Keep transcript analysis in `lib/parser.py`, but treat `clipAnalysis[].imagePrompt` as a seed prompt rather than a final provider-specific prompt. Move visual creation into `lib/clipper.py` with a provider abstraction that supports a new `local` mode. In local mode, generate still frames through a local Diffusers-backed script, build a slow zoom/pan video bed in ffmpeg, burn ASS subtitles, and mux the original audio segment.

**Tech Stack:** Python, Pillow, ffmpeg, local Diffusers-compatible image generation script, unittest.

---

### Task 1: Add test coverage for local visual prompt and subtitle helpers

**Objective:** Lock down the deterministic pieces before changing clip rendering.

**Files:**
- Create: `tests/test_clipper_local_visuals.py`
- Modify: `lib/clipper.py`

**Step 1: Write failing test**
- Assert `_build_visual_prompt()` appends a house style suffix.
- Assert `_select_clip_segments()` trims transcript spans to the clip window.
- Assert `_build_ass_subtitles()` emits relative ASS timestamps.

**Step 2: Run test to verify failure**
Run: `source venv/bin/activate && python -m unittest tests/test_clipper_local_visuals.py -v`
Expected: FAIL with missing helper attributes.

**Step 3: Write minimal implementation**
- Add deterministic helpers in `lib/clipper.py`.
- Keep them independent from network/model calls.

**Step 4: Run test to verify pass**
Run the same unittest command.
Expected: PASS.

**Step 5: Commit**
`git commit -m "test: cover local clipper helper logic"`

### Task 2: Introduce local visual provider scaffolding

**Objective:** Make clip generation choose between hosted and local image generation without changing the rest of the pipeline contract.

**Files:**
- Modify: `lib/clipper.py`
- Modify: `config.json`
- Modify: `.env.example`
- Modify: `requirements.txt`

**Step 1: Write failing test**
- Add a test that verifies local provider config produces a deterministic command plan or raises a clear error when local model configuration is missing.

**Step 2: Run test to verify failure**
Run the targeted unittest.
Expected: FAIL.

**Step 3: Write minimal implementation**
- Add config keys like:
  - `settings.visuals_provider = "local"`
  - `settings.local_visual_model = "stabilityai/sdxl-turbo"` or similar
  - `settings.local_visual_script = "./scripts/generate_local_visual.py"`
- Add a `_generate_background_image_local()` path that shells out to the script.
- Keep OpenAI/Google provider support intact as fallback.

**Step 4: Run tests to verify pass**
Run targeted tests.

**Step 5: Commit**
`git commit -m "feat: add local visual provider scaffolding"`

### Task 3: Add a local image generation script

**Objective:** Provide a single script the pipeline can call to render one still image from a prompt.

**Files:**
- Create: `scripts/generate_local_visual.py`
- Create: `tests/test_generate_local_visual_script.py`

**Step 1: Write failing test**
- Verify CLI arg parsing.
- Verify dry-run / prompt file writing behavior if the model is unavailable.

**Step 2: Run test to verify failure**
Run the specific unittest.

**Step 3: Write minimal implementation**
- Accept args: `--prompt`, `--output`, `--model`, `--width`, `--height`, `--steps`, `--seed`
- Load a Diffusers pipeline lazily.
- Save a PNG.
- Support a `--dry-run` mode so CI/dev environments can validate plumbing without a GPU run.

**Step 4: Run test to verify pass**
Run targeted unittest.

**Step 5: Commit**
`git commit -m "feat: add local visual generation script"`

### Task 4: Replace static-frame concat with animated background video + ASS subtitles

**Objective:** Upgrade output quality from repeated PNG frames to a real animated background with subtitle burn-in.

**Files:**
- Modify: `lib/clipper.py`
- Create: `tests/test_clipper_ffmpeg_plan.py`

**Step 1: Write failing test**
- Assert the ffmpeg filter plan includes:
  - scale/crop to 1080x1920
  - a slow zoompan
  - ASS subtitle overlay
  - audio muxing

**Step 2: Run test to verify failure**
Run targeted unittest.

**Step 3: Write minimal implementation**
- Build an intermediate background video from the still image.
- Generate `.ass` subtitle text from transcript segments.
- Burn subtitles via `ffmpeg -vf ass=...`.
- Use original clip audio slice.

**Step 4: Run test to verify pass**
Run targeted unittest.

**Step 5: Commit**
`git commit -m "feat: animate local visuals and burn subtitles"`

### Task 5: Add user-facing docs and operational guardrails

**Objective:** Make the local workflow runnable without reading source.

**Files:**
- Modify: `PLAN.md`
- Create: `README-local-visuals.md` or extend `PLAN.md`
- Modify: `.env.example`

**Step 1: Document prerequisites**
- ffmpeg installed
- local Python env active
- model selection guidance for Apple Silicon

**Step 2: Document commands**
- `python pipeline.py <episode>.mp3 --only clip`
- direct visual generation script invocation

**Step 3: Document fallback behavior**
- dry-run mode
- how to switch back to hosted providers

**Step 4: Commit**
`git commit -m "docs: add local visuals workflow"`

---

## Recommended first runnable target

Use local still generation only, one image per clip, with:
- vertical 1080x1920 output
- slow zoom/pan animation
- ASS captions
- original audio segment

Do not add multi-image parallax or scene sequencing until this baseline works end-to-end.
