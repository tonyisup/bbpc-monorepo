"""Synthetic worker tests: no Azure, model downloads, or real recordings."""
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location("backfill_worker", Path(__file__).with_name("backfill-worker.py"))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class CompletionTests(unittest.TestCase):
    def test_exception_after_segments_preserves_partial_and_propagates(self):
        def segments():
            yield SimpleNamespace(start=0, end=10, text="Synthetic partial words")
            raise RuntimeError("Synthetic decoder error")
        with tempfile.TemporaryDirectory() as directory:
            partial = Path(directory) / "partial.json"
            with self.assertRaises(RuntimeError):
                worker.consume_segments(segments(), partial)
            self.assertEqual(len(json.loads(partial.read_text())), 1)
            self.assertFalse((Path(directory) / "candidate.json").exists())

    def test_keyboard_interrupt_never_reports_completion(self):
        def segments():
            yield SimpleNamespace(start=0, end=10, text="Synthetic partial words")
            raise KeyboardInterrupt()
        with tempfile.TemporaryDirectory() as directory:
            partial = Path(directory) / "partial.json"
            with self.assertRaises(KeyboardInterrupt):
                worker.consume_segments(segments(), partial)
            self.assertEqual(len(json.loads(partial.read_text())), 1)

    def test_empty_nonfinite_and_invalid_timestamps_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            partial = Path(directory) / "partial.json"
            for rows in [[], [SimpleNamespace(start=float("nan"), end=1, text="bad")],
                         [SimpleNamespace(start=2, end=1, text="bad")]]:
                with self.assertRaises(ValueError):
                    worker.consume_segments(rows, partial)

    def test_success_exhausts_all_segments(self):
        with tempfile.TemporaryDirectory() as directory:
            partial = Path(directory) / "partial.json"
            rows = worker.consume_segments([SimpleNamespace(start=0, end=10, text="Synthetic complete words")], partial)
            self.assertEqual(rows, json.loads(partial.read_text()))

    def test_download_and_completion_require_matching_audio_and_full_coverage(self):
        for scenario in ("success", "changed-audio", "short-coverage", "decoder-failure"):
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory() as directory:
                properties = SimpleNamespace(etag="changed" if scenario == "changed-audio" else "v1", size=1000)
                client = Mock()
                client.get_blob_properties.return_value = properties
                client.download_blob.return_value.readinto.side_effect = lambda stream: stream.write(b"x" * 1000)
                container = Mock(url="https://synthetic.blob.core.windows.net/episodes")
                container.get_blob_client.return_value = client
                def segments():
                    yield SimpleNamespace(start=0, end=50 if scenario == "short-coverage" else 99, text="Synthetic spoken words")
                    if scenario == "decoder-failure":
                        raise RuntimeError("Synthetic decoder failure")
                model_type = Mock()
                model_type.return_value.transcribe.return_value = (segments(), None)
                modules = {"azure": Mock(), "azure.core": SimpleNamespace(MatchConditions=SimpleNamespace(IfNotModified="unchanged")),
                           "faster_whisper": SimpleNamespace(WhisperModel=model_type)}
                request = {"envFile": "unused", "containerUrl": container.url,
                           "blob": {"name": "synthetic.mp3", "etag": "v1", "size": 1000}, "work": directory, "model": "synthetic"}
                with patch.dict("sys.modules", modules), patch.object(worker, "container_client", return_value=container), \
                        patch.object(worker.subprocess, "run", return_value=SimpleNamespace(stdout="100")):
                    if scenario == "success":
                        self.assertTrue(worker.transcribe(request)["complete"])
                        self.assertTrue((Path(directory) / "candidate.json").is_file())
                        client.download_blob.assert_called_once_with(etag="v1", match_condition="unchanged")
                    else:
                        with self.assertRaises((ValueError, RuntimeError)):
                            worker.transcribe(request)
                        self.assertFalse((Path(directory) / "candidate.json").exists())
                    if scenario == "changed-audio":
                        client.download_blob.assert_not_called()
                        model_type.assert_not_called()


if __name__ == "__main__":
    unittest.main()
