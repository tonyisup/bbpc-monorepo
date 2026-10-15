"""Run the Cowork hand-off headlessly with the Claude Code CLI (``claude -p``).

``docs/cowork-handoff.md`` describes a job normally done by hand in Claude
Cowork. With ``settings.cowork_headless`` on, the pipeline starts the same job
itself: a non-interactive Claude Code session that follows that document,
writes the episode's files and runs the validator.

Nothing else changes. The ``movies`` and ``parse`` stages still load and
validate the files, so a run that fails, times out or is switched off leaves
the episode ``awaiting_cowork`` (exit 75) for a hand-off by hand.

Standard library only.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from lib import cowork_handoff, laughter_hints, run_checks, settings_schema
from lib.data_dir import ENV_VAR, data_dir

PIPELINE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_COMMAND = settings_schema.default("cowork_headless_command")
DEFAULT_TIMEOUT_SECONDS = settings_schema.default("cowork_headless_timeout_seconds")
VALIDATOR = "python3 scripts/validate_cowork_outputs.py"


def _settings(config: Dict[str, Any]) -> Dict[str, Any]:
    settings = config.get("settings") if isinstance(config, dict) else None
    return settings if isinstance(settings, dict) else {}


def enabled(config: Dict[str, Any]) -> bool:
    return _settings(config).get("cowork_headless") is True


def write_reading_copy(transcript_path: Path, dest: Path) -> Path:
    """Write the transcript as one ``start<TAB>end<TAB>text`` line per segment.

    The transcript JSON carries word timings and runs to megabytes, too large to
    read whole. Start and end are written exactly as the JSON has them, so they
    are the segment boundaries the validator checks windows against.
    """
    with transcript_path.open(encoding="utf-8") as f:
        segments = json.load(f)
    with dest.open("w", encoding="utf-8") as f:
        for seg in segments:
            text = " ".join(str(seg.get("text") or "").split())
            f.write(f"{seg.get('start')}\t{seg.get('end')}\t{text}\n")
    return dest


def build_prompt(config: Dict[str, Any], stem: str, reading_copy: Path, config_path: Optional[Path] = None) -> str:
    validate = f"{VALIDATOR} {stem}"
    if config_path is not None:
        validate += f" --config {config_path}"
    laughs = laughter_hints.load(config, stem)
    laughter = "" if not laughs else (
        f"\n   The laughter detector heard laughter at these seconds: {', '.join(str(m['at']) for m in laughs)}. "
        "It hears loud, quick sound, not jokes: read those stretches closely, and never pick a clip for a laugh alone."
    )
    return f"""You are doing the Cowork hand-off for BBPC episode {stem}, unattended. Nobody can answer questions, so finish the job or stop and say what blocked you.

1. Read docs/cowork-handoff.md and docs/show-format.md in full. They are the rules for this job. Skip the `--pending` step: the episode is {stem}.
2. Read the whole transcript at {reading_copy}. It has one segment per line: start seconds, end seconds and text, separated by tabs. Those start and end values are the exact segment boundaries your clip, evidence and phrase windows must use. Word timings are left out. Read every line; do not sample.{laughter}
3. Write {cowork_handoff.movies_path(config, stem)} and {cowork_handoff.seo_path(config, stem)}. Then run `{validate}` and fix every FAIL it reports until both are OK.
4. Write {cowork_handoff.shirts_path(config, stem)}, run the validator again and fix anything it reports under shirts.

If one of these files already exists, keep it when the validator passes it and rewrite it when it fails.
Write only those three files. Never edit state.json. The validator command above is the only shell command you may run.
End with the validator's final output and nothing else."""


def build_command(config: Dict[str, Any], add_dirs: List[Path]) -> List[str]:
    """The prompt goes on stdin: ``--add-dir`` and ``--allowedTools`` take several values each."""
    settings = _settings(config)
    command = [
        str(settings.get("cowork_headless_command") or DEFAULT_COMMAND),
        "-p",
        "--add-dir", *[str(path) for path in add_dirs],
        # Edits are accepted without asking, but only inside the pipeline
        # directory and --add-dir; the validator is the one shell command allowed.
        "--permission-mode", "acceptEdits",
        "--allowedTools", "Read", "Write", "Edit", f"Bash({VALIDATOR}:*)",
        # Leave the operator's own hooks, skills and MCP servers out of the run.
        "--setting-sources", "project",
        "--strict-mcp-config",
        "--disable-slash-commands",
    ]
    if settings.get("cowork_headless_model"):
        command += ["--model", str(settings["cowork_headless_model"])]
    return command


def session_env() -> Dict[str, str]:
    """The environment for the session: this process's, minus the pipeline's credentials.

    Those are what the pipeline's .env files set, and the credentials the
    pre-run checks know about, wherever they were set (Convex, Azure, image
    models). The hand-off needs none of them, only the data directory the
    validator reads.
    """
    env = {name: value for name, value in os.environ.items() if name not in run_checks.CREDENTIAL_NAMES}
    for env_file in (PIPELINE_ROOT / ".env", data_dir() / ".env"):
        if not env_file.is_file():
            continue
        for line in env_file.read_text(encoding="utf-8").splitlines():
            name = line.partition("=")[0].strip()
            if name.startswith("export "):
                name = name[len("export "):].strip()
            if name != ENV_VAR:
                env.pop(name, None)
    return env


def _timeout_seconds(config: Dict[str, Any]) -> float:
    try:
        value = float(_settings(config).get("cowork_headless_timeout_seconds") or DEFAULT_TIMEOUT_SECONDS)
    except (TypeError, ValueError):
        return DEFAULT_TIMEOUT_SECONDS
    return value if value > 0 else DEFAULT_TIMEOUT_SECONDS


def run(config: Dict[str, Any], stem: str, transcript_path: str | Path, config_path: Optional[Path] = None) -> bool:
    """Run the hand-off for one episode; return whether both required files now exist.

    Never raises for a run that did not work out (no CLI, no transcript, a
    failed or timed-out session): it says why and returns False, and the stage
    that follows stops with ``AwaitingCowork`` as it does without this module.
    """
    transcript = Path(transcript_path)
    if not transcript.is_file():
        print(f"Headless Cowork skipped: no transcript at {transcript}.")
        return False
    command_name = str(_settings(config).get("cowork_headless_command") or DEFAULT_COMMAND)
    if shutil.which(command_name) is None:
        print(f"Headless Cowork skipped: '{command_name}' is not on PATH.")
        return False

    out_dir = cowork_handoff.cowork_dir(config)
    out_dir.mkdir(parents=True, exist_ok=True)
    timeout = _timeout_seconds(config)
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="bbpc-cowork-") as tmp:
        work_dir = Path(tmp).resolve()
        reading_copy = write_reading_copy(transcript, work_dir / f"{stem}.transcript.tsv")
        prompt = build_prompt(config, stem, reading_copy, config_path)
        print(
            f"Running the Cowork hand-off for {stem} with `{command_name} -p`. "
            f"Nothing is printed until it finishes (limit {timeout / 60:.0f} min)."
        )
        try:
            result = subprocess.run(
                build_command(config, [out_dir, work_dir]),
                input=prompt, text=True, cwd=str(PIPELINE_ROOT), env=session_env(), timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            print(f"Headless Cowork stopped after {timeout / 60:.0f} min without finishing.")
            return False
        except OSError as exc:
            print(f"Headless Cowork could not start: {exc}")
            return False

    minutes = (time.monotonic() - started) / 60
    if result.returncode != 0:
        print(f"Headless Cowork exited with status {result.returncode} after {minutes:.1f} min.")
        return False
    if not cowork_handoff.outputs_ready(config, stem):
        print(f"Headless Cowork finished after {minutes:.1f} min without writing both files.")
        return False
    print(f"Headless Cowork wrote the files for {stem} in {minutes:.1f} min.")
    return True
