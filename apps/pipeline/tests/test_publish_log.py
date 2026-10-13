import json
import tempfile
import unittest
from pathlib import Path

from lib import clip_files, publish_log


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


if __name__ == "__main__":
    unittest.main()
