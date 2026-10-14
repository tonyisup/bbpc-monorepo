"""What is checked before a pipeline run: ``scripts/check_run.py`` and the dashboard's Runs tab.

Runs in the pipeline's own process (the venv), which loads ``.env``. A
credential is reported by name and whether it is set, never by value, and
anything else said (the importer names its target) is scrubbed of every
``.env`` value before it is returned.
"""
from __future__ import annotations

import os
import re
import subprocess
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple

from lib import settings_schema
from lib.data_dir import data_dir
from lib.redaction import redact
from lib.stage_status import STAGES

NODE_MINIMUM = (22, 6)
CONVEX_SIGN_IN = ("CONVEX_PIPELINE_TOKEN", "CLERK_MACHINE_SECRET_KEY")  # exactly one of these
IMAGE_KEYS = {"openrouter": "OPENROUTER_API_KEY", "openai": "OPENAI_API_KEY"}
# Every credential a run can use, and what uses it.
CREDENTIALS: Tuple[Tuple[str, str], ...] = (
    ("CONVEX_URL", "Convex: import_transcript and publish"),
    ("CONVEX_PIPELINE_TOKEN", "Convex sign-in: this or CLERK_MACHINE_SECRET_KEY"),
    ("CLERK_MACHINE_SECRET_KEY", "Convex sign-in: this or CONVEX_PIPELINE_TOKEN"),
    ("AZURE_STORAGE_CONNECTION_STRING", "finding the newest episode, for an unattended run"),
    ("OPENROUTER_API_KEY", "clip backgrounds when visuals_provider is openrouter"),
    ("OPENAI_API_KEY", "clip backgrounds when visuals_provider is openai"),
)
CREDENTIAL_NAMES = tuple(name for name, _ in CREDENTIALS)
LIBASS_HINT = "no subtitles filter, so clips would have no captions; on Homebrew, brew install ffmpeg-full"
_VERSION = re.compile(r"v?(\d+)\.(\d+)\.(\d+)")


def stages_in_range(stage: Optional[str]) -> List[str]:
    """The stages a run may reach: all of them for an unattended run (None), else ``stage`` onwards."""
    if stage is None:
        return list(STAGES)
    if stage not in STAGES:
        raise ValueError(f"stage must be one of {', '.join(STAGES)}, not {stage!r}")
    return STAGES[STAGES.index(stage):]


def _needed(config: Dict[str, Any], stage: Optional[str]) -> set:
    stages = stages_in_range(stage)
    needed = set()
    if "import_transcript" in stages or "publish" in stages:
        needed.update(("CONVEX_URL", *CONVEX_SIGN_IN))
    if stage is None:
        needed.add("AZURE_STORAGE_CONNECTION_STRING")
    if "clip" in stages:
        provider = settings_schema.value(config.get("settings") or {}, "visuals_provider")
        needed.update([IMAGE_KEYS[provider]] if provider in IMAGE_KEYS else [])
    return needed


def credentials(config: Dict[str, Any], stage: Optional[str], environ: Mapping[str, str]) -> List[Dict[str, Any]]:
    """Each credential's name, whether it is set, and whether this run needs it. Never its value."""
    needed = _needed(config, stage)
    return [{"name": name, "set": bool((environ.get(name) or "").strip()), "needed": name in needed, "use": use}
            for name, use in CREDENTIALS]


def _missing(rows: List[Dict[str, Any]]) -> List[str]:
    unset = {row["name"] for row in rows if row["needed"] and not row["set"]}
    missing = []
    for row in rows:
        if row["name"] not in unset:
            continue
        if row["name"] in CONVEX_SIGN_IN:
            if set(CONVEX_SIGN_IN) <= unset and " or ".join(CONVEX_SIGN_IN) not in missing:
                missing.append(" or ".join(CONVEX_SIGN_IN))
        else:
            missing.append(row["name"])
    return missing


def node_version(node: str) -> Tuple[bool, str]:
    """Whether ``node`` runs and is new enough for the importer, and the version it reported."""
    try:
        done = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=30, check=False)
    except OSError:
        return False, f"not found: {node}"
    except subprocess.TimeoutExpired:
        return False, f"{node} --version did not answer"
    said = (done.stdout or "").strip()
    match = _VERSION.fullmatch(said)
    if done.returncode != 0 or not match:
        return False, f"{node} --version said {said or 'nothing'!r} (exit {done.returncode})"
    if tuple(int(part) for part in match.groups()[:2]) < NODE_MINIMUM:
        return False, f"{said}: the importer needs {NODE_MINIMUM[0]}.{NODE_MINIMUM[1]} or newer"
    return True, said


def _check(check_id: str, label: str, ok: bool, detail: str) -> Dict[str, Any]:
    return {"id": check_id, "label": label, "ok": ok, "detail": detail}


def run_all(config: Dict[str, Any], stage: Optional[str] = None, *, environ: Optional[Mapping[str, str]] = None,
            secrets: Optional[Sequence[Tuple[str, str]]] = None, configuration: Optional[Callable[[], str]] = None,
            has_libass: Optional[Callable[[], bool]] = None, node: Optional[str] = None) -> Dict[str, Any]:
    """Every check, in order, for a run from ``stage`` (None: an unattended run).

    The defaults are the pipeline's own: ``.env`` loaded into the environment,
    ``transcript_importer.check_configuration``, the clip stage's libass test
    and the importer's Node. Tests pass stand-ins.
    """
    from lib import runtime_config, transcript_importer  # they load .env, which only the pipeline's process may

    if environ is None:
        runtime_config.env_files()  # loads .env, as a run would
        environ = os.environ
    if secrets is None:
        secrets = runtime_config.secret_values(CREDENTIAL_NAMES)
    configuration = configuration or (lambda: transcript_importer.check_configuration(capture=True))
    if has_libass is None:
        from lib import clipper
        has_libass = clipper._ffmpeg_has_subtitles_filter  # the test the clip stage itself makes
    node = node or transcript_importer.node_binary()

    stages_in_range(stage)  # refuse an unknown stage before running anything
    checks = []
    folder = data_dir()
    checks.append(_check("data_dir", "Data directory exists", folder.is_dir(),
                         str(folder) if folder.is_dir() else f"not found: {folder}"))
    try:
        said = " ".join(configuration().split())
        checks.append(_check("configuration", "check_configuration() passes", True, said or "passed"))
    except Exception as exc:  # what it raises says what is wrong; nothing else is shown
        checks.append(_check("configuration", "check_configuration() passes", False, " ".join(str(exc).split())))
    rows = credentials(config, stage, environ)
    missing = _missing(rows)
    checks.append(_check("credentials", "Credentials are present", not missing,
                         f"not set: {', '.join(missing)}" if missing else "every one this run needs is set"))
    libass = bool(has_libass())
    checks.append(_check("ffmpeg", "ffmpeg has libass", libass, "subtitles filter found" if libass else LIBASS_HINT))
    checks.append(_check("node", f"Node is {NODE_MINIMUM[0]}.{NODE_MINIMUM[1]} or newer", *node_version(node)))
    for check in checks:
        check["detail"] = redact(check["detail"], secrets)
    return {"ok": all(check["ok"] for check in checks), "stage": stage, "checks": checks, "credentials": rows}
