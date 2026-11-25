"""Parallax backgrounds: a clip's still becomes a seamless 2.5D loop rendered in Blender.

Depth Anything V2 estimates how far away each pixel is. Blender
(``scripts/blender_parallax_scene.py``) places every pixel along its camera ray at that
depth, so the camera at rest sees exactly the still, then drifts the camera and adds
haze, dust and a little light flicker. Every motion repeats once per loop, so the clip
stage can repeat the loop for a clip of any length and lay the logo and captions on top.

The loop is cached next to the still. Its name carries a key made from the loop settings,
the scene script and the depth model, so changing any of them renders a new one.
"""
from __future__ import annotations

import hashlib
import importlib.util
import logging
import os
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, List, Mapping, Optional, Tuple

from lib import settings_schema

logger = logging.getLogger(__name__)

DEPTH_MODEL = "depth-anything/Depth-Anything-V2-Base-hf"
DEPTH_INPUT_SIZE = 518  # the model was trained at 518 px
DEPTH_PACKAGES = ("torch", "transformers")
SCENE_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "blender_parallax_scene.py"
BLENDER_TIMEOUT_SECONDS = 1800  # about 2.5 min for a 10 s loop on an M4 Pro


@dataclass(frozen=True)
class LoopOptions:
    seconds: float
    drift: float
    dust: int
    haze: float

    def scene_args(self) -> List[str]:
        return ["--seconds", str(self.seconds), "--drift", str(self.drift),
                "--dust", str(self.dust), "--haze", str(self.haze)]


def options(settings: Mapping[str, Any]) -> LoopOptions:
    return LoopOptions(
        seconds=float(settings_schema.value(settings, "parallax_loop_seconds")),
        drift=float(settings_schema.value(settings, "parallax_camera_drift")),
        dust=int(settings_schema.value(settings, "parallax_dust")),
        haze=float(settings_schema.value(settings, "parallax_haze")),
    )


def loop_path(still: Path, opts: LoopOptions, size: Tuple[int, int, int]) -> Path:
    """Where the loop for ``still`` with these options and (width, height, fps) is cached."""
    key = hashlib.sha256()
    key.update(repr((opts, size, DEPTH_MODEL)).encode())
    key.update(SCENE_SCRIPT.read_bytes())
    return still.with_name(f"{still.stem}_parallax-{key.hexdigest()[:10]}.mp4")


def estimate_depth(image_path: Path, out_path: Path) -> None:
    """Write ``out_path`` (.npy, float32, H x W): 0 for the farthest pixel, 1 for the nearest."""
    import numpy as np
    import torch
    from PIL import Image
    from transformers import AutoModelForDepthEstimation

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    net = AutoModelForDepthEstimation.from_pretrained(DEPTH_MODEL).to(device).eval()
    with Image.open(image_path) as im:
        image = im.convert("RGB")
    # The model's own preprocessing (DPTImageProcessor), done here so it needs no
    # torchvision: keep the aspect ratio, short side about 518, both sides multiples of 14.
    scale = DEPTH_INPUT_SIZE / min(image.width, image.height)
    w = max(14, round(image.width * scale / 14) * 14)
    h = max(14, round(image.height * scale / 14) * 14)
    pixels = np.asarray(image.resize((w, h), Image.Resampling.BICUBIC), dtype=np.float32) / 255.0
    pixels = (pixels - np.array([0.485, 0.456, 0.406], dtype=np.float32)) / np.array([0.229, 0.224, 0.225], dtype=np.float32)
    batch = torch.from_numpy(pixels.transpose(2, 0, 1)[None].copy()).to(device)
    with torch.no_grad():
        predicted = net(pixel_values=batch).predicted_depth
    depth = torch.nn.functional.interpolate(
        predicted[:, None].float().cpu(), size=(image.height, image.width), mode="bicubic", align_corners=False,
    )[0, 0].numpy()
    # The model predicts relative inverse depth; spread it over 0..1, ignoring stray extremes.
    lo, hi = np.percentile(depth, [0.5, 99.5])
    np.save(out_path, np.clip((depth - lo) / max(float(hi - lo), 1e-6), 0.0, 1.0).astype(np.float32))


def blender_binary(settings: Mapping[str, Any]) -> Path:
    return Path(settings_schema.value(settings, "blender_path")).expanduser()


def setup(settings: Mapping[str, Any]) -> Tuple[bool, str]:
    """Whether Blender and the depth model's packages are there, and which Blender it is."""
    blender = blender_binary(settings)
    if not os.access(blender, os.X_OK):
        return False, f"Blender not found at {blender}; install it or set blender_path"
    try:
        done = subprocess.run([str(blender), "-b", "--factory-startup", "--version"], capture_output=True,
                              text=True, timeout=60, check=False, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, f"{blender} --version failed: {exc}"
    said = next((line.split(" (")[0].strip() for line in (done.stdout or "").splitlines()
                 if line.startswith("Blender ")), "")  # "Blender 5.0.1", without the build hash
    if done.returncode != 0 or not said:
        return False, f"{blender} --version did not report a Blender version (exit {done.returncode})"
    missing = [name for name in DEPTH_PACKAGES if importlib.util.find_spec(name) is None]
    if missing:
        return False, f"{said}, but the venv lacks {', '.join(missing)}: pip install -r requirements.txt"
    return True, f"{said} at {blender}"


def _tail(text: Optional[str], lines: int = 8) -> str:
    kept = [line for line in (text or "").splitlines() if line.strip() and not line.startswith("Fra:")]
    return "\n".join(kept[-lines:])


def render_loop(still: Path, settings: Mapping[str, Any], *, width: int, height: int, fps: int) -> Optional[Path]:
    """The parallax loop for ``still`` (cached, or rendered now); None if it cannot be made."""
    opts = options(settings)
    loop = loop_path(still, opts, (width, height, fps))
    if loop.is_file() and loop.stat().st_mtime >= still.stat().st_mtime:
        print(f"  Reusing parallax loop {loop.name}")
        return loop
    blender = blender_binary(settings)
    if not os.access(blender, os.X_OK):
        logger.error("Blender not found at %s; set blender_path or background_motion to zoom", blender)
        return None
    print(f"  Rendering a {opts.seconds:g} s parallax loop in Blender")
    # A hidden working folder beside the still: same disk, and nothing half-written keeps the loop's name.
    with tempfile.TemporaryDirectory(dir=still.parent, prefix=".parallax-") as work_dir:
        work = Path(work_dir)
        try:
            estimate_depth(still, work / "depth.npy")
        except Exception as exc:  # a missing package, a failed model download or an unreadable still
            logger.error("Depth estimation failed for %s: %s", still.name, exc)
            return None
        partial = work / "loop.mp4"
        # Without --python-exit-code, Blender exits 0 even when the scene script raises.
        cmd = [str(blender), "-b", "--factory-startup", "--python-exit-code", "1", "-P", str(SCENE_SCRIPT), "--",
               "--image", str(still.resolve()), "--depth", str(work / "depth.npy"), "--out", str(partial),
               "--width", str(width), "--height", str(height), "--fps", str(fps), *opts.scene_args()]
        try:
            subprocess.run(cmd, check=True, capture_output=True, text=True, stdin=subprocess.DEVNULL,
                           timeout=BLENDER_TIMEOUT_SECONDS)
        except subprocess.CalledProcessError as exc:
            logger.error("Blender failed for %s:\n%s", still.name, _tail(exc.stderr) or _tail(exc.stdout))
            return None
        except subprocess.TimeoutExpired:
            logger.error("Blender took longer than %d s for %s", BLENDER_TIMEOUT_SECONDS, still.name)
            return None
        except OSError as exc:
            logger.error("Could not start Blender at %s: %s", blender, exc)
            return None
        if not partial.is_file() or partial.stat().st_size == 0:
            logger.error("Blender wrote no loop for %s", still.name)
            return None
        os.replace(partial, loop)
    return loop
