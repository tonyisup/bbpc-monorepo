import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pipeline
from lib import cowork_handoff, movie_extractor, parser


# Transcript fixture: 30 ten-second segments (0-300 s). Valid clips sit on these boundaries.
SEGMENTS = [{"start": float(t), "end": float(t + 10), "text": f"segment {t}"} for t in range(0, 300, 10)]


def _clip(i, **extra):
    row = {"start": 10.0 * i, "end": 10.0 * i + 30.0, "headline": f"Hook {i}",
           "imagePrompt": "A cracked film reel in fog", "why": "Funny"}
    row.update(extra)
    return row


def _seo_payload(**overrides):
    candidates = [_clip(i) for i in range(1, 21)]
    payload = {
        "title": "Episode title",
        "metaDescription": "D" * 155,
        "keywords": ["movie podcast"],
        "highlights": [{"start": f"00:00:{s}0", "end": f"00:00:{s}5", "headline": "H", "summary": "S"} for s in (1, 2, 3)],
        "candidateClips": candidates,
        # Picks copy a candidate; Cowork may append its selection reason to `why`.
        "clipAnalysis": [dict(candidates[i], why="Funny. Selected: best hook") for i in (0, 4, 9)],
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
        self.transcript.write_text(json.dumps(SEGMENTS))
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
        self.assertEqual(cowork_handoff.validate_seo(_seo_payload(), segments=SEGMENTS), [])
        self.assertEqual(cowork_handoff.seo_warnings(_seo_payload()), [])

    def test_seo_rejects_missing_sections_and_bad_windows(self):
        bad_clip = {"start": 50.0, "end": 40.0, "headline": "x", "imagePrompt": "y"}
        problems = cowork_handoff.validate_seo(_seo_payload(title="", candidateClips=[bad_clip]))
        self.assertTrue(any("'title'" in p for p in problems))
        self.assertTrue(any("invalid window" in p for p in problems))

    def test_seo_rejects_clip_past_transcript_end(self):
        clip = {"start": 280.0, "end": 330.0, "headline": "x", "imagePrompt": "y"}
        problems = cowork_handoff.validate_seo(_seo_payload(candidateClips=[clip]), transcript_duration=300.0)
        self.assertTrue(any("past the transcript end" in p for p in problems))

    # -- hand-off rules from docs/cowork-handoff.md (errors block the run) --

    def test_seo_requires_exactly_twenty_candidates(self):
        payload = _seo_payload()
        payload["candidateClips"] = payload["candidateClips"][:19]
        problems = cowork_handoff.validate_seo(payload)
        self.assertIn("'candidateClips' must have exactly 20 clips (found 19)", problems)

    def test_seo_requires_exactly_three_picks(self):
        payload = _seo_payload()
        payload["clipAnalysis"] = payload["clipAnalysis"][:2]
        self.assertIn("'clipAnalysis' must have exactly 3 clips (found 2)", cowork_handoff.validate_seo(payload))

    def test_picks_must_copy_a_candidate_window_and_headline(self):
        payload = _seo_payload()
        payload["clipAnalysis"][1] = dict(payload["clipAnalysis"][1], start=55.0)
        payload["clipAnalysis"][2] = dict(payload["clipAnalysis"][2], headline="Renamed")
        problems = cowork_handoff.validate_seo(payload)
        self.assertIn("clipAnalysis[1] is not one of the candidateClips (same start, end and headline)", problems)
        self.assertIn("clipAnalysis[2] is not one of the candidateClips (same start, end and headline)", problems)

    def test_picks_must_be_distinct(self):
        payload = _seo_payload()
        payload["clipAnalysis"][2] = dict(payload["clipAnalysis"][0])
        self.assertIn("clipAnalysis[2] repeats an earlier pick", cowork_handoff.validate_seo(payload))

    def test_clips_must_start_and_end_on_segment_boundaries(self):
        payload = _seo_payload()
        payload["candidateClips"][3] = dict(payload["candidateClips"][3], start=41.5)
        payload["candidateClips"][5] = dict(payload["candidateClips"][5], end=88.0)
        problems = cowork_handoff.validate_seo(payload, segments=SEGMENTS)
        self.assertIn("candidateClips[3] starts at 41.50s, not on a transcript segment start", problems)
        self.assertIn("candidateClips[5] ends at 88.00s, not on a transcript segment end", problems)

    def test_boundary_check_is_skipped_without_segments(self):
        payload = _seo_payload()
        payload["candidateClips"][3] = dict(payload["candidateClips"][3], start=41.5)
        self.assertEqual(cowork_handoff.validate_seo(payload), [])

    def test_movie_evidence_must_sit_on_segment_boundaries(self):
        movie = _movie("Sketch", 2025, evidence=[{"start": 12.0, "end": 80.0, "text": "review"}])
        problems = cowork_handoff.validate_movies(_movies_payload(movie), segments=SEGMENTS)
        self.assertIn("movies[0].evidence[0] starts at 12.00s, not on a transcript segment start", problems)

    def test_host_ratings_use_site_host_and_rating_names(self):
        good = _movie("Sketch", 2025, hostRatings={"Fonso": "Slater", "Harley": "Goldblum", "Tony": "Waste"})
        self.assertEqual(cowork_handoff.validate_movies(_movies_payload(good)), [])
        bad = _movie("Sketch", 2025, hostRatings={"MCB": "Dollar", "Fonzo": "Dollar", "Tony": "Pile of Shit"})
        problems = cowork_handoff.validate_movies(_movies_payload(bad))
        self.assertIn("movies[0].hostRatings has unknown host 'MCB' (use Fonso, Harley, Tony)", problems)
        self.assertIn("movies[0].hostRatings has unknown host 'Fonzo' (use Fonso, Harley, Tony)", problems)
        self.assertIn(
            "movies[0].hostRatings['Tony'] is 'Pile of Shit' (use Slater, Dollar, Waste, Goldblum)", problems)

    # -- soft rules (warnings never block) --

    def test_soft_seo_rules_warn_without_failing(self):
        payload = _seo_payload(title="T" * 61, metaDescription="Too short", highlights=[
            {"start": "00:00:10", "end": "00:00:20", "headline": "H", "summary": "S"}])
        self.assertEqual(cowork_handoff.validate_seo(payload, segments=SEGMENTS), [])
        warnings = cowork_handoff.seo_warnings(payload)
        self.assertIn("title is 61 characters (keep it to 60)", warnings)
        self.assertIn("metaDescription is 9 characters (aim for about 160)", warnings)
        self.assertIn("highlights has 1 entries (expected 3-5)", warnings)

    def test_evidence_window_length_outside_60_to_180_seconds_warns(self):
        movie = _movie("Sketch", 2025, evidence=[
            {"start": 10.0, "end": 60.0, "text": "short"}, {"start": 0.0, "end": 190.0, "text": "long"}])
        payload = _movies_payload(movie)
        self.assertEqual(cowork_handoff.validate_movies(payload, segments=SEGMENTS), [])
        self.assertEqual(cowork_handoff.movies_warnings(payload), [
            "movies[0].evidence[0] is 50s (expected 60-180s)",
            "movies[0].evidence[1] is 190s (expected 60-180s)",
        ])

    def test_movies_rejects_unknown_status_and_year(self):
        problems = cowork_handoff.validate_movies(_movies_payload(_movie("Sketch", 25, status="liked")))
        self.assertEqual(len(problems), 2)

    def test_invalid_json_file_raises_cowork_output_invalid(self):
        (self.cowork / "20260101.seo.json").write_text("{not json")
        with self.assertRaises(cowork_handoff.CoworkOutputInvalid):
            cowork_handoff.load_seo(self.config, "20260101")

    def test_cowork_mode_setting_no_longer_exists(self):
        # Cowork is the only judgment path; there is no mode to switch it off.
        self.assertFalse(hasattr(cowork_handoff, "resolve_mode"))
        self.assertFalse(hasattr(cowork_handoff, "MODES"))


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
            _movie("Sketch", 2025, hostRatings={"Fonso": "Dollar"}),
            _movie("Dellamorte Dellamore", 1994, originalTitle="Cemetery Man"),
        ))
        context = self.context()
        movie_extractor.run(context)
        payload = json.loads(Path(context["movie_extraction_path"]).read_text())
        by_title = {m["title"]: m for m in payload["movies"]}
        self.assertEqual(by_title["Sketch"]["matchedMovieId"], "movie-1")
        self.assertEqual(by_title["Sketch"]["hostRatings"], {"Fonso": "Dollar"})
        self.assertEqual(by_title["Dellamorte Dellamore"]["matchedMovieId"], "movie-2")
        # Convex-assigned movie Cowork did not list is kept for the thumbnail.
        self.assertEqual(by_title["Mystery Road"]["status"], "db_assigned")
        self.assertEqual(payload["extractor"]["mode"], "cowork")
        self.assertEqual(payload["episode"]["dbEpisodeId"], "episode-1")
        self.assertEqual(payload["extractor"]["dbMovieCount"], 3)

    def test_movies_stage_rejects_evidence_off_segment_boundary(self):
        self.write("20260101.movies.json", _movies_payload(
            _movie("Sketch", 2025, evidence=[{"start": 10.0, "end": 75.5, "text": "review"}])))
        with self.assertRaises(cowork_handoff.CoworkOutputInvalid) as ctx:
            movie_extractor.run(self.context())
        self.assertIn("movies[0].evidence[0] ends at 75.50s", str(ctx.exception))

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

    def test_without_file_waits_for_cowork_even_when_config_says_off(self):
        # A stale "cowork_mode" in an old config must not resurrect a fallback.
        self.config["settings"]["cowork_mode"] = "off"
        with self.assertRaises(cowork_handoff.AwaitingCowork) as ctx:
            movie_extractor.run(self.context(cowork_mode="off"))
        self.assertEqual(ctx.exception.stage, "movies")

    def test_without_file_waits_before_any_convex_lookup(self):
        context = self.context(db_episode=None, db_episode_movies=[])
        with mock.patch.object(movie_extractor.ConvexPipelineClient, "from_environment",
                               side_effect=AssertionError("no Convex call while waiting")):
            with self.assertRaises(cowork_handoff.AwaitingCowork):
                movie_extractor.run(context)


class ParseStageTests(CoworkHandoffTestCase):
    def context(self, **overrides):
        context = {"config": self.config, "transcript_path": str(self.transcript),
                   "episode_path": str(self.root / "20260101.mp3")}
        context.update(overrides)
        return context

    def test_uses_cowork_seo_without_calling_laughter_detection(self):
        self.write("20260101.seo.json", _seo_payload())
        context = self.context()
        with mock.patch("lib.laughter_detector.detect_laughter", side_effect=AssertionError("no audio")):
            parser.run(context)
        written = json.loads(Path(context["seo_path"]).read_text())
        self.assertEqual(written["title"], "Episode title")
        self.assertEqual(written["clipAnalysis"][0]["start"], 10.0)
        self.assertNotIn("_generator", written)

    def test_invalid_cowork_seo_raises(self):
        self.write("20260101.seo.json", _seo_payload(candidateClips=[]))
        with self.assertRaises(cowork_handoff.CoworkOutputInvalid):
            parser.run(self.context())

    def test_parse_rejects_clip_off_segment_boundary(self):
        payload = _seo_payload()
        payload["candidateClips"][0] = dict(payload["candidateClips"][0], end=37.0)
        self.write("20260101.seo.json", payload)
        with self.assertRaises(cowork_handoff.CoworkOutputInvalid) as ctx:
            parser.run(self.context())
        self.assertIn("candidateClips[0] ends at 37.00s", str(ctx.exception))

    def test_without_file_waits_for_cowork_even_when_config_says_off(self):
        self.config["settings"]["cowork_mode"] = "off"
        with self.assertRaises(cowork_handoff.AwaitingCowork) as ctx:
            parser.run(self.context(cowork_mode="off"))
        self.assertEqual(ctx.exception.stage, "parse")

    def test_parser_has_no_model_client(self):
        self.assertFalse(hasattr(parser, "_build_client"))
        self.assertFalse(hasattr(parser, "_call_model"))


class PipelineStageSelectionTests(unittest.TestCase):
    def test_from_runs_stage_and_everything_after(self):
        selected = [s for s in pipeline.STAGES if pipeline._should_run(s, None, "movies")]
        self.assertEqual(selected[0], "movies")
        self.assertNotIn("transcribe", selected)
        self.assertNotIn("import_transcript", selected)
        self.assertEqual(selected[-1], "publish")

    def test_only_still_selects_single_stage(self):
        self.assertEqual([s for s in pipeline.STAGES if pipeline._should_run(s, "clip")], ["clip"])

    def test_placeholder_diarize_stage_is_gone(self):
        self.assertNotIn("diarize", pipeline.STAGES)


if __name__ == "__main__":
    unittest.main()


class ShowFormatReferenceTests(unittest.TestCase):
    """docs/show-format.md is the one place show knowledge lives; Cowork is pointed at it."""

    DOCS = Path(__file__).resolve().parents[1] / "docs"

    def test_handoff_instructions_send_cowork_to_the_show_format_reference(self):
        handoff = (self.DOCS / "cowork-handoff.md").read_text(encoding="utf-8")
        self.assertIn("show-format.md", handoff)
        # The show knowledge itself must not be duplicated in the hand-off doc.
        self.assertNotIn("Rating scale, best to worst", handoff)

    def test_show_format_reference_covers_what_cowork_needs(self):
        text = (self.DOCS / "show-format.md").read_text(encoding="utf-8")
        for heading in ("## Hosts", "## Episode structure", "## Rating scale", "## Listener game",
                        "## Not reviews", "## Transcription garbles", "## What gets published"):
            self.assertIn(heading, text)
