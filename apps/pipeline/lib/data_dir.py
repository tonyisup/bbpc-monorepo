"""Where the pipeline keeps episodes, transcripts, and output.

That data lives outside the checkout so every worktree shares it and no git
command can remove it. Standard library only: the Cowork validator imports this
without the pipeline venv.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict

ENV_VAR = "BBPC_PIPELINE_DATA_DIR"
DEFAULT_DATA_DIR = "~/bbpc-pipeline-data"


def data_dir() -> Path:
    return Path(os.environ.get(ENV_VAR) or DEFAULT_DATA_DIR).expanduser().resolve()


def require_data_dir() -> Path:
    """Stop rather than start an empty data directory and reprocess every episode."""
    path = data_dir()
    if not path.is_dir():
        raise SystemExit(
            f"Pipeline data directory not found: {path}\n"
            f"Create it, or set {ENV_VAR} to the directory holding episodes/, transcripts/, and output/."
        )
    return path


def _anchor(root: Path, value: Any) -> Any:
    if not isinstance(value, str) or not value:
        return value
    path = Path(value).expanduser()
    return str(path if path.is_absolute() else root / path)


def resolve_data_paths(config: Dict[str, Any]) -> Dict[str, Any]:
    """Anchor relative ``paths`` entries and ``settings.cowork_outputs_dir`` to the data directory."""
    root = data_dir()
    paths = config.get("paths")
    if isinstance(paths, dict):
        for key, value in paths.items():
            paths[key] = _anchor(root, value)
    settings = config.get("settings")
    if isinstance(settings, dict) and settings.get("cowork_outputs_dir"):
        settings["cowork_outputs_dir"] = _anchor(root, settings["cowork_outputs_dir"])
    return config
