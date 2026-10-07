from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import ModuleType

import pytest


def load_probe() -> ModuleType:
    path = (
        Path(__file__).resolve().parents[1]
        / "scripts"
        / "convex_m2m_probe.py"
    )
    spec = spec_from_file_location("convex_m2m_probe", path)
    assert spec is not None
    assert spec.loader is not None
    module = module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def jwt(payload: object) -> str:
    def encode(value: object) -> str:
        raw = json.dumps(value, separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

    return f"{encode({'alg': 'none'})}.{encode(payload)}.unsigned"


def test_decodes_only_bounded_provisioning_identity() -> None:
    probe = load_probe()

    identity = probe.decode_m2m_identity(
        jwt(
            {
                "iss": "https://issuer.example.test",
                "sub": "machine_pipeline",
                "aud": ["mch_convex", "other"],
                "exp": 2_000,
                "private": "must-not-escape",
            }
        ),
        expected_audience="mch_convex",
        now_seconds=1_000,
    )

    assert identity.issuer == "https://issuer.example.test"
    assert identity.subject == "machine_pipeline"
    assert (
        identity.token_identifier
        == "https://issuer.example.test|machine_pipeline"
    )
    assert identity.expires_at == 2_000
    assert "private" not in vars(identity)


def test_claims_only_cli_never_prints_token_or_unrelated_claims() -> None:
    token = jwt(
        {
            "iss": "https://issuer.example.test",
            "sub": "machine_pipeline",
            "aud": "mch_convex",
            "exp": 4_102_444_800,
            "private": "must-not-escape",
        }
    )
    environment = os.environ.copy()
    environment["CONVEX_PIPELINE_TOKEN"] = token
    environment["CLERK_M2M_AUDIENCE"] = "mch_convex"
    environment["CLERK_MACHINE_SECRET_KEY"] = ""

    result = subprocess.run(
        [
            sys.executable,
            "scripts/convex_m2m_probe.py",
            "--claims-only",
        ],
        check=False,
        capture_output=True,
        text=True,
        env=environment,
    )

    assert result.returncode == 0, result.stderr
    assert token not in result.stdout
    assert "must-not-escape" not in result.stdout
    assert result.stderr == ""
    output = json.loads(result.stdout)
    assert output["token_exposed"] is False
    assert output["identity"]["subject"] == "machine_pipeline"


@pytest.mark.parametrize(
    "payload",
    [
        {"sub": "machine", "aud": "mch_convex", "exp": 2_000},
        {
            "iss": "https://issuer.example.test",
            "aud": "mch_convex",
            "exp": 2_000,
        },
        {
            "iss": "https://issuer.example.test",
            "sub": "machine",
            "aud": "wrong",
            "exp": 2_000,
        },
        {
            "iss": "https://issuer.example.test",
            "sub": "machine",
            "aud": "mch_convex",
            "exp": 999,
        },
    ],
)
def test_rejects_incomplete_wrong_audience_or_expired_tokens(
    payload: object,
) -> None:
    probe = load_probe()

    with pytest.raises(ValueError):
        probe.decode_m2m_identity(
            jwt(payload),
            expected_audience="mch_convex",
            now_seconds=1_000,
        )
