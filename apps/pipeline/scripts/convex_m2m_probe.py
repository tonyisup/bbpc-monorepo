"""Read-only readiness probe for the BBPC pipeline Clerk/Convex boundary."""
from __future__ import annotations

import argparse
import base64
import io
import json
import sys
import time
from contextlib import redirect_stdout
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Mapping

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from lib.convex_client import (
    ClerkM2MTokenProvider,
    ConvexFunctionError,
    ConvexPipelineClient,
    ConvexPipelineError,
)
from lib.runtime_config import (
    get_clerk_m2m_audience,
    get_clerk_m2m_refresh_margin_seconds,
    get_clerk_m2m_token_ttl_seconds,
    get_convex_max_attempts,
    get_convex_timeout_seconds,
    get_convex_url,
    resolve_convex_pipeline_auth,
)


@dataclass(frozen=True)
class M2MIdentity:
    issuer: str
    subject: str
    token_identifier: str
    expires_at: int


def _decode_segment(segment: str) -> object:
    padding = "=" * (-len(segment) % 4)
    try:
        payload = base64.urlsafe_b64decode(
            f"{segment}{padding}".encode("ascii")
        )
        return json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, json.JSONDecodeError) as exc:
        raise ValueError("The Clerk M2M JWT payload is invalid.") from exc


def _required_claim(claims: Mapping[str, object], name: str) -> str:
    value = claims.get(name)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"The Clerk M2M JWT is missing its {name} claim.")
    return value.strip()


def decode_m2m_identity(
    token: str,
    *,
    expected_audience: str,
    now_seconds: int | None = None,
) -> M2MIdentity:
    """Decode provisioning metadata; never use this as signature validation."""
    parts = token.strip().split(".")
    if len(parts) != 3:
        raise ValueError("The Clerk M2M credential is not a JWT.")
    payload = _decode_segment(parts[1])
    if not isinstance(payload, dict):
        raise ValueError("The Clerk M2M JWT payload must be an object.")
    claims: Mapping[str, object] = payload
    issuer = _required_claim(claims, "iss")
    subject = _required_claim(claims, "sub")
    audience = claims.get("aud")
    audiences = (
        [audience]
        if isinstance(audience, str)
        else audience
        if isinstance(audience, list)
        else []
    )
    if expected_audience not in audiences:
        raise ValueError(
            "The Clerk M2M JWT does not target the configured Convex receiver."
        )
    expires_at = claims.get("exp")
    if (
        isinstance(expires_at, bool)
        or not isinstance(expires_at, int)
        or expires_at <= (now_seconds if now_seconds is not None else int(time.time()))
    ):
        raise ValueError("The Clerk M2M JWT is expired or lacks a valid expiry.")
    return M2MIdentity(
        issuer=issuer,
        subject=subject,
        token_identifier=f"{issuer}|{subject}",
        expires_at=expires_at,
    )


def _access_token() -> str:
    token, machine_secret = resolve_convex_pipeline_auth()
    if token is not None:
        return token
    if machine_secret is None:
        raise AssertionError("Pipeline authentication resolution returned no credential.")
    ttl_seconds = get_clerk_m2m_token_ttl_seconds()
    provider = ClerkM2MTokenProvider(
        machine_secret_key=machine_secret,
        ttl_seconds=ttl_seconds,
        refresh_margin_seconds=get_clerk_m2m_refresh_margin_seconds(
            ttl_seconds
        ),
    )
    return provider()


def _client(token: str) -> ConvexPipelineClient:
    return ConvexPipelineClient(
        deployment_url=get_convex_url(),
        access_token=token,
        timeout_seconds=get_convex_timeout_seconds(),
        max_attempts=get_convex_max_attempts(),
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Mint or load a Clerk M2M JWT, print only the identity metadata "
            "needed for provisioning, and optionally run read-only Convex probes."
        )
    )
    parser.add_argument(
        "--claims-only",
        action="store_true",
        help="Decode provisioning metadata without calling Convex.",
    )
    parser.add_argument(
        "--date",
        help=(
            "After provisioning, read one exact YYYY-MM-DD episode context. "
            "The probe reports only presence and relationship counts."
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.claims_only and args.date is not None:
        raise ValueError("--claims-only cannot be combined with --date.")

    with redirect_stdout(io.StringIO()):
        token = _access_token()
    identity = decode_m2m_identity(
        token,
        expected_audience=get_clerk_m2m_audience(),
    )
    output: dict[str, object] = {
        "identity": asdict(identity),
        "token_exposed": False,
    }

    if not args.claims_only:
        client = _client(token)
        permissions = client.capabilities()
        read_probe: dict[str, object] = {
            "capabilities": list(permissions),
        }
        if args.date is not None:
            context = client.get_episode_context_by_date(args.date)
            read_probe.update(
                {
                    "episode_found": context is not None,
                    "related_movie_count": (
                        0 if context is None else len(context[1])
                    ),
                }
            )
        output["read_probe"] = read_probe

    print(json.dumps(output, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ConvexFunctionError as exc:
        print(
            json.dumps(
                {
                    "status": "failed",
                    "error_type": type(exc).__name__,
                    "error_code": exc.code,
                    "token_exposed": False,
                },
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        raise SystemExit(1) from None
    except (ConvexPipelineError, ValueError) as exc:
        print(
            json.dumps(
                {
                    "status": "failed",
                    "error_type": type(exc).__name__,
                    "token_exposed": False,
                },
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        raise SystemExit(1) from None
