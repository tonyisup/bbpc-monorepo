"""What the Runs tab may start, and the record it keeps of each run under output/runs/."""
import json
import os
import subprocess
import sys
from pathlib import Path

import test_dashboard_views as view_tests
from dashboard_fixture import snapshot, write
from lib import cowork_handoff, pipeline_runs

PY = Path("/venv/bin/python")
CONFIG = Path("/repo/apps/pipeline/config.json")


class PlanTests(view_tests.ViewsTestCase):
    def test_an_unattended_run_is_pipeline_py_with_no_episode_as_scheduled_pipeline_sh_runs_it(self):
        planned = pipeline_runs.plan(self.config, "unattended")
        self.assertEqual((planned.get("mode"), planned.get("stem"), planned.get("stage"), planned.get("args")),
                         ("unattended", None, None, []))
        self.assertEqual(pipeline_runs.pipeline_argv(PY, planned, CONFIG),
                         [str(PY), "pipeline.py", "--config", str(CONFIG)])

    def test_an_episode_from_a_stage_names_its_mp3(self):
        planned = pipeline_runs.plan(self.config, "from", "20260105", "clip")
        audio = str(self.root / "episodes/20260105.mp3")
        self.assertEqual(planned.get("args"), [audio, "--from", "clip"])
        self.assertEqual(pipeline_runs.pipeline_argv(PY, planned, CONFIG),
                         [str(PY), "pipeline.py", audio, "--from", "clip", "--config", str(CONFIG)])

    def test_resume_is_from_movies_for_an_episode_handed_to_cowork_once_its_files_are_there(self):
        with self.assertRaisesRegex(ValueError, "Cowork has not written"):
            pipeline_runs.plan(self.config, "resume", "20260119")
        write(self.root / "output/cowork/20260119.movies.json", {"movies": []})
        planned = pipeline_runs.plan(self.config, "resume", "20260119")
        self.assertEqual((planned.get("stage"), planned.get("args")),
                         ("movies", [str(self.root / "episodes/20260119.mp3"), "--from", "movies"]))

    def test_with_headless_cowork_on_resume_needs_no_files_yet(self):
        self.config["settings"]["cowork_headless"] = True
        self.assertEqual(pipeline_runs.plan(self.config, "resume", "20260119").get("stage"), "movies")

    def test_what_is_refused(self):
        cases = [
            (("backfill",), "mode must be one of unattended, from, resume"),
            (("unattended", "20260105"), "an unattended run picks its own episode"),
            (("unattended", None, "clip"), "an unattended run picks its own episode"),
            (("from", "20260112", "clip"), "no mp3 for 20260112 in"),
            (("from", "../20260105", "clip"), "episode must be a date like 20261005"),
            (("from", None, "clip"), "episode must be a date like 20261005"),
            (("from", "20260105", "upload"), "stage must be one of"),
            (("from", "20260105", None), "stage must be one of"),
            (("resume", "20260105"), "20260105 is not waiting for Cowork"),
            (("resume", "20260119", "clip"), "resume always starts from movies"),
        ]
        for args, message in cases:
            with self.subTest(args):
                with self.assertRaisesRegex(ValueError, message):
                    pipeline_runs.plan(self.config, *args)

    def test_the_run_goes_through_the_redacting_wrapper_and_the_checks_match_the_run(self):
        planned = pipeline_runs.plan(self.config, "from", "20260105", "parse")
        self.assertEqual(pipeline_runs.run_argv(PY, planned, CONFIG),
                         [str(PY), "scripts/redacted_run.py", "--", *pipeline_runs.pipeline_argv(PY, planned, CONFIG)])
        self.assertEqual(pipeline_runs.check_argv(PY, planned, CONFIG),
                         [str(PY), "scripts/check_run.py", "--config", str(CONFIG), "--json", "--from", "parse"])
        self.assertEqual(pipeline_runs.check_argv(PY, pipeline_runs.plan(self.config, "unattended"), CONFIG),
                         [str(PY), "scripts/check_run.py", "--config", str(CONFIG), "--json"])


class OutcomeTests(view_tests.ViewsTestCase):
    def test_exit_75_is_a_hand_off_never_a_failure(self):
        self.assertEqual([pipeline_runs.outcome(code) for code in (0, cowork_handoff.EXIT_AWAITING_COWORK, 1, 2, 143)],
                         ["done", "cowork", "failed", "failed", "failed"])
        self.assertEqual(pipeline_runs.outcome(-15, stopped=True), "stopped")
        self.assertEqual(pipeline_runs.outcome(0, stopped=True), "done")  # it finished before the stop reached it


class RecordTests(view_tests.ViewsTestCase):
    def start(self, mode="from", stem="20260105", stage="clip"):
        planned = pipeline_runs.plan(self.config, mode, stem, stage)
        run = pipeline_runs.create_run(self.config, planned, pipeline_runs.pipeline_argv(PY, planned, CONFIG))
        return run

    def test_a_run_is_recorded_from_start_to_finish(self):
        run = self.start()
        self.assertRegex(run.get("id", ""), r"^\d{8}-\d{6}$")
        self.assertEqual(pipeline_runs.runs_dir(self.config), self.root / "output/runs")
        self.assertEqual((run["status"], run["mode"], run["stem"], run["stage"]), ("starting", "from", "20260105", "clip"))
        self.assertEqual(run["command"], f"{PY} pipeline.py {self.root}/episodes/20260105.mp3 --from clip --config {CONFIG}")
        self.assertEqual(pipeline_runs.log_path(self.config, run["id"]), self.root / f"output/runs/{run['id']}.log")
        self.assertEqual(pipeline_runs.start_run(self.config, run["id"], 4242)["status"], "running")
        finished = pipeline_runs.finish_run(self.config, run["id"], 75)
        self.assertEqual((finished["status"], finished["returncode"], finished["pid"]), ("cowork", 75, 4242))
        self.assertTrue(finished["startedAt"] and finished["finishedAt"])
        self.assertEqual(pipeline_runs.load_run(self.config, run["id"]), finished)

    def test_two_runs_in_the_same_second_get_their_own_records(self):
        first, second = self.start(), self.start()
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual([run["id"] for run in pipeline_runs.list_runs(self.config)], [second["id"], first["id"]])

    def test_a_run_left_running_by_a_dashboard_that_stopped_is_interrupted(self):
        run = self.start()
        dead = subprocess.run([sys.executable, "-c", "import os; print(os.getpid())"], capture_output=True, text=True)
        pipeline_runs.start_run(self.config, run["id"], int(dead.stdout))
        (listed,) = pipeline_runs.list_runs(self.config)
        self.assertEqual(listed["status"], "interrupted")
        self.assertIsNone(pipeline_runs.running_elsewhere(self.config))

    def test_a_run_another_dashboard_is_still_running_is_seen(self):
        run = self.start()
        pipeline_runs.start_run(self.config, run["id"], os.getpid())  # alive: this test's own process
        self.assertEqual(pipeline_runs.list_runs(self.config)[0]["status"], "running")
        self.assertEqual(pipeline_runs.running_elsewhere(self.config)["id"], run["id"])
        self.assertIsNone(pipeline_runs.running_elsewhere(self.config, active=run["id"]))

    def test_the_log_is_read_on_from_where_the_page_left_off(self):
        run = self.start()
        log = pipeline_runs.log_path(self.config, run["id"])
        log.write_bytes("[1/8] Transcribing\n50% █\n".encode())
        first = pipeline_runs.read_log(self.config, run["id"])
        self.assertEqual(first, {"text": "[1/8] Transcribing\n50% █\n", "offset": log.stat().st_size,
                                 "size": log.stat().st_size})
        with log.open("ab") as f:
            f.write(b"[2/8] Importing\n")
        self.assertEqual(pipeline_runs.read_log(self.config, run["id"], first["offset"])["text"], "[2/8] Importing\n")
        self.assertEqual(pipeline_runs.read_log(self.config, run["id"], 0, max_bytes=5)["text"], "[1/8]")

    def test_a_long_log_from_the_start_begins_at_its_end(self):
        run = self.start()
        pipeline_runs.log_path(self.config, run["id"]).write_bytes(b"x" * 100 + b"\nlast line\n")
        self.assertEqual(pipeline_runs.read_log(self.config, run["id"], -1, max_bytes=20)["text"], "last line\n")

    def test_unknown_runs_and_names_that_are_not_runs(self):
        self.start()
        write(self.root / "output/runs/notes.json", {"id": "notes.json"})
        for run_id in ("20990101-000000", "../cowork/state", "notes", "", None, 7):
            with self.subTest(run_id):
                self.assertIsNone(pipeline_runs.load_run(self.config, run_id))
                self.assertIsNone(pipeline_runs.read_log(self.config, run_id))
        self.assertEqual(len(pipeline_runs.list_runs(self.config)), 1)

    def test_planning_and_reading_write_nothing(self):
        run = self.start()
        before = snapshot(self.root)
        pipeline_runs.plan(self.config, "from", "20260105", "clip")
        pipeline_runs.list_runs(self.config)
        pipeline_runs.read_log(self.config, run["id"])
        pipeline_runs.running_elsewhere(self.config)
        self.assertEqual(snapshot(self.root), before)
        self.assertEqual(json.loads((self.root / f"output/runs/{run['id']}.json").read_text())["status"], "starting")
