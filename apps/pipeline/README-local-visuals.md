# Local Visuals Workflow

## Goal
Generate vertical clip backgrounds locally, then animate them with ffmpeg and burn subtitles from transcript timing.

## Default mode
`config.json` now defaults to:
- `settings.visuals_provider = "local"`
- `settings.local_visual_model = "stabilityai/sdxl-turbo"`
- `settings.local_visual_script = "./scripts/generate_local_visual.py"`

## First-run setup
```bash
cd apps/pipeline
source venv/bin/activate
pip install -r requirements.txt
```

## Dry-run smoke test
This does not require diffusers or a GPU. It writes a placeholder image so you can verify pipeline plumbing.

```bash
python scripts/generate_local_visual.py \
  --prompt "A cracked film reel orbiting a black hole, surreal cult-movie dread, amber and indigo light, no people or text" \
  --output output/visuals/test.png \
  --dry-run
```

## Generate clips for an episode
```bash
python pipeline.py 20100227.mp3 --only clip
```

## Audio fade-out
`settings.clip_audio_fade_out_seconds` controls a short fade at each rendered
clip boundary. The default is `0.8`; set it to `0` to disable the fade. Values
must be finite numbers: invalid values fall back to the default and emit a
warning rather than reaching ffmpeg as an invalid filter.

## Output locations
- backgrounds: `output/visuals/<episode>/`
- rendered clips: `output/clips/<episode>/`

## Notes
- ffmpeg must be installed and available on PATH (use a build with libass / `subtitles` filter for burned captions; see Homebrew `ffmpeg-full`).
- Run `pipeline.py` with the **same activated venv** as `pip install -r requirements.txt` so `generate_local_visual` uses `torch` / `diffusers`. If those imports fail, the script **exits with an error** instead of silently writing a placeholder—unless you pass `--allow-placeholder` (e.g. CI) or use `--dry-run`.
- Set `settings.local_visual_reuse_cached_still` to `true` in `config.json` to skip regenerating PNGs when `output/visuals/<episode>/*.png` already exists (faster iteration). Default is `false` so deleting clips and re-running still refreshes stills instead of reusing an old placeholder.
- Subtitle timing is derived from Whisper transcript segments inside `transcripts/<episode>.json`.
