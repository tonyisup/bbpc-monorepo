import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pipeline
from lib import cowork_handoff, cowork_headless, laughter_hints

STEM = "20260101"
SEGMENTS = [{"start": float(t), "end": float(t + 10), "text": f"segment {t}"} for t in range(0, 300, 10)]


def _detection(peak, score):
    """A clip as lib/laughter_detector.detect_laughter returns it."""
    return {"start": max(0.0, peak - 15), "end": peak + 15, "headline": "Laughter moment", "imagePrompt": "p",
            "why": "Audio-laughter detected", "source": "laughter_audio", "peak": peak, "score": score}


class LaughterHintsTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.cowork = self.root / "output" / "cowork"
        self.cowork.mkdir(parents=True)
        self.transcript = self.root / f"{STEM}.json"
        self.transcript.write_text(json.dumps(SEGMENTS))
        self.config = {
            "paths": {"output_dir": str(self.root / "output"),
                      "movie_extractions_dir": str(self.root / "output" / "movies")},
            "settings": {"movie_extractor_llm_enabled": False, "cowork_outputs_dir": str(self.cowork)},
        }
        self.laughter = self.root / "output" / "laughter"
        env = mock.patch.dict(os.environ, {"BBPC_PIPELINE_DATA_DIR": str(self.root)})
        env.start()
        self.addCleanup(env.stop)

    def tearDown(self):
        self._tmp.cleanup()

    def best_params(self, payload):
        self.laughter.mkdir(parents=True, exist_ok=True)
        (self.laughter / "best_params.json").write_text(payload if isinstance(payload, str) else json.dumps(payload))


class HintsFileTests(LaughterHintsTestCase):
    def test_write_keeps_each_laugh_peak_and_score_in_time_order(self):
        hints = laughter_hints.write(self.config, STEM, [_detection(912.34, 0.7123), _detection(101.0, 0.5)],
                                     {"window_sec": 2.5})
        path = laughter_hints.hints_path(self.config, STEM)
        self.assertEqual(path, self.laughter / f"{STEM}.laughter.json")
        self.assertEqual(json.loads(path.read_text()), hints)
        self.assertEqual(hints["episode"], {"stem": STEM})
        self.assertEqual(hints["params"], {"window_sec": 2.5})
        self.assertIsInstance(hints["generatedAt"], str)
        self.assertEqual(hints["moments"], [{"at": 101.0, "score": 0.5}, {"at": 912.3, "score": 0.71}])
        self.assertEqual(laughter_hints.load(self.config, STEM), hints["moments"])

    def test_no_laughs_is_an_empty_list_and_no_file_or_a_broken_one_is_none(self):
        self.assertIsNone(laughter_hints.load(self.config, STEM))
        laughter_hints.write(self.config, STEM, [], {})
        self.assertEqual(laughter_hints.load(self.config, STEM), [])
        path = laughter_hints.hints_path(self.config, STEM)
        for broken in ("{not json", json.dumps({"moments": "812.4"}), json.dumps([1, 2])):
            with self.subTest(broken=broken):
                path.write_text(broken)
                self.assertIsNone(laughter_hints.load(self.config, STEM))

    def test_tuned_params_are_the_ones_laughter_autotune_kept(self):
        self.assertEqual(laughter_hints.tuned_params(self.config), {})
        self.best_params({"variant": "wider_onset_window", "params": {"onset_rate_min": 2.0, "window_sec": 2.5}})
        self.assertEqual(laughter_hints.tuned_params(self.config), {"onset_rate_min": 2.0, "window_sec": 2.5})
        for broken in ("{not json", json.dumps({"params": [2.0]}), json.dumps(["params"])):
            with self.subTest(broken=broken):
                self.best_params(broken)
                self.assertEqual(laughter_hints.tuned_params(self.config), {})

    def test_on_unless_the_setting_is_false(self):
        self.assertTrue(laughter_hints.enabled(self.config))
        self.assertTrue(laughter_hints.enabled({}))
        self.assertFalse(laughter_hints.enabled({"settings": {"cowork_laughter_hints": False}}))


class DetectTests(LaughterHintsTestCase):
    def test_detect_runs_the_detector_with_the_tuned_params_and_writes_what_it_heard(self):
        self.best_params({"params": {"window_sec": 2.5}})
        audio = self.root / f"{STEM}.mp3"
        with mock.patch("lib.laughter_detector.detect_laughter", return_value=[_detection(40.0, 0.9)]) as detector:
            hints = laughter_hints.detect(self.config, STEM, audio)
        detector.assert_called_once_with(audio, params={"window_sec": 2.5})
        self.assertEqual(hints["moments"], [{"at": 40.0, "score": 0.9}])
        self.assertEqual(laughter_hints.load(self.config, STEM), hints["moments"])

    def test_without_librosa_nothing_is_written(self):
        # The detector returns no laughs when librosa is missing, which is not the same as none heard.
        with mock.patch.dict(sys.modules, {"librosa": None}), \
             mock.patch("lib.laughter_detector.detect_laughter", side_effect=AssertionError("not run")), \
             contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertIsNone(laughter_hints.detect(self.config, STEM, self.root / f"{STEM}.mp3"))
        self.assertIn("Laughter hints skipped", out.getvalue())
        self.assertFalse(laughter_hints.hints_path(self.config, STEM).exists())


class PipelineLaughterTests(LaughterHintsTestCase):
    """pipeline.py writes the hints before the stage that waits on Cowork, and never stops for them."""

    def setUp(self):
        super().setUp()
        self.episode = self.root / f"{STEM}.mp3"
        self.episode.write_bytes(b"")
        self.context = {"config": self.config, "transcript_path": str(self.transcript)}

    def ensure(self, stage="movies", **detector):
        detector = detector or {"return_value": [_detection(120.0, 0.6)]}
        with mock.patch("lib.laughter_detector.detect_laughter", **detector) as detect, \
             mock.patch.object(pipeline.cowork_headless, "run", side_effect=AssertionError("headless is off")), \
             contextlib.redirect_stdout(io.StringIO()) as out:
            pipeline._ensure_cowork_outputs(self.context, self.episode, stage)
        return detect, out.getvalue()

    def test_the_hints_are_written_once_before_cowork_is_needed(self):
        detect, out = self.ensure("movies")
        detect.assert_called_once()
        self.assertEqual(laughter_hints.load(self.config, STEM), [{"at": 120.0, "score": 0.6}])
        self.assertIn(str(laughter_hints.hints_path(self.config, STEM)), out)
        detect, _ = self.ensure("parse")
        detect.assert_not_called()

    def assert_nothing_detected(self):
        detect, out = self.ensure()
        detect.assert_not_called()
        self.assertFalse(laughter_hints.hints_path(self.config, STEM).exists())
        return out

    def test_nothing_is_detected_with_the_setting_off(self):
        self.config["settings"]["cowork_laughter_hints"] = False
        self.assert_nothing_detected()

    def test_nothing_is_detected_once_cowork_has_written_its_files(self):
        for kind in ("movies", "seo"):
            (self.cowork / f"{STEM}.{kind}.json").write_text("{}")
        self.assert_nothing_detected()

    def test_nothing_is_detected_without_a_transcript_or_audio(self):
        self.transcript.unlink()
        self.assert_nothing_detected()
        self.transcript.write_text(json.dumps(SEGMENTS))
        self.episode.unlink()
        self.assertIn(f"Laughter hints skipped: no audio at {self.episode}", self.assert_nothing_detected())

    def test_a_failed_detection_never_stops_the_hand_off(self):
        args = mock.Mock(only="movies", from_stage=None)
        with mock.patch("lib.laughter_detector.detect_laughter", side_effect=MemoryError("4 GB")), \
             contextlib.redirect_stdout(io.StringIO()) as out:
            with self.assertRaises(cowork_handoff.AwaitingCowork):
                pipeline._run_stages(args, self.context, self.episode, self.transcript)
        self.assertIn("Warning: laughter detection failed (MemoryError: 4 GB); Cowork works without it.", out.getvalue())
        self.assertFalse(laughter_hints.hints_path(self.config, STEM).exists())


class CoworkReadsTheHintsTests(LaughterHintsTestCase):
    def test_the_headless_prompt_gives_the_laugh_times_when_there_are_any(self):
        prompt = cowork_headless.build_prompt(self.config, STEM, self.root / "t.tsv")
        self.assertNotIn("laugh", prompt.lower())
        laughter_hints.write(self.config, STEM, [], {})
        self.assertNotIn("laugh", cowork_headless.build_prompt(self.config, STEM, self.root / "t.tsv").lower())
        laughter_hints.write(self.config, STEM, [_detection(1530.0, 0.4), _detection(812.4, 0.8)], {})
        prompt = cowork_headless.build_prompt(self.config, STEM, self.root / "t.tsv")
        self.assertIn("heard laughter at these seconds: 812.4, 1530.0.", prompt)

    def test_pending_lists_the_hints_file_when_there_is_one(self):
        validator = _validator()
        cowork_handoff.mark_episode(self.config, STEM, cowork_handoff.STATUS_AWAITING)
        self.assertIsNone(_pending(validator, self.config)[0]["laughter"])
        laughter_hints.write(self.config, STEM, [_detection(40.0, 0.9)], {})
        self.assertEqual(_pending(validator, self.config)[0]["laughter"],
                         str(laughter_hints.hints_path(self.config, STEM)))


class DetectorTests(unittest.TestCase):
    def test_each_detection_carries_its_peak_and_score(self):
        from lib import laughter_detector
        candidate = {"center": 50.0, "peak_center": 52.5, "score": 0.8123, "onset_rate": 4.0,
                     "centroid": 2.0, "laugh_ratio": 0.4}
        with tempfile.NamedTemporaryFile(suffix=".mp3") as audio, \
             mock.patch("librosa.load", return_value=(laughter_detector.np.zeros(16000 * 200), 16000)), \
             mock.patch.object(laughter_detector, "_audio_features", return_value={}), \
             mock.patch.object(laughter_detector, "_run_detection_pass",
                               return_value=([candidate], {"centroid_med": 1.0, "rms_med": 1.0})):
            clips = laughter_detector.detect_laughter(audio.name)
        self.assertEqual([(clip["peak"], clip["score"]) for clip in clips], [(52.5, 0.812)])


def _validator():
    from importlib.util import module_from_spec, spec_from_file_location
    spec = spec_from_file_location("validate_cowork_outputs",
                                   Path(pipeline.__file__).parent / "scripts" / "validate_cowork_outputs.py")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _pending(validator, config):
    with contextlib.redirect_stdout(io.StringIO()) as out:
        validator._pending(config)
    return json.loads(out.getvalue())


if __name__ == "__main__":
    unittest.main()
