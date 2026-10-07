import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock


class RuntimeConfigTests(unittest.TestCase):
    def setUp(self):
        self._original_env = os.environ.copy()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.config_path = Path(self.temp_dir.name) / "config.json"
        self.config_path.write_text(
            json.dumps(
                {
                    "paths": {
                        "episodes_dir": "./episodes",
                        "output_dir": "./output",
                        "transcripts_dir": "./transcripts",
                    },
                    "settings": {"whisper_model": "large-v3-turbo", "clip_duration": 60},
                }
            ),
            encoding="utf-8",
        )

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._original_env)

    def test_load_config_reads_non_secret_json_fields(self):
        from lib.runtime_config import load_config

        data_root = Path(self.temp_dir.name).resolve() / "data"
        os.environ["BBPC_PIPELINE_DATA_DIR"] = str(data_root)

        config = load_config(self.config_path)

        self.assertEqual(config["paths"]["episodes_dir"], str(data_root / "episodes"))
        self.assertEqual(config["settings"]["clip_duration"], 60)

    def test_load_config_keeps_absolute_paths_and_anchors_cowork_outputs(self):
        from lib.runtime_config import load_config

        data_root = Path(self.temp_dir.name).resolve() / "data"
        os.environ["BBPC_PIPELINE_DATA_DIR"] = str(data_root)
        self.config_path.write_text(
            json.dumps(
                {
                    "paths": {"episodes_dir": "/srv/episodes", "output_dir": "./output"},
                    "settings": {"cowork_outputs_dir": "./output/cowork"},
                }
            ),
            encoding="utf-8",
        )

        config = load_config(self.config_path)

        self.assertEqual(config["paths"]["episodes_dir"], "/srv/episodes")
        self.assertEqual(config["paths"]["output_dir"], str(data_root / "output"))
        self.assertEqual(config["settings"]["cowork_outputs_dir"], str(data_root / "output" / "cowork"))

    def test_get_openai_api_key_reads_from_environment(self):
        from lib.runtime_config import get_openai_api_key

        os.environ["OPENAI_API_KEY"] = "test-openai-key"

        self.assertEqual(get_openai_api_key(), "test-openai-key")

    def test_get_openrouter_reads_from_environment(self):
        from lib.runtime_config import get_openrouter_api_key, get_openrouter_api_url, get_openrouter_model

        os.environ["OPENROUTER_API_KEY"] = "test-or-key"
        os.environ["OPENROUTER_MODEL"] = "test/model"
        os.environ["OPENROUTER_API_URL"] = "https://example.com/v1"

        self.assertEqual(get_openrouter_api_key(), "test-or-key")
        self.assertEqual(get_openrouter_model(), "test/model")
        self.assertEqual(get_openrouter_api_url(), "https://example.com/v1")

    def test_get_openrouter_api_url_defaults_when_unset(self):
        from lib.runtime_config import get_openrouter_api_url

        os.environ.pop("OPENROUTER_API_URL", None)

        self.assertEqual(get_openrouter_api_url(), "https://openrouter.ai/api/v1")

    def test_normalize_ollama_openai_base_url(self):
        from lib.runtime_config import normalize_ollama_openai_base_url

        self.assertEqual(
            normalize_ollama_openai_base_url("http://127.0.0.1:11434"),
            "http://127.0.0.1:11434/v1",
        )
        self.assertEqual(
            normalize_ollama_openai_base_url("http://127.0.0.1:11434/v1"),
            "http://127.0.0.1:11434/v1",
        )

    def test_resolve_pipeline_llm_endpoints_ollama(self):
        from lib.runtime_config import resolve_pipeline_llm_endpoints

        os.environ.pop("OLLAMA_BASE_URL", None)
        os.environ.pop("OLLAMA_API_KEY", None)

        base, key = resolve_pipeline_llm_endpoints(
            {
                "llm_provider": "ollama",
                "ollama_base_url": "http://127.0.0.1:11434",
                "ollama_api_key": "ollama-local",
            }
        )
        self.assertEqual(base, "http://127.0.0.1:11434/v1")
        self.assertEqual(key, "ollama-local")

    def test_resolve_seo_llm_model_name_ollama_fallback(self):
        from lib.runtime_config import resolve_seo_llm_model_name

        os.environ["OLLAMA_MODEL"] = "my-local"
        name = resolve_seo_llm_model_name({"llm_provider": "ollama"})
        self.assertEqual(name, "my-local")

    def test_resolve_llm_request_timeout_prefers_operation_specific_setting(self):
        from lib.runtime_config import resolve_llm_request_timeout

        timeout = resolve_llm_request_timeout(
            {"llm_provider": "ollama", "llm_timeout_seconds": 45, "seo_timeout_seconds": 120},
            operation="seo",
        )

        self.assertEqual(timeout, 120.0)

    def test_resolve_llm_request_timeout_uses_provider_default(self):
        from lib.runtime_config import resolve_llm_request_timeout

        self.assertEqual(resolve_llm_request_timeout({"llm_provider": "ollama"}), 900.0)
        self.assertEqual(resolve_llm_request_timeout({"llm_provider": "openrouter"}), 300.0)

    def test_convex_settings_read_and_validate_environment(self):
        from lib.runtime_config import (
            get_convex_max_attempts,
            get_convex_pipeline_token,
            get_convex_timeout_seconds,
            get_convex_url,
        )

        os.environ["CONVEX_URL"] = "https://example.convex.cloud/"
        os.environ["CONVEX_PIPELINE_TOKEN"] = "pipeline-token"
        os.environ["CONVEX_TIMEOUT_SECONDS"] = "12.5"
        os.environ["CONVEX_MAX_ATTEMPTS"] = "4"

        self.assertEqual(
            get_convex_url(), "https://example.convex.cloud"
        )
        self.assertEqual(
            get_convex_pipeline_token(), "pipeline-token"
        )
        self.assertEqual(get_convex_timeout_seconds(), 12.5)
        self.assertEqual(get_convex_max_attempts(), 4)

    def test_convex_attempt_limit_fails_closed(self):
        from lib.runtime_config import get_convex_max_attempts

        os.environ["CONVEX_MAX_ATTEMPTS"] = "6"

        with self.assertRaisesRegex(
            ValueError, "must be between 1 and 5"
        ):
            get_convex_max_attempts()

    def test_pipeline_auth_accepts_exactly_one_credential(self):
        from lib.runtime_config import resolve_convex_pipeline_auth

        os.environ["CONVEX_PIPELINE_TOKEN"] = "pipeline-token"
        os.environ.pop("CLERK_MACHINE_SECRET_KEY", None)
        self.assertEqual(
            resolve_convex_pipeline_auth(),
            ("pipeline-token", None),
        )

        os.environ.pop("CONVEX_PIPELINE_TOKEN", None)
        os.environ["CLERK_MACHINE_SECRET_KEY"] = "machine-secret"
        self.assertEqual(
            resolve_convex_pipeline_auth(),
            (None, "machine-secret"),
        )

        os.environ["CONVEX_PIPELINE_TOKEN"] = "pipeline-token"
        with self.assertRaisesRegex(ValueError, "exactly one"):
            resolve_convex_pipeline_auth()

    def test_pipeline_auth_requires_a_credential(self):
        from lib.runtime_config import (
            MissingEnvironmentVariableError,
            resolve_convex_pipeline_auth,
        )

        os.environ.pop("CONVEX_PIPELINE_TOKEN", None)
        os.environ.pop("CLERK_MACHINE_SECRET_KEY", None)

        with self.assertRaises(MissingEnvironmentVariableError):
            resolve_convex_pipeline_auth()

    def test_clerk_m2m_lifetime_settings_fail_closed(self):
        from lib.runtime_config import (
            get_clerk_m2m_refresh_margin_seconds,
            get_clerk_m2m_token_ttl_seconds,
        )

        os.environ["CLERK_M2M_TOKEN_TTL_SECONDS"] = "120"
        os.environ["CLERK_M2M_REFRESH_MARGIN_SECONDS"] = "30"
        ttl = get_clerk_m2m_token_ttl_seconds()
        self.assertEqual(ttl, 120)
        self.assertEqual(
            get_clerk_m2m_refresh_margin_seconds(ttl),
            30,
        )

        os.environ["CLERK_M2M_REFRESH_MARGIN_SECONDS"] = "120"
        with self.assertRaisesRegex(ValueError, "less than the token TTL"):
            get_clerk_m2m_refresh_margin_seconds(ttl)

    def test_clerk_m2m_audience_requires_a_receiver_machine(self):
        from lib.runtime_config import get_clerk_m2m_audience

        os.environ["CLERK_M2M_AUDIENCE"] = "mch_convex"
        self.assertEqual(get_clerk_m2m_audience(), "mch_convex")

        os.environ["CLERK_M2M_AUDIENCE"] = "convex"
        with self.assertRaisesRegex(ValueError, "receiver machine ID"):
            get_clerk_m2m_audience()

    def test_missing_required_env_var_raises_clear_error(self):
        from lib.runtime_config import MissingEnvironmentVariableError, get_azure_connection_string

        os.environ.pop("AZURE_STORAGE_CONNECTION_STRING", None)

        with self.assertRaises(MissingEnvironmentVariableError) as ctx:
            get_azure_connection_string()

        self.assertIn("AZURE_STORAGE_CONNECTION_STRING", str(ctx.exception))


    def test_env_loads_from_the_checkout_then_the_data_directory_it_selects(self):
        from lib import runtime_config

        checkout = Path(self.temp_dir.name) / "checkout"
        shared = Path(self.temp_dir.name) / "shared"
        checkout.mkdir()
        shared.mkdir()
        (checkout / ".env").write_text(
            f"BBPC_PIPELINE_DATA_DIR={shared}\nBBPC_TEST_BOTH=checkout\n", encoding="utf-8"
        )
        (shared / ".env").write_text("BBPC_TEST_BOTH=shared\nBBPC_TEST_SHARED_ONLY=shared\n", encoding="utf-8")
        for name in ("BBPC_PIPELINE_DATA_DIR", "BBPC_TEST_BOTH", "BBPC_TEST_SHARED_ONLY"):
            os.environ.pop(name, None)

        with mock.patch.object(runtime_config, "PIPELINE_ROOT", checkout), mock.patch.object(
            runtime_config, "_CONFIG_ENV_LOADED", False
        ):
            runtime_config._ensure_env_loaded()

        self.assertEqual(os.environ["BBPC_TEST_SHARED_ONLY"], "shared")
        self.assertEqual(os.environ["BBPC_TEST_BOTH"], "checkout")


if __name__ == "__main__":
    unittest.main()
