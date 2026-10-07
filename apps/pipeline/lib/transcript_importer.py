"""Import a completed transcript through the backend package's guarded CLI."""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

from lib.convex_client import ClerkM2MTokenProvider
from lib.runtime_config import (
    get_clerk_m2m_refresh_margin_seconds,
    get_clerk_m2m_token_ttl_seconds,
    get_convex_url,
    resolve_convex_pipeline_auth,
)


def _command() -> list[str]:
    # apps/pipeline/lib -> monorepo root
    root = Path(__file__).resolve().parents[3]
    script = root / "packages/convex-backend/local-tools/transcripts/pipeline.mjs"
    if not script.is_file():
        raise RuntimeError(f"Transcript importer not found at {script}.")
    return [os.environ.get("BBPC_NODE_BINARY") or "node", "--experimental-strip-types", str(script)]


def _execute(args: list[str], env: dict[str, str]) -> None:
    try:
        subprocess.run([*_command(), *args], env=env, check=True)
    except FileNotFoundError:
        raise RuntimeError("Transcript imports require Node.js 22.6.0+ on PATH (or BBPC_NODE_BINARY).") from None
    except subprocess.CalledProcessError:
        raise RuntimeError("Transcript import failed; see the importer message above. The local transcript was kept.") from None


def check_configuration() -> None:
    """Check the pinned target and local CLI before starting expensive stages."""
    url = get_convex_url()  # Loads .env before copying the environment.
    resolve_convex_pipeline_auth()  # Validate credential selection without minting.
    _execute(["--url", url, "--check-config"], os.environ.copy())


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
