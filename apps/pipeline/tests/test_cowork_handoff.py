import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pipeline
from lib import cowork_handoff, movie_extractor, parser


def _seo_payload(**overrides):
    clip = {"start": 10.0, "end": 40.0, "headline": "Hook", "imagePrompt": "A cracked film reel in fog", "why": "Funny"}
    payload = {
        "title": "Episode title",
        "metaDescription": "Description",
        "keywords": ["movie podcast"],
        "highlights": [{"start": "00:00:10", "end": "00:00:40", "headline": "H", "summary": "S"}],
        "candidateClips": [dict(clip)],
        "clipAnalysis": [dict(clip)],
        "notableWorks": ["Sketch"],
        "callToAction": "Follow us",
        "_generator": "cowork_v1",
    }
    payload.update(overrides)
    return payload


def _movies_payload(*movies):
    return {
        "episode": {"stem": "20260101", "dbEpisodeNumber": 42},
        "extractor": {"version": "cowork_v1"},
        "movies": list(movies),
        "unmatchedTitles": [],
        "candidates": [dict(m, score=m.get("confidence", 0.9)) for m in movies],
    }


def _movie(title, year, **extra):
    row = {"matchedMovieId": None, "title": title, "year": year, "confidence": 0.95, "status": "accepted",
           "signals": ["strong_review_context"], "evidence": [{"start": 10.0, "end": 80.0, "text": "review", "windowType": "review"}]}
    row.update(extra)
    return row


def _episode_movie(movie_id, title, year, source="assignment"):
    return mock.Mock(movie_id=movie_id, title=title, year=year, source=source,
                     assignment_type="HOMEWORK" if source == "assignment" else None)


class CoworkHandoffTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.cowork = self.root / "cowork"
        self.cowork.mkdir()
        self.transcript = self.root / "20260101.json"
        self.transcript.write_text(json.dumps([
            {"start": 0.0, "end": 10.0, "text": "welcome back"},
            {"start": 10.0, "end": 120.0, "text": "my homework was sketch and i give it a dollar"},
        ]))
        self.config = {
            "paths": {
                "output_dir": str(self.root / "output"),
                "movie_extractions_dir": str(self.root / "output" / "movies"),
            },
            "settings": {"movie_extractor_llm_enabled": False, "cowork_outputs_dir": str(self.cowork)},
        }

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, name, payload):
        (self.cowork / name).write_text(json.dumps(payload))


class ValidationTests(CoworkHandoffTestCase):
    def test_valid_seo_has_no_problems(self):
        self.assertEqual(cowork_handoff.validate_seo(_seo_payload(), transcript_duration=120.0), [])

    def test_seo_rejects_missing_sections_and_bad_windows(self):
        bad_clip = {"start": 50.0, "end": 40.0, "headline": "x", "imagePrompt": "y"}
        problems = cowork_handoff.validate_seo(_seo_payload(title="", candidateClips=[bad_clip]))
        self.assertTrue(any("'title'" in p for p in problems))
        self.assertTrue(any("invalid window" in p for p in problems))

    def test_seo_rejects_clip_past_transcript_end(self):
        clip = {"start": 100.0, "end": 150.0, "headline": "x", "imagePrompt": "y"}
        problems = cowork_handoff.validate_seo(_seo_payload(candidateClips=[clip]), transcript_duration=120.0)
        self.assertTrue(any("past the transcript end" in p for p in problems))

    def test_movies_rejects_unknown_status_and_year(self):
        problems = cowork_handoff.validate_movies(_movies_payload(_movie("Sketch", 25, status="liked")))
        self.assertEqual(len(problems), 2)

    def test_invalid_json_file_raises_cowork_output_invalid(self):
        (self.cowork / "20260101.seo.json").write_text("{not json")
        with self.assertRaises(cowork_handoff.CoworkOutputInvalid):
            cowork_handoff.load_seo(self.config, "20260101")

    def test_mode_resolution(self):
        self.assertEqual(cowork_handoff.resolve_mode(self.config), "prefer")
        self.assertEqual(cowork_handoff.resolve_mode(self.config, {"cowork_mode": "off"}), "off")
        with self.assertRaises(ValueError):
            cowork_handoff.resolve_mode({"settings": {"cowork_mode": "sometimes"}})


class StateTests(CoworkHandoffTestCase):
    def test_first_load_seeds_existing_seo_outputs_as_done(self):
        seo_dir = self.root / "output" / "seo"
        seo_dir.mkdir(parents=True)
        (seo_dir / "20260101.seo.json").write_text("{}")
        (seo_dir / "20260101.seo.pre-budget-fix.json").write_text("{}")
        episodes = cowork_handoff.load_state(self.config)["episodes"]
        self.assertEqual(list(episodes), ["20260101"])
        self.assertEqual(episodes["20260101"]["status"], cowork_handoff.STATUS_DONE)

    def test_mark_and_list_awaiting(self):
        cowork_handoff.mark_episode(self.config, "20260108", cowork_handoff.STATUS_AWAITING, lastError="bad file")
        self.assertEqual(cowork_handoff.awaiting(self.config), ["20260108"])
        cowork_handoff.mark_episode(self.config, "20260108", cowork_handoff.STATUS_DONE)
        entry = cowork_handoff.load_state(self.config)["episodes"]["20260108"]
        self.assertEqual(entry["status"], "done")
        self.assertNotIn("lastError", entry)


class MovieStageTests(CoworkHandoffTestCase):
    def context(self, **overrides):
        context = {
            "config": self.config,
            "transcript_path": str(self.transcript),
            "db_episode": {"id": "episode-1", "number": 42, "title": "Episode 42", "date": "2026-01-01"},
            "db_episode_movies": [
                _episode_movie("movie-1", "Sketch", 2025),
                _episode_movie("movie-2", "Cemetery Man", 1994, "extra_review"),
                _episode_movie("movie-3", "Mystery Road", 2023),
            ],
        }
        context.update(overrides)
        return context

    def test_uses_cowork_file_and_resolves_ids_from_assignments(self):
        self.write("20260101.movies.json", _movies_payload(
            _movie("Sketch", 2025, hostRatings={"Fonzo": "Dollar"}),
            _movie("Dellamorte Dellamore", 1994, originalTitle="Cemetery Man"),
        ))
        context = self.context()
        with mock.patch.object(movie_extractor, "_extract_with_transcript") as legacy:
            movie_extractor.run(context)
        legacy.assert_not_called()
        payload = json.loads(Path(context["movie_extraction_path"]).read_text())
        by_title = {m["title"]: m for m in payload["movies"]}
        self.assertEqual(by_title["Sketch"]["matchedMovieId"], "movie-1")
        self.assertEqual(by_title["Sketch"]["hostRatings"], {"Fonzo": "Dollar"})
        self.assertEqual(by_title["Dellamorte Dellamore"]["matchedMovieId"], "movie-2")
        # Convex-assigned movie Cowork did not list is kept for the thumbnail.
        self.assertEqual(by_title["Mystery Road"]["status"], "db_assigned")
        self.assertEqual(payload["extractor"]["mode"], "cowork")
        self.assertEqual(payload["episode"]["dbEpisodeId"], "episode-1")
        self.assertEqual(payload["extractor"]["dbMovieCount"], 3)

    def test_unassigned_movie_resolved_from_full_catalog_only_on_year_match(self):
        self.write("20260101.movies.json", _movies_payload(
            _movie("The End of Oak Street", 2026), _movie("Heat", 2026),
        ))
        catalog = movie_extractor._build_catalog([
            ("movie-9", "The End of Oak Street", 2026), ("movie-10", "Heat", 1995),
        ])
        context = self.context(db_episode_movies=[_episode_movie("movie-1", "Sketch", 2025)])
        with mock.patch.object(movie_extractor, "_load_movie_catalog", return_value=catalog), \
             mock.patch.object(movie_extractor.ConvexPipelineClient, "from_environment"):
            movie_extractor.run(context)
        by_title = {m["title"]: m for m in context["extracted_movies"]}
        self.assertEqual(by_title["The End of Oak Street"]["matchedMovieId"], "movie-9")
        self.assertIsNone(by_title["Heat"]["matchedMovieId"])

    def test_require_mode_without_file_raises_awaiting(self):
        self.config["settings"]["cowork_mode"] = "require"
        with self.assertRaises(cowork_handoff.AwaitingCowork) as ctx:
            movie_extractor.run(self.context())
        self.assertEqual(ctx.exception.stage, "movies")

    def test_prefer_mode_without_file_falls_back(self):
        with mock.patch.object(movie_extractor, "_extract_with_transcript", return_value=_movies_payload()) as legacy:
            movie_extractor.run(self.context())
        legacy.assert_called_once()

    def test_off_mode_ignores_file(self):
        self.write("20260101.movies.json", _movies_payload(_movie("Sketch", 2025)))
        with mock.patch.object(movie_extractor, "_extract_with_transcript", return_value=_movies_payload()) as legacy:
            movie_extractor.run(self.context(cowork_mode="off"))
        legacy.assert_called_once()


class ParseStageTests(CoworkHandoffTestCase):
    def context(self, **overrides):
        context = {"config": self.config, "transcript_path": str(self.transcript),
                   "episode_path": str(self.root / "20260101.mp3")}
        context.update(overrides)
        return context

    def test_uses_cowork_seo_without_calling_model_or_laughter(self):
        self.write("20260101.seo.json", _seo_payload())
        context = self.context()
        with mock.patch.object(parser, "_build_client", side_effect=AssertionError("no LLM")), \
             mock.patch("lib.laughter_detector.detect_laughter", side_effect=AssertionError("no audio")):
            parser.run(context)
        written = json.loads(Path(context["seo_path"]).read_text())
        self.assertEqual(written["title"], "Episode title")
        self.assertEqual(written["clipAnalysis"][0]["start"], 10.0)
        self.assertNotIn("_generator", written)

    def test_invalid_cowork_seo_raises(self):
        self.write("20260101.seo.json", _seo_payload(candidateClips=[]))
        with self.assertRaises(cowork_handoff.CoworkOutputInvalid):
            parser.run(self.context())

    def test_require_mode_without_file_raises_awaiting(self):
        with self.assertRaises(cowork_handoff.AwaitingCowork) as ctx:
            parser.run(self.context(cowork_mode="require"))
        self.assertEqual(ctx.exception.stage, "parse")


class PipelineStageSelectionTests(unittest.TestCase):
    def test_from_runs_stage_and_everything_after(self):
        selected = [s for s in pipeline.STAGES if pipeline._should_run(s, None, "movies")]
        self.assertEqual(selected[0], "movies")
        self.assertNotIn("transcribe", selected)
        self.assertNotIn("import_transcript", selected)
        self.assertEqual(selected[-1], "publish")

    def test_only_still_selects_single_stage(self):
        self.assertEqual([s for s in pipeline.STAGES if pipeline._should_run(s, "clip")], ["clip"])


if __name__ == "__main__":
    unittest.main()
