import json
import tempfile
import unittest
from pathlib import Path

import pipeline
from lib import cowork_handoff, stage_status

STEM = "20260101"


def _clip(i):
    return {"start": 100.0 * i, "end": 100.0 * i + 30.0, "headline": f"Bit {i}", "imagePrompt": "p", "why": "w"}


class StageStatusTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.output = self.root / "output"
        self.config = {
            "paths": {
                "episodes_dir": str(self.root / "episodes"),
                "output_dir": str(self.output),
                "transcripts_dir": str(self.root / "transcripts"),
                "movie_extractions_dir": str(self.output / "movies"),
                "seo_dir": str(self.output / "seo"),
            },
            "settings": {"cowork_outputs_dir": str(self.output / "cowork")},
        }
        for name in ("episodes", "transcripts", "output/movies", "output/seo", "output/cowork"):
            (self.root / name).mkdir(parents=True)

    def tearDown(self):
        self._tmp.cleanup()

    def put(self, rel, payload=None):
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        if payload is None:
            path.write_bytes(b"")
        else:
            path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    def state(self, **episodes):
        self.put("output/cowork/state.json", {"version": 1, "episodes": {k.lstrip("s"): v for k, v in episodes.items()}})

    def full_episode(self, stem=STEM, clips=3):
        self.put(f"episodes/{stem}.mp3")
        self.put(f"transcripts/{stem}.json", [{"start": 0.0, "end": 10.0, "text": "hello"}])
        self.put(f"output/movies/{stem}.movies.json", {"movies": []})
        self.put(f"output/review-clips/{stem}/_manifest.json", {"episode": stem, "clips": []})
        self.put(f"output/seo/{stem}.seo.json", {"title": "T", "clipAnalysis": [_clip(1), _clip(2), _clip(3)]})
        for i in range(1, clips + 1):
            self.put(f"output/clips/{stem}/{i:02d}-bit-{i}.mp4")
        self.put(f"output/thumbnails/{stem}.png")

    def statuses(self, stem=STEM):
        rows = stage_status.stage_statuses(self.config, stem)
        self.assertEqual([row["stage"] for row in rows], stage_status.STAGES)
        return {row["stage"]: row for row in rows}

    def states(self, stem=STEM):
        return {stage: row["state"] for stage, row in self.statuses(stem).items()}


class StageListTests(unittest.TestCase):
    def test_the_pipeline_runs_the_stages_this_module_reports_on(self):
        self.assertIs(pipeline.STAGES, stage_status.STAGES)
        self.assertEqual(stage_status.STAGES, [
            "transcribe", "import_transcript", "movies", "review_clip", "parse", "clip", "thumbnail", "publish",
        ])


class StageStatusesTests(StageStatusTestCase):
    def test_a_finished_episode_has_six_checked_stages_and_two_inferred_from_state(self):
        self.full_episode()
        self.state(s20260101={"status": "done", "updatedAt": "2026-01-02T00:00:00+00:00"})
        rows = self.statuses()
        self.assertEqual({stage: row["state"] for stage, row in rows.items()}, {
            "transcribe": "done", "import_transcript": "inferred", "movies": "done", "review_clip": "done",
            "parse": "done", "clip": "done", "thumbnail": "done", "publish": "inferred",
        })
        self.assertEqual([stage for stage, row in rows.items() if not row["checked"]], ["import_transcript", "publish"])
        self.assertEqual(rows["clip"]["detail"], "3 of 3 picks rendered")
        self.assertEqual(rows["publish"]["detail"], "state.json says done; this stage leaves no local file")

    def test_a_seeded_state_entry_says_so(self):
        self.full_episode()
        self.state(s20260101={"status": "done", "note": "seeded from existing output"})
        self.assertEqual(
            self.statuses()["publish"]["detail"],
            "state.json says done (seeded from existing output); this stage leaves no local file",
        )

    def test_a_transcript_with_no_state_entry_has_unknown_import_and_publish(self):
        self.put(f"transcripts/{STEM}.json", [])
        self.state()
        rows = self.statuses()
        self.assertEqual({stage: row["state"] for stage, row in rows.items()}, {
            "transcribe": "done", "import_transcript": "unknown", "movies": "missing", "review_clip": "missing",
            "parse": "missing", "clip": "missing", "thumbnail": "missing", "publish": "unknown",
        })
        self.assertFalse(rows["import_transcript"]["checked"])
        self.assertTrue(rows["movies"]["checked"])
        self.assertEqual(rows["clip"]["detail"], "no SEO file, so no picks to render")

    def test_an_episode_handed_to_cowork_is_waiting_at_movies_and_parse(self):
        self.put(f"transcripts/{STEM}.json", [])
        self.state(s20260101={"status": "awaiting_cowork", "waitingOn": "movies"})
        self.assertEqual(self.states(), {
            "transcribe": "done", "import_transcript": "inferred", "movies": "waiting", "review_clip": "missing",
            "parse": "waiting", "clip": "missing", "thumbnail": "missing", "publish": "unknown",
        })
        self.assertEqual(
            self.statuses()["import_transcript"]["detail"],
            "state.json says awaiting_cowork, which follows the import; this stage leaves no local file",
        )

    def test_some_picks_rendered_is_partial(self):
        self.full_episode(clips=1)
        self.state()
        row = self.statuses()["clip"]
        self.assertEqual((row["state"], row["detail"]), ("partial", "1 of 3 picks rendered"))

    def test_an_empty_clips_folder_is_not_a_finished_clip_stage(self):
        # The clip stage creates output/clips/<stem>/ before it renders anything.
        self.full_episode(clips=0)
        (self.output / "clips" / STEM).mkdir(parents=True)
        self.state()
        row = self.statuses()["clip"]
        self.assertEqual((row["state"], row["detail"]), ("missing", "0 of 3 picks rendered"))

    def test_reading_status_never_creates_state_json(self):
        self.full_episode()
        self.assertEqual(self.states()["publish"], "inferred")  # seeded in memory from the SEO file
        self.assertFalse((self.output / "cowork" / "state.json").exists())


class ArtifactTests(StageStatusTestCase):
    def test_artifact_paths_are_where_each_stage_writes(self):
        paths = stage_status.artifacts(self.config, STEM)
        self.assertEqual({key: str(path.relative_to(self.root)) for key, path in paths.items()}, {
            "audio": f"episodes/{STEM}.mp3",
            "transcript": f"transcripts/{STEM}.json",
            "movies": f"output/movies/{STEM}.movies.json",
            "reviewManifest": f"output/review-clips/{STEM}/_manifest.json",
            "seo": f"output/seo/{STEM}.seo.json",
            "clips": f"output/clips/{STEM}",
            "thumbnail": f"output/thumbnails/{STEM}.png",
        })

    def test_episode_audio_comes_from_the_episodes_folder_not_the_state_entry(self):
        elsewhere = self.put(f"old-checkout/episodes/{STEM}.mp3")
        self.state(s20260101={"status": "done", "episodePath": str(elsewhere)})
        self.assertIsNone(stage_status.episode_audio(self.config, STEM))
        here = self.put(f"episodes/{STEM}.mp3")
        self.assertEqual(stage_status.episode_audio(self.config, STEM), here)


class KnownStemsTests(StageStatusTestCase):
    def test_known_stems_join_transcripts_audio_and_state_and_skip_other_files(self):
        self.put("transcripts/20260101.json", [])
        self.put("transcripts/20260108.parakeet.json", [])
        self.put("transcripts/test_large-v3.json", [])
        self.put("transcripts/.DS_Store")
        self.put("episodes/20260115.mp3")
        self.put("episodes/notes.txt")
        self.put("episodes/.DS_Store")
        self.state(s20251225={"status": cowork_handoff.STATUS_DONE})
        self.assertEqual(stage_status.known_stems(self.config), ["20251225", "20260101", "20260115"])


if __name__ == "__main__":
    unittest.main()
