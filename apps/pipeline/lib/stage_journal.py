"""What pipeline.py did with each stage it ran: one line per stage run, written as the stage ends.

The journal is ``<output_dir>/journal/<stem>.jsonl``. Each line is a JSON object:

    {"stage": "publish", "outcome": "done", "startedAt": "...", "finishedAt": "...", "detail": "..."}

``outcome`` is one of ``OUTCOMES``: ``done``; ``failed`` (``detail`` has the
error, with every ``.env`` value already replaced by its name);
``awaiting_cowork`` (the stage stopped for the Cowork hand-off); ``dry_run``
(an import that wrote nothing); ``interrupted`` (Ctrl-C). A run that is
killed outright writes nothing for the stage it was in.

``import_transcript`` and ``publish`` write only to Convex, so this is the one
local record that they ran (``lib/stage_status.py``). Lines are only ever
appended. Standard library only: the dashboard reads it.
"""
from __future__ import annotations

import datetime as _dt
import json
from pathlib import Path
from typing import Any, Dict, List, Optional

OUTCOMES = ("done", "failed", "awaiting_cowork", "dry_run", "interrupted")


def journal_path(config: Dict[str, Any], stem: str) -> Path:
    return Path(config.get("paths", {}).get("output_dir", "./output")) / "journal" / f"{stem}.jsonl"


def now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat()


def record(config: Dict[str, Any], stem: str, stage: str, outcome: str, *, started_at: str,
           finished_at: Optional[str] = None, detail: Optional[str] = None) -> Dict[str, Any]:
    """Append one stage run to the episode's journal and return it."""
    if outcome not in OUTCOMES:
        raise ValueError(f"outcome must be one of {', '.join(OUTCOMES)}, not {outcome!r}")
    entry = {"stage": stage, "outcome": outcome, "startedAt": started_at, "finishedAt": finished_at or now()}
    if detail:
        entry["detail"] = detail
    path = journal_path(config, stem)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")  # one write: lines never interleave
    return entry


def entries(config: Dict[str, Any], stem: str) -> List[Dict[str, Any]]:
    """Every stage run journaled for ``stem``, oldest first. A line cut short by a crash is skipped."""
    path = journal_path(config, stem)
    if not path.is_file():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if isinstance(row, dict) and isinstance(row.get("stage"), str) and row.get("outcome") in OUTCOMES:
            rows.append(row)
    return rows
