from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, Tuple

from dotenv import load_dotenv

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
    # Try multiple .env locations
    env_paths = [
        Path(".env"),
        Path("lib/.env"),
        PIPELINE_ROOT / ".env",
        data_dir() / ".env",
    ]
    for env_path in env_paths:
        if env_path.exists():
            load_dotenv(env_path)
            print(f"[ENV] Loaded {env_path}")
            break
    else:
        print("[ENV] WARNING: No .env file found")
    
    _CONFIG_ENV_LOADED = True


def load_config(path: str | Path = DEFAULT_CONFIG_PATH) -> Dict[str, Any]:
    _ensure_env_loaded()  # .env may set BBPC_PIPELINE_DATA_DIR.
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


def get_openrouter_model() -> str:
    return get_required_env("OPENROUTER_MODEL")


def normalize_ollama_openai_base_url(url: str) -> str:
    """Ollama exposes an OpenAI-compatible API under .../v1 (e.g. http://127.0.0.1:11434/v1)."""
    u = str(url).strip().rstrip("/")
    if u.endswith("/v1"):
        return u
    return f"{u}/v1"


def get_llm_provider_from_settings(settings: Dict[str, Any] | None) -> str:
    """Pipeline LLM backend: 'openrouter' (default) or 'ollama'."""
    _ensure_env_loaded()
    if settings and settings.get("llm_provider"):
        p = str(settings["llm_provider"]).strip().lower()
        if p:
            return p
    env_p = (os.environ.get("LLM_PROVIDER") or "").strip().lower()
    if env_p:
        return env_p
    return "openrouter"


def _coerce_positive_float(value: Any, *, label: str) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be numeric, got {value!r}") from exc
    if parsed <= 0:
        raise ValueError(f"{label} must be greater than zero, got {parsed!r}")
    return parsed


def resolve_pipeline_llm_endpoints(settings: Dict[str, Any] | None) -> Tuple[str, str]:
    """
    Return (base_url, api_key) for OpenAI-compatible chat completions.

    - openrouter: OPENROUTER_API_URL + OPENROUTER_API_KEY
    - ollama: OLLAMA_BASE_URL (default http://127.0.0.1:11434) + optional OLLAMA_API_KEY (dummy ok)
    """
    provider = get_llm_provider_from_settings(settings)
    if provider == "ollama":
        base = ""
        if settings and settings.get("ollama_base_url"):
            base = str(settings["ollama_base_url"]).strip()
        if not base:
            base = (os.environ.get("OLLAMA_BASE_URL") or "http://127.0.0.1:11434").strip()
        api_key = ""
        if settings and settings.get("ollama_api_key") is not None:
            api_key = str(settings["ollama_api_key"]).strip()
        if not api_key:
            api_key = (os.environ.get("OLLAMA_API_KEY") or "ollama-local").strip()
        return normalize_ollama_openai_base_url(base), api_key
    if provider != "openrouter":
        raise ValueError(
            f"Unknown llm_provider {provider!r}; use 'openrouter' or 'ollama' (or set LLM_PROVIDER)."
        )
    return get_openrouter_api_url(), get_openrouter_api_key()


def resolve_llm_request_timeout(
    settings: Dict[str, Any] | None,
    *,
    operation: str | None = None,
) -> float:
    """
    Resolve request timeout for OpenAI-compatible calls.

    Precedence:
    1. settings["<operation>_timeout_seconds"] or settings["<operation>_timeout"]
    2. settings["llm_timeout_seconds"] or settings["llm_timeout"]
    3. env "<OPERATION>_TIMEOUT_SECONDS"/"<OPERATION>_TIMEOUT"
    4. env "LLM_TIMEOUT_SECONDS"/"LLM_TIMEOUT"
    5. provider-aware default: ollama=900s, openrouter=300s
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

    provider = get_llm_provider_from_settings(s)
    return 900.0 if provider == "ollama" else 300.0


def resolve_seo_llm_model_name(settings: Dict[str, Any] | None) -> str:
    """Model id for parser/SEO: seo_model, then ollama_model / OLLAMA_MODEL, then OPENROUTER_MODEL."""
    s = settings or {}
    name = (s.get("seo_model") or s.get("ollama_model") or "").strip()
    if name:
        return name
    if get_llm_provider_from_settings(s) == "ollama":
        return (os.environ.get("OLLAMA_MODEL") or "gemma4").strip()
    return get_openrouter_model()

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
