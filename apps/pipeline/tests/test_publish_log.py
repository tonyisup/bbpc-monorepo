import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from lib import clip_files, data_dir, publish_log

ROOT = Path(__file__).resolve().parents[1]


def _clip(start, end, headline):
    return {"start": start, "end": end, "headline": headline, "imagePrompt": "p", "why": "w"}


class ClipFileNameTests(unittest.TestCase):
    def test_file_names_match_what_the_clipper_has_always_written(self):
        # Real names from output/clips/20260928.
        clip = _clip(6697.0, 6780.2, "It's called The Thomas Crown Affair, not the Thomas Crown bank job")
        self.assertEqual(
            clip_files.clip_file_name(2, clip),
            "02-it-s-called-the-thomas-crown-affair-not-the-thomas-crown-bank-job.mp4",
        )
        self.assertEqual(clip_files.clip_file_name(1, {"start": 0, "end": 30}), "01-clip-01.mp4")

    def test_renderable_clips_drop_short_and_malformed_windows_in_order(self):
        clips = [_clip(0, 10, "short"), _clip(20, 60, "a"), _clip(70, 65, "backwards"), _clip(80, 120, "b")]
        kept, skipped = clip_files.renderable_clips(clips, min_duration=20.0)
        self.assertEqual([c["headline"] for c in kept], ["a", "b"])
        self.assertEqual([c["headline"] for c in skipped], ["short"])


class PublishLogTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.config = {
            "paths": {"output_dir": str(root / "output"), "seo_dir": str(root / "output" / "seo")},
            "settings": {"min_clip_duration_seconds": 20.0},
        }
        (root / "output" / "seo").mkdir(parents=True)
        self.candidates = [_clip(10.0 * i, 10.0 * i + 30.0, f"Bit {i}") for i in range(1, 21)]
        self.picks = [self.candidates[0], self.candidates[4], self.candidates[9]]
        seo = {"title": "T", "candidateClips": self.candidates, "clipAnalysis": self.picks}
        (root / "output" / "seo" / "20260101.seo.json").write_text(json.dumps(seo))
        clips_dir = root / "output" / "clips" / "20260101"
        clips_dir.mkdir(parents=True)
        (clips_dir / "01-bit-1.mp4").write_bytes(b"")
        self.log_path = root / "output" / "publish-decisions.json"

    def tearDown(self):
        self._tmp.cleanup()


class RenderedClipTests(PublishLogTestCase):
    def test_rendered_clips_are_the_picks_numbered_like_the_clipper(self):
        rendered = publish_log.rendered_clips(self.config, "20260101")
        self.assertEqual([r["index"] for r in rendered], [1, 2, 3])
        self.assertEqual([r["file"] for r in rendered], ["01-bit-1.mp4", "02-bit-5.mp4", "03-bit-10.mp4"])
        self.assertEqual([r["fileExists"] for r in rendered], [True, False, False])

    def test_missing_seo_file_means_nothing_rendered(self):
        self.assertEqual(publish_log.rendered_clips(self.config, "20991231"), [])


class DecisionTests(PublishLogTestCase):
    def test_mark_rendered_clip_published_parses_youtube_url(self):
        row = publish_log.mark_rendered(self.config, "20260101", 2, "published",
                                        youtube="https://youtube.com/shorts/5GS4DjHnJm0?si=x")
        self.assertEqual(row["youtubeId"], "5GS4DjHnJm0")
        self.assertEqual(row["source"], "pick")
        saved = json.loads(self.log_path.read_text())
        self.assertEqual(saved["decisions"][0]["headline"], "Bit 5")
        self.assertEqual(saved["decisions"][0]["decision"], "published")

    def test_marking_again_replaces_the_earlier_decision(self):
        publish_log.mark_rendered(self.config, "20260101", 1, "skipped", reason="weak payoff")
        publish_log.mark_rendered(self.config, "20260101", 1, "published", youtube="abcdefghijk")
        decisions = publish_log.load(self.config)["decisions"]
        self.assertEqual(len(decisions), 1)
        self.assertEqual(decisions[0]["decision"], "published")
        self.assertNotIn("reason", decisions[0])

    def test_published_candidate_that_was_not_picked_is_recorded_as_candidate(self):
        row = publish_log.mark_candidate(self.config, "20260101", 2, "published", youtube="u6bPuNm73dU")
        self.assertEqual(row["source"], "candidate")
        self.assertEqual(row["headline"], "Bit 3")

    def test_candidate_that_was_also_rendered_is_recorded_as_the_pick(self):
        row = publish_log.mark_candidate(self.config, "20260101", 4, "published", youtube="abcdefghijk")
        self.assertEqual(row["source"], "pick")
        self.assertEqual(row["file"], "02-bit-5.mp4")
        (report,) = publish_log.report(self.config, ["20260101"])
        self.assertEqual((report["published"], report["publishedNotPicked"]), (1, 0))

    def test_untracked_short_needs_only_a_label(self):
        row = publish_log.mark_untracked(self.config, "20260101", "Bingo Card", youtube="U7w5VheXhAc",
                                         note="from the pipeline; output since cleared")
        self.assertEqual(row["source"], "untracked")
        self.assertIsNone(row["start"])

    def test_rest_marks_only_undecided_rendered_clips(self):
        publish_log.mark_rendered(self.config, "20260101", 2, "published", youtube="abcdefghijk")
        rows = publish_log.mark_rest(self.config, "20260101", "skipped")
        self.assertEqual([r["headline"] for r in rows], ["Bit 1", "Bit 10"])
        by_headline = {d["headline"]: d["decision"] for d in publish_log.load(self.config)["decisions"]}
        self.assertEqual(by_headline, {"Bit 1": "skipped", "Bit 5": "published", "Bit 10": "skipped"})

    def test_rejects_unknown_decision_and_out_of_range_index(self):
        with self.assertRaises(ValueError):
            publish_log.mark_rendered(self.config, "20260101", 1, "maybe")
        with self.assertRaises(ValueError):
            publish_log.mark_rendered(self.config, "20260101", 4, "skipped")
        with self.assertRaises(ValueError):
            publish_log.mark_rendered(self.config, "20260101", 1, "published", youtube="not a video")

    def test_report_counts_decisions_and_published_non_picks(self):
        publish_log.mark_rendered(self.config, "20260101", 1, "published", youtube="abcdefghijk")
        publish_log.mark_candidate(self.config, "20260101", 2, "published", youtube="bcdefghijkl")
        publish_log.mark_rendered(self.config, "20260101", 2, "skipped")
        (row,) = publish_log.report(self.config, ["20260101"])
        self.assertEqual(row, {"stem": "20260101", "rendered": 3, "published": 1, "skipped": 1,
                               "undecided": 1, "toReview": 0, "publishedNotPicked": 1, "untracked": 0})

    def test_to_review_counts_undecided_picks_whose_file_is_on_disk(self):
        clips_dir = self.log_path.parent / "clips" / "20260101"
        (clips_dir / "02-bit-5.mp4").write_bytes(b"")
        (row,) = publish_log.report(self.config, ["20260101"])
        self.assertEqual((row["rendered"], row["undecided"], row.get("toReview")), (3, 3, 2))
        publish_log.mark_rendered(self.config, "20260101", 1, "skipped")
        (row,) = publish_log.report(self.config, ["20260101"])
        self.assertEqual((row["undecided"], row.get("toReview")), (2, 1))

    def test_tracked_stems_are_episodes_with_a_clips_folder_or_a_decision(self):
        clips_root = self.log_path.parent / "clips"
        (clips_root / "20260108").mkdir()
        (clips_root / ".DS_Store").write_bytes(b"")
        publish_log.mark_untracked(self.config, "20251225", "Bingo Card", youtube="U7w5VheXhAc")
        self.assertEqual(publish_log.tracked_stems(self.config), ["20251225", "20260101", "20260108"])


class ListingTests(PublishLogTestCase):
    """publish_log.listing: what `publish_decisions.py list` and the Clips tab both show."""

    def test_rendered_picks_carry_their_decision_and_length(self):
        publish_log.mark_rendered(self.config, "20260101", 2, "published", youtube="abcdefghijk")
        rendered = publish_log.listing(self.config, "20260101").get("rendered") or []
        self.assertEqual([(r["index"], r["file"], r["fileExists"], r["clip"]["headline"], r["seconds"]) for r in rendered],
                         [(1, "01-bit-1.mp4", True, "Bit 1", 30.0), (2, "02-bit-5.mp4", False, "Bit 5", 30.0),
                          (3, "03-bit-10.mp4", False, "Bit 10", 30.0)])
        self.assertEqual([(r["decision"] or {}).get("decision") for r in rendered], [None, "published", None])
        self.assertEqual(rendered[1]["decision"]["youtubeId"], "abcdefghijk")

    def test_every_candidate_is_listed_with_the_pick_it_was_rendered_as(self):
        publish_log.mark_candidate(self.config, "20260101", 2, "published", youtube="bcdefghijkl")
        publish_log.mark_rendered(self.config, "20260101", 2, "skipped", reason="slow")
        candidates = publish_log.listing(self.config, "20260101").get("candidates") or []
        self.assertEqual([c["index"] for c in candidates], list(range(20)))
        self.assertEqual({c["index"]: c["rendered"] for c in candidates if c["rendered"]}, {0: 1, 4: 2, 9: 3})
        self.assertEqual({c["index"]: c["decision"]["decision"] for c in candidates if c["decision"]},
                         {2: "published", 4: "skipped"})
        self.assertEqual((candidates[2]["clip"]["headline"], candidates[2]["seconds"]), ("Bit 3", 30.0))

    def test_untracked_shorts_are_listed_apart(self):
        publish_log.mark_untracked(self.config, "20260101", "Bingo Card", youtube="U7w5VheXhAc", note="clip gone")
        publish_log.mark_untracked(self.config, "20260108", "Other episode", youtube="U7w5VheXhAc")
        untracked = publish_log.listing(self.config, "20260101").get("untracked")
        self.assertEqual([(d["headline"], d["youtubeId"], d["reason"]) for d in untracked or []],
                         [("Bingo Card", "U7w5VheXhAc", "clip gone")])

    def test_an_episode_with_no_seo_file_has_an_empty_listing(self):
        self.assertEqual(publish_log.listing(self.config, "20991231"),
                         {"rendered": [], "candidates": [], "untracked": []})

    def test_a_clip_longer_than_any_published_short_is_marked(self):
        seo_path = Path(self.config["paths"]["seo_dir"]) / "20260101.seo.json"
        seo = json.loads(seo_path.read_text())
        seo["candidateClips"][1]["end"] = seo["candidateClips"][1]["start"] + 45.0   # c1: 45 s
        seo_path.write_text(json.dumps(seo))
        marks = lambda: {c["index"]: c["longerThanPublished"]  # noqa: E731
                         for c in publish_log.listing(self.config, "20260101").get("candidates") or [{"index": 0, "longerThanPublished": None}]}
        self.assertEqual(set(marks().values()), {False})  # nothing published yet: nothing to compare with
        publish_log.mark_candidate(self.config, "20260101", 2, "published", youtube="bcdefghijkl")  # 30 s
        self.assertEqual({index for index, longer in marks().items() if longer}, {1})
        rendered = publish_log.listing(self.config, "20260101").get("rendered") or [{}]
        self.assertEqual([r.get("longerThanPublished") for r in rendered], [False, False, False])


class ShortUrlTests(unittest.TestCase):
    def test_a_short_is_linked_by_its_video_id(self):
        self.assertEqual(getattr(publish_log, "short_url", lambda _: None)("abcdefghijk"),
                         "https://youtube.com/shorts/abcdefghijk")


class PublishedLengthTests(PublishLogTestCase):
    def test_before_anything_is_published_there_is_no_range(self):
        publish_log.mark_rendered(self.config, "20260101", 1, "skipped")
        self.assertEqual(publish_log.published_lengths(self.config), {"count": 0, "shortest": None, "longest": None})

    def test_the_range_covers_published_clips_with_a_known_window(self):
        seo_path = Path(self.config["paths"]["seo_dir"]) / "20260101.seo.json"
        seo = json.loads(seo_path.read_text())
        seo["candidateClips"][1]["end"] = seo["candidateClips"][1]["start"] + 62.5
        seo_path.write_text(json.dumps(seo))
        publish_log.mark_rendered(self.config, "20260101", 1, "published", youtube="abcdefghijk")     # 30 s
        publish_log.mark_candidate(self.config, "20260101", 1, "published", youtube="bcdefghijkl")    # 62.5 s
        publish_log.mark_rendered(self.config, "20260101", 3, "skipped")                              # not counted
        publish_log.mark_untracked(self.config, "20260101", "Bingo Card", youtube="U7w5VheXhAc")      # no window
        self.assertEqual(publish_log.published_lengths(self.config), {"count": 2, "shortest": 30.0, "longest": 62.5})


class DecideTests(PublishLogTestCase):
    """publish_log.decide: one entry point for the script and the Clips tab, with one set of rules."""

    def decisions(self):
        return {(d["source"], d["headline"]): d["decision"] for d in publish_log.load(self.config)["decisions"]}

    def refused(self, message, *args, **kwargs):
        with self.assertRaises(ValueError) as caught:
            publish_log.decide(self.config, *args, **kwargs)
        self.assertIn(message, str(caught.exception))

    def test_a_number_is_a_rendered_clip(self):
        for clip in ("2", 2, " 2 "):
            with self.subTest(clip=clip):
                rows = publish_log.decide(self.config, "20260101", clip, "published", youtube="abcdefghijk")
                self.assertEqual([(r["source"], r["headline"], r["youtubeId"]) for r in rows],
                                 [("pick", "Bit 5", "abcdefghijk")])
        self.assertEqual(self.decisions(), {("pick", "Bit 5"): "published"})

    def test_c_and_a_number_is_a_candidate(self):
        for clip in ("c2", "C2"):
            with self.subTest(clip=clip):
                rows = publish_log.decide(self.config, "20260101", clip, "skipped", reason="  too slow ")
                self.assertEqual([(r["source"], r["headline"], r["reason"]) for r in rows],
                                 [("candidate", "Bit 3", "too slow")])

    def test_rest_skips_every_undecided_rendered_clip(self):
        publish_log.decide(self.config, "20260101", "2", "published", youtube="abcdefghijk")
        rows = publish_log.decide(self.config, "20260101", "rest", "skipped", reason="not this week")
        self.assertEqual([(r["headline"], r["reason"]) for r in rows],
                         [("Bit 1", "not this week"), ("Bit 10", "not this week")])
        self.assertEqual(publish_log.decide(self.config, "20260101", "rest", "skipped"), [])

    def test_publishing_needs_the_shorts_address(self):
        for youtube in (None, "", "   "):
            with self.subTest(youtube=youtube):
                self.refused("publish needs the Short's YouTube URL or ID", "20260101", "1", "published",
                             youtube=youtube)
        self.refused("not a YouTube video ID or URL", "20260101", "1", "published", youtube="tomorrow")
        self.refused("rest can only be skipped", "20260101", "rest", "published", youtube="abcdefghijk")
        self.assertFalse(self.log_path.exists())

    def test_a_blank_reason_is_no_reason(self):
        (row,) = publish_log.decide(self.config, "20260101", "1", "skipped", reason="   ") or [{"reason": "?"}]
        self.assertNotIn("reason", row)

    def test_what_it_cannot_place_is_refused_and_nothing_is_written(self):
        for stem in ("../20260101", "2026010", "latest", "", None, 20260101):
            with self.subTest(stem=stem):
                self.refused("episode must be a date like 20261005", stem, "1", "skipped")
        for clip in ("x", "c", "cx", "1.5", "", None, True, "-1"):
            with self.subTest(clip=clip):
                self.refused("clip must be a rendered clip's number, c and a candidate's number, or rest",
                             "20260101", clip, "skipped")
        self.refused("rendered clip for 20260101 4 does not exist (1-3)", "20260101", "4", "skipped")
        self.refused("candidate for 20260101 21 does not exist", "20260101", "c20", "skipped")
        self.refused("decision must be one of published, skipped", "20260101", "1", "maybe")
        self.refused("reason must be text", "20260101", "1", "skipped", reason=["a"])
        self.assertFalse(self.log_path.exists())

    def test_an_untracked_short_needs_a_dated_episode_a_label_and_its_address(self):
        for stem, label, youtube, message in (
            ("../x", "Bingo Card", "U7w5VheXhAc", "episode must be a date like 20261005"),
            ("20260101", "  ", "U7w5VheXhAc", "an untracked Short needs a label"),
            ("20260101", None, "U7w5VheXhAc", "an untracked Short needs a label"),
            ("20260101", "Bingo Card", None, "an untracked Short needs its YouTube URL or ID"),
            ("20260101", "Bingo Card", "nope", "not a YouTube video ID or URL"),
        ):
            with self.subTest(stem=stem, label=label, youtube=youtube):
                with self.assertRaises(ValueError) as caught:
                    publish_log.mark_untracked(self.config, stem, label, youtube)
                self.assertIn(message, str(caught.exception))
        self.assertFalse(self.log_path.exists())
        row = publish_log.mark_untracked(self.config, "20260101", " Bingo Card ", "U7w5VheXhAc", note=" ")
        self.assertEqual((row["headline"], row["youtubeId"], "reason" in row), ("Bingo Card", "U7w5VheXhAc", False))


class ScriptTests(PublishLogTestCase):
    """scripts/publish_decisions.py, run as Tony runs it."""

    def setUp(self):
        super().setUp()
        self.root = Path(self._tmp.name).resolve()
        self.config_path = self.root / "config.json"
        self.config_path.write_text(json.dumps({
            "paths": {"output_dir": "./output", "seo_dir": "./output/seo"},
            "settings": {"min_clip_duration_seconds": 20.0},
        }))

    def run_script(self, *args):
        env = dict(os.environ, **{data_dir.ENV_VAR: str(self.root)})
        return subprocess.run(
            [sys.executable, "-S", str(ROOT / "scripts" / "publish_decisions.py"), "--config", str(self.config_path), *args],
            capture_output=True, text=True, env=env, cwd=self.root)

    def ok(self, *args):
        result = self.run_script(*args)
        self.assertEqual((result.returncode, result.stderr), (0, ""))
        return result.stdout

    def test_list_is_laid_out_as_it_always_was_and_ends_with_the_published_range(self):
        self.ok("publish", "20260101", "2", "https://youtube.com/shorts/abcdefghijk")
        self.ok("skip", "20260101", "1", "--reason", "weak payoff")
        self.ok("publish", "20260101", "c2", "bcdefghijkl")
        self.ok("untracked", "20260101", "Bingo Card", "U7w5VheXhAc", "--note", "clip gone")
        lines = self.ok("list", "20260101").splitlines()
        self.assertEqual(lines[:7], [
            "Rendered clips for 20260101:",
            "  1  01-bit-1.mp4",
            "     skipped (weak payoff)",
            "  2  02-bit-5.mp4  [file missing]",
            "     published https://youtube.com/shorts/abcdefghijk",
            "  3  03-bit-10.mp4  [file missing]",
            "     -",
        ])
        self.assertEqual(lines[7:11], [
            "Candidates (c#):",
            "  c0      10.0s   30s  Bit 1  -> skipped (weak payoff)",
            "  c1      20.0s   30s  Bit 2",
            "  c2      30.0s   30s  Bit 3  -> published https://youtube.com/shorts/bcdefghijkl",
        ])
        self.assertEqual(lines[-2:], [
            "  untracked: Bingo Card -> published https://youtube.com/shorts/U7w5VheXhAc (clip gone)",
            "Published Shorts so far run 30-30 s (2 with a known length).",
        ])
        self.assertEqual(len(lines), 7 + 1 + 20 + 2)

    def test_list_for_an_episode_with_nothing(self):
        self.assertEqual(self.ok("list", "20991231"),
                         "No rendered clips for 20991231 (no output/seo/20991231.seo.json or no picks).\n")

    def test_decisions_print_what_was_recorded(self):
        self.assertEqual(self.ok("publish", "20260101", "2", "abcdefghijk"), "20260101 published: Bit 5\n")
        self.assertEqual(self.ok("skip", "20260101", "rest"), "20260101 skipped: Bit 1\n20260101 skipped: Bit 10\n")
        self.assertEqual(self.ok("skip", "20260101", "rest"),
                         "Nothing to do: every rendered clip already has a decision.\n")
        self.assertEqual(self.ok("untracked", "20260101", "Bingo Card", "U7w5VheXhAc"),
                         "20260101 published (untracked): Bingo Card\n")
        self.assertEqual(json.loads(self.ok("report")), publish_log.report(self.config, ["20260101"]))

    def test_a_mistake_is_exit_2_with_the_reason(self):
        for args, reason in (
            (("skip", "20260101", "9"), "error: rendered clip for 20260101 9 does not exist (1-3)"),
            (("skip", "20260101", "cx"), "error: clip must be a rendered clip's number"),
            (("publish", "20260101", "1", "tomorrow"), "error: not a YouTube video ID or URL"),
            (("publish", "20260101", "rest", "abcdefghijk"), "error: rest can only be skipped"),
            (("skip", "../20260101", "1"), "error: episode must be a date like 20261005"),
        ):
            with self.subTest(args):
                result = self.run_script(*args)
                self.assertEqual((result.returncode, result.stdout), (2, ""))
                self.assertIn(reason, result.stderr)
        self.assertFalse(self.log_path.exists())


if __name__ == "__main__":
    unittest.main()
