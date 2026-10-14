from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

from dotenv import dotenv_values, load_dotenv

from lib.data_dir import data_dir, resolve_data_paths

_CONFIG_ENV_LOADED = False
DEFAULT_CONFIG_PATH = Path("config.json")
PIPELINE_ROOT = Path(__file__).resolve().parents[1]


class MissingEnvironmentVariableError(RuntimeError):
    """Raised when a required environment variable is not set."""


def _ensure_env_loaded() -> None:
    global _CONFIG_ENV_LOADED
    if _CONFIG_ENV_LOADED:
        return
    # The checkout's .env loads first so it can set BBPC_PIPELINE_DATA_DIR, which
    # then selects the shared one. A value that is already set is never replaced.
    loaded = False
    for locate in (lambda: PIPELINE_ROOT / ".env", lambda: data_dir() / ".env"):
        env_path = locate()
        if env_path.is_file():
            load_dotenv(env_path)
            print(f"[ENV] Loaded {env_path}")
            loaded = True
    if not loaded:
        print("[ENV] WARNING: No .env file found")

    _CONFIG_ENV_LOADED = True


def env_files() -> List[Path]:
    """The ``.env`` files the pipeline loads, in the order it loads them."""
    _ensure_env_loaded()  # the checkout's may set BBPC_PIPELINE_DATA_DIR, which places the other
    return [path for path in (PIPELINE_ROOT / ".env", data_dir() / ".env") if path.is_file()]


def secret_values(names: Iterable[str] = ()) -> List[Tuple[str, str]]:
    """Every value set in the ``.env`` files, and the environment's value for each of their keys
    and ``names``, as (key, value) pairs, so that output can be scrubbed of them
    (``lib.redaction``). Only for this process's own use: never print or send them.
    """
    pairs = set()
    keys = set(names)
    for path in env_files():
        for key, value in dotenv_values(path).items():
            keys.add(key)
            if value:
                pairs.add((key, value))
    pairs.update((key, os.environ[key]) for key in keys if os.environ.get(key))
    return sorted(pairs)


def load_config(path: str | Path = DEFAULT_CONFIG_PATH) -> Dict[str, Any]:
    _ensure_env_loaded()  # apps/pipeline/.env may set BBPC_PIPELINE_DATA_DIR.
    config_path = Path(path).expanduser()
    with config_path.open(encoding="utf-8") as f:
        return resolve_data_paths(json.load(f))


def get_required_env(name: str) -> str:
    _ensure_env_loaded()
    value = os.environ.get(name)
    if value:
        return value
    raise MissingEnvironmentVariableError(
        f"Required environment variable {name} is not set. Add it to .env or export it in your shell."
    )


def get_openai_api_key() -> str:
    return get_required_env("OPENAI_API_KEY")


def get_openai_base_url() -> str:
    _ensure_env_loaded()
    url = (os.environ.get("OPENAI_BASE_URL") or "").strip()
    return url


def get_openrouter_api_key() -> str:
    return get_required_env("OPENROUTER_API_KEY")


def get_openrouter_api_url() -> str:
    """OpenRouter base URL (OpenAI-compatible). Defaults to https://openrouter.ai/api/v1."""
    _ensure_env_loaded()
    url = (os.environ.get("OPENROUTER_API_URL") or "").strip()
    return url if url else "https://openrouter.ai/api/v1"


def _coerce_positive_float(value: Any, *, label: str) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be numeric, got {value!r}") from exc
    if parsed <= 0:
        raise ValueError(f"{label} must be greater than zero, got {parsed!r}")
    return parsed


def resolve_llm_request_timeout(
    settings: Dict[str, Any] | None,
    *,
    operation: str | None = None,
) -> float:
    """
    Resolve request timeout for hosted image-model calls.

    Precedence:
    1. settings["<operation>_timeout_seconds"] or settings["<operation>_timeout"]
    2. settings["llm_timeout_seconds"] or settings["llm_timeout"]
    3. env "<OPERATION>_TIMEOUT_SECONDS"/"<OPERATION>_TIMEOUT"
    4. env "LLM_TIMEOUT_SECONDS"/"LLM_TIMEOUT"
    5. 300 seconds
    """
    _ensure_env_loaded()
    s = settings or {}

    setting_keys: list[str] = []
    env_keys: list[str] = []
    if operation:
        op = operation.strip().lower()
        op_env = op.upper()
        setting_keys.extend([f"{op}_timeout_seconds", f"{op}_timeout"])
        env_keys.extend([f"{op_env}_TIMEOUT_SECONDS", f"{op_env}_TIMEOUT"])
    setting_keys.extend(["llm_timeout_seconds", "llm_timeout"])
    env_keys.extend(["LLM_TIMEOUT_SECONDS", "LLM_TIMEOUT"])

    for key in setting_keys:
        if s.get(key) is not None:
            return _coerce_positive_float(s[key], label=key)

    for key in env_keys:
        value = os.environ.get(key)
        if value not in (None, ""):
            return _coerce_positive_float(value, label=key)

    return 300.0


def get_azure_connection_string() -> str:
    return get_required_env("AZURE_STORAGE_CONNECTION_STRING")


def get_convex_url() -> str:
    return get_required_env("CONVEX_URL").strip().rstrip("/")


def get_convex_pipeline_token() -> str:
    return get_required_env("CONVEX_PIPELINE_TOKEN").strip()


def resolve_convex_pipeline_auth() -> tuple[str | None, str | None]:
    """Return exactly one configured pipeline credential.

    A direct JWT is useful for one-off local probes. A Clerk machine secret lets
    long-running jobs mint and refresh short-lived JWTs without persisting them.
    """
    _ensure_env_loaded()
    token = (os.environ.get("CONVEX_PIPELINE_TOKEN") or "").strip() or None
    machine_secret = (
        os.environ.get("CLERK_MACHINE_SECRET_KEY") or ""
    ).strip() or None
    if token is not None and machine_secret is not None:
        raise ValueError(
            "Set exactly one of CONVEX_PIPELINE_TOKEN or "
            "CLERK_MACHINE_SECRET_KEY, not both"
        )
    if token is None and machine_secret is None:
        raise MissingEnvironmentVariableError(
            "Set CONVEX_PIPELINE_TOKEN for a one-off JWT or "
            "CLERK_MACHINE_SECRET_KEY for automatic M2M JWT refresh."
        )
    return token, machine_secret


def get_clerk_m2m_audience() -> str:
    """Return the Clerk receiver-machine ID expected in the M2M JWT audience."""
    audience = get_required_env("CLERK_M2M_AUDIENCE").strip()
    if not audience.startswith("mch_") or len(audience) > 200:
        raise ValueError(
            "CLERK_M2M_AUDIENCE must be a Clerk receiver machine ID"
        )
    return audience


def get_clerk_m2m_token_ttl_seconds() -> int:
    _ensure_env_loaded()
    value = (os.environ.get("CLERK_M2M_TOKEN_TTL_SECONDS") or "900").strip()
    try:
        ttl = int(value)
    except ValueError as exc:
        raise ValueError(
            "CLERK_M2M_TOKEN_TTL_SECONDS must be an integer"
        ) from exc
    if ttl < 60 or ttl > 3600:
        raise ValueError(
            "CLERK_M2M_TOKEN_TTL_SECONDS must be between 60 and 3600"
        )
    return ttl


def get_clerk_m2m_refresh_margin_seconds(ttl_seconds: int) -> int:
    _ensure_env_loaded()
    value = (
        os.environ.get("CLERK_M2M_REFRESH_MARGIN_SECONDS") or "60"
    ).strip()
    try:
        margin = int(value)
    except ValueError as exc:
        raise ValueError(
            "CLERK_M2M_REFRESH_MARGIN_SECONDS must be an integer"
        ) from exc
    if margin < 1 or margin >= ttl_seconds:
        raise ValueError(
            "CLERK_M2M_REFRESH_MARGIN_SECONDS must be positive and "
            "less than the token TTL"
        )
    return margin


def get_convex_timeout_seconds() -> float:
    _ensure_env_loaded()
    value = (os.environ.get("CONVEX_TIMEOUT_SECONDS") or "30").strip()
    return _coerce_positive_float(value, label="CONVEX_TIMEOUT_SECONDS")


def get_convex_max_attempts() -> int:
    _ensure_env_loaded()
    value = (os.environ.get("CONVEX_MAX_ATTEMPTS") or "3").strip()
    try:
        attempts = int(value)
    except ValueError as exc:
        raise ValueError("CONVEX_MAX_ATTEMPTS must be an integer") from exc
    if attempts < 1 or attempts > 5:
        raise ValueError("CONVEX_MAX_ATTEMPTS must be between 1 and 5")
    return attempts
