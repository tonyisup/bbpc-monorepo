import unittest
from unittest import mock

import httpx
from openai import APITimeoutError

from lib import parser


class _FakeMessage:
    def __init__(self, content: str):
        self.content = content


class _FakeChoice:
    def __init__(self, content: str, finish_reason: str | None = None):
        self.message = _FakeMessage(content)
        self.finish_reason = finish_reason


class _FakeResponse:
    def __init__(self, content: str, finish_reason: str | None = None):
        self.choices = [_FakeChoice(content, finish_reason=finish_reason)]


class _FakeCompletions:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = 0
        self.last_kwargs = {}

    def create(self, **kwargs):
        self.calls += 1
        self.last_kwargs = kwargs
        result = self._responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


class _FakeChat:
    def __init__(self, responses):
        self.completions = _FakeCompletions(responses)


class _FakeClient:
    def __init__(self, responses):
        self.chat = _FakeChat(responses)


class ParserLlmResilienceTests(unittest.TestCase):
    def test_seo_output_budget_uses_configured_value_for_clip_payloads(self):
        settings = {"seo_max_output_tokens": 8192}

        self.assertEqual(
            parser._resolve_seo_output_token_budget(settings, ["clipAnalysis"]),
            8192,
        )
        self.assertEqual(
            parser._resolve_seo_output_token_budget(settings, ["title"]),
            1200,
        )

    def test_call_model_forwards_configured_reasoning_effort(self):
        client = _FakeClient([_FakeResponse('{"title": "Recovered"}')])

        parser._call_model(client, "prompt", "tencent/hy3:free", reasoning_effort="low")

        request = client.chat.completions.calls
        self.assertEqual(request, 1)
        self.assertEqual(client.chat.completions.last_kwargs["reasoning_effort"], "low")

    def test_call_model_rejects_empty_length_limited_completion(self):
        client = _FakeClient([_FakeResponse("", finish_reason="length")])

        with self.assertRaisesRegex(RuntimeError, "seo_max_output_tokens"):
            parser._call_model(client, "prompt", "tencent/hy3:free", max_output_tokens=4096)

    def test_call_model_retries_timeout_then_succeeds(self):
        request = httpx.Request("POST", "http://127.0.0.1:11434/v1/chat/completions")
        client = _FakeClient(
            [
                APITimeoutError(request=request),
                _FakeResponse('{"title": "Recovered"}'),
            ]
        )

        with mock.patch("lib.parser.time.sleep") as sleep_mock:
            output = parser._call_model(client, "prompt", "gemma4")

        self.assertEqual(output, '{"title": "Recovered"}')
        self.assertEqual(client.chat.completions.calls, 2)
        sleep_mock.assert_called_once_with(2.0)

    def test_build_client_uses_seo_timeout_override(self):
        config = {
            "settings": {
                "llm_provider": "ollama",
                "ollama_base_url": "http://127.0.0.1:11434",
                "ollama_api_key": "ollama-local",
                "seo_timeout_seconds": 123,
            }
        }

        with mock.patch("lib.parser.OpenAI") as openai_ctor:
            parser._build_client(config)

        openai_ctor.assert_called_once_with(
            base_url="http://127.0.0.1:11434/v1",
            api_key="ollama-local",
            timeout=123.0,
            max_retries=0,
        )


if __name__ == "__main__":
    unittest.main()
