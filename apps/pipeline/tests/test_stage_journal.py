import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pipeline
from dashboard_fixture import snapshot
from lib import cowork_handoff, stage_journal
from lib.stage_status import STAGES

STEM = "20260101"
T1, T2 = "2026-10-14T19:00:00+00:00", "2026-10-14T19:05:00+00:00"
# What each stage's module is called as in pipeline._run_stages.
STAGE_CALLS = {
    "transcribe": "transcriber", "import_transcript": "transcript_importer", "movies": "movie_extractor",
    "review_clip": "review_clipper", "parse": "parser", "clip": "clipper", "thumbnail": "thumbnail",
    "publish": "publisher",
}


class JournalTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name).resolve()
        self.config = {"paths": {"output_dir": str(self.root / "output")},
                       "settings": {"cowork_outputs_dir": str(self.root / "output" / "cowork")}}
        self.path = self.root / "output" / "journal" / f"{STEM}.jsonl"

    def lines(self):
        return [json.loads(line) for line in self.path.read_text(encoding="utf-8").splitlines()]


class JournalFileTests(JournalTestCase):
    def test_each_stage_run_is_one_line_appended_to_the_episodes_journal(self):
        self.assertEqual(stage_journal.journal_path(self.config, STEM), self.path)
        stage_journal.record(self.config, STEM, "clip", "done", started_at=T1, finished_at=T2)
        stage_journal.record(self.config, STEM, "publish", "failed", started_at=T1, finished_at=T2,
                             detail="RuntimeError: No episode found")
        self.assertEqual(self.lines(), [
            {"stage": "clip", "outcome": "done", "startedAt": T1, "finishedAt": T2},
            {"stage": "publish", "outcome": "failed", "startedAt": T1, "finishedAt": T2,
             "detail": "RuntimeError: No episode found"},
        ])
        self.assertEqual(stage_journal.entries(self.config, STEM), self.lines())

    def test_only_known_outcomes_are_recorded(self):
        self.assertEqual(stage_journal.OUTCOMES, ("done", "failed", "awaiting_cowork", "dry_run", "interrupted"))
        with self.assertRaises(ValueError):
            stage_journal.record(self.config, STEM, "clip", "finished", started_at=T1)
        self.assertFalse(self.path.exists())

    def test_a_line_cut_short_is_skipped_and_reading_writes_nothing(self):
        self.assertEqual(stage_journal.entries(self.config, STEM), [])
        before = snapshot(self.root)
        stage_journal.entries(self.config, STEM)
        self.assertEqual(snapshot(self.root), before)
        self.path.parent.mkdir(parents=True)
        self.path.write_text('{"stage": "clip", "outcome": "done", "startedAt": "a", "finishedAt": "b"}\n'
                             '[1, 2]\n{"stage": "publish", "outc', encoding="utf-8")
        self.assertEqual([e["stage"] for e in stage_journal.entries(self.config, STEM)], ["clip"])


class PipelineJournalTests(JournalTestCase):
    """pipeline._run_stages writes a journal line as each stage ends."""

    def setUp(self):
        super().setUp()
        self.episode = self.root / f"{STEM}.mp3"
        self.context = {"config": self.config, "episode_path": str(self.episode),
                        "transcript_path": str(self.root / f"{STEM}.json")}
        # Credentials come from the environment here: no .env file is read.
        env = mock.patch.dict(os.environ, {"BBPC_PIPELINE_DATA_DIR": str(self.root),
                                           "CONVEX_URL": "https://quiet-otter-123.convex.cloud"})
        env.start()
        self.addCleanup(env.stop)

    def run_stages(self, only=None, from_stage=None, **failures):
        """Run with every stage module stubbed; ``failures`` maps a stage to the exception it raises."""
        args = mock.Mock(only=only, from_stage=from_stage, fresh_transcript=False)
        with contextlib.ExitStack() as stack:
            ran = []
            for stage, module in STAGE_CALLS.items():
                def call(*_, stage=stage, **__):
                    ran.append(stage)
                    if stage in failures:
                        raise failures[stage]
                    return str(self.root / f"{STEM}.json")
                stack.enter_context(mock.patch.object(getattr(pipeline, module), "run", side_effect=call))
            stack.enter_context(mock.patch.object(pipeline.transcriber, "engine_from_settings", return_value=("e", "m")))
            stack.enter_context(mock.patch.object(pipeline, "_ensure_cowork_outputs"))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            try:
                pipeline._run_stages(args, self.context, self.episode, self.root / f"{STEM}.json")
            finally:
                self.ran = ran

    def test_every_stage_that_runs_is_journaled_in_order(self):
        self.run_stages()
        self.assertEqual([(e["stage"], e["outcome"]) for e in stage_journal.entries(self.config, STEM)],
                         [(stage, "done") for stage in STAGES])
        self.run_stages(only="clip")
        self.assertEqual(stage_journal.entries(self.config, STEM)[-1]["stage"], "clip")
        self.assertEqual(len(stage_journal.entries(self.config, STEM)), len(STAGES) + 1)

    def test_a_failed_stage_is_journaled_with_its_error_and_still_raises(self):
        with self.assertRaises(RuntimeError):
            self.run_stages(from_stage="parse", publish=RuntimeError("Convex at https://quiet-otter-123.convex.cloud said no"))
        entries = stage_journal.entries(self.config, STEM)
        self.assertEqual([(e["stage"], e["outcome"]) for e in entries],
                         [("parse", "done"), ("clip", "done"), ("thumbnail", "done"), ("publish", "failed")])
        # No .env value is written to the journal.
        self.assertEqual(entries[-1]["detail"], "RuntimeError: Convex at [CONVEX_URL] said no")
        self.assertNotIn("quiet-otter", self.path.read_text(encoding="utf-8"))

    def test_a_hand_off_to_cowork_is_journaled_as_awaiting_and_stops_the_run(self):
        waiting = cowork_handoff.AwaitingCowork(STEM, "movies", self.root / "m.json")
        with self.assertRaises(cowork_handoff.AwaitingCowork):
            self.run_stages(from_stage="movies", movies=waiting)
        self.assertEqual([(e["stage"], e["outcome"]) for e in stage_journal.entries(self.config, STEM)],
                         [("movies", "awaiting_cowork")])
        self.assertEqual(self.ran, ["movies"])

    def test_an_interrupted_stage_is_journaled_as_interrupted(self):
        with self.assertRaises(KeyboardInterrupt):
            self.run_stages(only="clip", clip=KeyboardInterrupt())
        self.assertEqual(stage_journal.entries(self.config, STEM)[-1]["outcome"], "interrupted")

    def test_an_import_dry_run_is_journaled_as_a_dry_run(self):
        self.context["transcript_dry_run"] = True
        self.run_stages(only="import_transcript")
        self.assertEqual([(e["stage"], e["outcome"]) for e in stage_journal.entries(self.config, STEM)],
                         [("import_transcript", "dry_run")])

    def test_a_journal_that_cannot_be_written_never_stops_the_pipeline(self):
        self.path.parent.parent.mkdir(parents=True)
        self.path.parent.write_text("not a folder")  # output/journal is a file
        out = io.StringIO()
        with contextlib.redirect_stderr(out):
            self.run_stages(from_stage="thumbnail")
        self.assertEqual(self.ran, ["thumbnail", "publish"])
        self.assertIn("could not write the stage journal", out.getvalue())


if __name__ == "__main__":
    unittest.main()
