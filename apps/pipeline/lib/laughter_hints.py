"""Laughter timestamps for Cowork: where the episode's audio sounds like laughing.

``lib/laughter_detector.py`` listens to the episode's mp3 for bursts that sound
like laughter. Before the hand-off, pipeline.py runs it and writes
``<output_dir>/laughter/<stem>.laughter.json``:

    {"episode": {"stem": "20261012"}, "generatedAt": "...", "params": {...},
     "moments": [{"at": 812.4, "score": 0.71}]}

``at`` is seconds into the episode and ``score`` the detector's 0-1 score;
moments are in time order. The headless session gets the times in its prompt,
and ``validate_cowork_outputs.py --pending`` lists the file. They tell Cowork
where to read closely: the detector hears loud, quick sound, not jokes.

The detector uses the parameters ``scripts/laughter_autotune.py`` kept
(``output/laughter/best_params.json``), or its own defaults.

Standard library only, apart from ``detect``, which needs the pipeline venv.
"""
from __future__ import annotations

import datetime as _dt
import importlib.util
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from lib import settings_schema


def laughter_dir(config: Dict[str, Any]) -> Path:
    return Path(config.get("paths", {}).get("output_dir", "./output")) / "laughter"


def hints_path(config: Dict[str, Any], stem: str) -> Path:
    return laughter_dir(config) / f"{stem}.laughter.json"


def enabled(config: Dict[str, Any]) -> bool:
    settings = config.get("settings") if isinstance(config.get("settings"), dict) else {}
    return settings_schema.value(settings, "cowork_laughter_hints") is True


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def tuned_params(config: Dict[str, Any]) -> Dict[str, Any]:
    """The parameters laughter_autotune.py kept, or none (the detector's defaults)."""
    best = _read_json(laughter_dir(config) / "best_params.json")
    params = best.get("params") if isinstance(best, dict) else None
    return params if isinstance(params, dict) else {}


def write(config: Dict[str, Any], stem: str, detections: List[Dict[str, Any]], params: Dict[str, Any]) -> Dict[str, Any]:
    """Save the peak and score of each detection, in time order, and return what was saved."""
    moments = sorted(
        ({"at": round(float(d["peak"]), 1), "score": round(float(d["score"]), 2)} for d in detections),
        key=lambda moment: moment["at"],
    )
    hints = {
        "episode": {"stem": stem},
        "generatedAt": _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat(),
        "params": params,
        "moments": moments,
    }
    path = hints_path(config, stem)
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".partial")
    partial.write_text(json.dumps(hints, indent=2) + "\n", encoding="utf-8")
    os.replace(partial, path)
    return hints


def load(config: Dict[str, Any], stem: str) -> Optional[List[Dict[str, Any]]]:
    """The episode's laugh moments; an empty list when none were heard, None with no readable file."""
    hints = _read_json(hints_path(config, stem))
    moments = hints.get("moments") if isinstance(hints, dict) else None
    return moments if isinstance(moments, list) else None


def detect(config: Dict[str, Any], stem: str, audio_path: Path) -> Optional[Dict[str, Any]]:
    """Listen to the episode and write its moments. None, and no file, when librosa is missing."""
    # Without librosa the detector reports no laughs, which is not the same as none heard.
    if importlib.util.find_spec("librosa") is None:
        print("Laughter hints skipped: librosa is not installed (run from the pipeline venv).")
        return None
    from lib import laughter_detector
    params = tuned_params(config)
    return write(config, stem, laughter_detector.detect_laughter(audio_path, params=params), params)
