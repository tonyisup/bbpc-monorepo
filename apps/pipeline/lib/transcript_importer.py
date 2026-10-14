"""Import a completed transcript through the backend package's guarded CLI."""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

from lib.convex_client import ClerkM2MTokenProvider
from lib.runtime_config import (
    get_clerk_m2m_refresh_margin_seconds,
    get_clerk_m2m_token_ttl_seconds,
    get_convex_url,
    resolve_convex_pipeline_auth,
)


def node_binary() -> str:
    return os.environ.get("BBPC_NODE_BINARY") or "node"


def _command() -> list[str]:
    # apps/pipeline/lib -> monorepo root
    root = Path(__file__).resolve().parents[3]
    script = root / "packages/convex-backend/local-tools/transcripts/pipeline.mjs"
    if not script.is_file():
        raise RuntimeError(f"Transcript importer not found at {script}.")
    return [node_binary(), "--experimental-strip-types", str(script)]


def _failure(exc: subprocess.CalledProcessError) -> str:
    """What the importer said when it failed: its message, or the error line of a Node stack trace."""
    lines = [line.strip() for line in (exc.stderr or exc.stdout or "").splitlines() if line.strip()]
    error = next((line for line in lines if re.match(r"\w*Error\b", line)), None)
    return error or " ".join(lines) or f"exit status {exc.returncode}"


def _execute(args: list[str], env: dict[str, str], capture: bool = False) -> str:
    """Run the importer. With ``capture`` its output is returned, and a failure carries its message."""
    try:
        done = subprocess.run([*_command(), *args], env=env, check=True, capture_output=capture, text=capture)
    except FileNotFoundError:
        raise RuntimeError("Transcript imports require Node.js 22.6.0+ on PATH (or BBPC_NODE_BINARY).") from None
    except subprocess.CalledProcessError as exc:
        if capture:
            raise RuntimeError(f"The importer's configuration check failed: {_failure(exc)}") from None
        raise RuntimeError("Transcript import failed; see the importer message above. The local transcript was kept.") from None
    return done.stdout if capture else ""


def check_configuration(capture: bool = False) -> str:
    """Check the pinned target and local CLI before starting expensive stages.

    With ``capture`` the importer's output is returned instead of printed. It
    names the target, a value from ``.env``: scrub it before showing it anywhere.
    """
    url = get_convex_url()  # Loads .env before copying the environment.
    resolve_convex_pipeline_auth()  # Validate credential selection without minting.
    return _execute(["--url", url, "--check-config"], os.environ.copy(), capture)


def run(context: dict) -> None:
    if context.get("transcript_complete") is not True:
        raise RuntimeError(
            "Transcript completion is unconfirmed. Finish transcription or, after "
            "reviewing the entire file, use --only import_transcript --confirm-complete."
        )
    url = get_convex_url()
    source = Path(context["transcript_path"]).expanduser().resolve()
    if not source.is_file():
        raise RuntimeError(f"Transcript file not found: {source}")
    token, secret = resolve_convex_pipeline_auth()
    if secret is not None:
        ttl = get_clerk_m2m_token_ttl_seconds()
        try:
            token = ClerkM2MTokenProvider(
                machine_secret_key=secret,
                ttl_seconds=ttl,
                refresh_margin_seconds=get_clerk_m2m_refresh_margin_seconds(ttl),
            )()
        except Exception:
            raise RuntimeError("Could not mint the pipeline JWT for transcript import.") from None
    env = os.environ.copy()
    env.pop("CLERK_MACHINE_SECRET_KEY", None)
    env["BBPC_PIPELINE_ACCESS_TOKEN"] = token or ""
    args = ["--source", str(source), "--recording-file", str(context["episode_path"]),
            "--url", url, "--confirm-complete"]
    if context.get("episode_id"):
        args.extend(["--episode-id", context["episode_id"]])
    if not context.get("transcript_dry_run", False):
        args.append("--apply")
    _execute(args, env)
    print("Transcript import dry run complete." if context.get("transcript_dry_run")
          else "Episode transcript is current in Convex.")
