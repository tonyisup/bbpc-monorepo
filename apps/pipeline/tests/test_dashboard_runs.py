"""The Runs tab: checks before a run, one run at a time, a live log, and a record of each run.

Every run here is a stand-in command. Nothing in these tests starts pipeline.py.
"""
import json
import os
import signal
import sys
import time
from pathlib import Path

import test_dashboard_server as server_tests
import test_dashboard_views as view_tests
from dashboard import run_runner, views
from dashboard_fixture import snapshot, write
from lib import pipeline_runs
from lib.stage_status import STAGES

ROOT = Path(__file__).resolve().parents[1]
CHECKS = ("data_dir", "configuration", "credentials", "ffmpeg", "node")
# What scripts/check_run.py prints, or what a broken one might.
CHECK_STAND_IN = """
import json, sys
behaviour = sys.argv[1]
if behaviour == "garbage":
    print("Traceback (most recent call last): oops")
    sys.exit(1)
checks = [{"id": c, "label": c, "ok": not (behaviour == "fail" and c == "ffmpeg"), "detail": "said " + c}
          for c in %r]
print(json.dumps({"ok": behaviour != "fail", "stage": None, "checks": checks,
                  "credentials": [{"name": "CONVEX_URL", "set": True, "needed": True, "use": "Convex"}]}))
sys.exit(0 if behaviour != "fail" else 1)
""" % (CHECKS,)
# The pipeline: says where it runs, then ends as told.
RUN_STAND_IN = """
import os, subprocess, sys, time
behaviour = sys.argv[1]
print("[1/8] stand-in", sys.argv[2:], flush=True)
print("VIRTUAL_ENV=" + os.environ.get("VIRTUAL_ENV", ""), "PATH0=" + os.environ["PATH"].split(":")[0], flush=True)
if behaviour == "slow":
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    print("child", child.pid, flush=True)
    time.sleep(60)
sys.exit(int(behaviour) if behaviour.isdigit() else 0)
"""


class RunsViewTests(view_tests.ViewsTestCase):
    def test_the_tab_lists_local_episodes_the_stages_and_who_is_waiting_for_cowork(self):
        view = views.runs(self.config, None, None)
        self.assertEqual([(e["stem"], e["number"], e["title"], e["status"], e["resumable"]) for e in view.get("episodes") or []],
                         [("20260119", None, None, "waiting", False), ("20260105", 801, "Alpha", "done", False)])
        self.assertEqual(view.get("stages"), STAGES)
        self.assertEqual((view.get("headless"), view.get("active"), view.get("elsewhere"), view.get("runs")),
                         (False, None, None, []))

    def test_an_episode_waiting_for_cowork_can_be_resumed_once_its_files_are_there(self):
        write(self.root / "output/cowork/20260119.movies.json", {"movies": []})
        (first, _) = views.runs(self.config, None, None)["episodes"]
        self.assertEqual((first["stem"], first["resumable"]), ("20260119", True))

    def test_past_runs_newest_first_with_how_each_ended(self):
        planned = pipeline_runs.plan(self.config, "from", "20260105", "clip")
        run = pipeline_runs.create_run(self.config, planned, ["python", "pipeline.py"])
        pipeline_runs.start_run(self.config, run["id"], os.getpid())
        pipeline_runs.finish_run(self.config, run["id"], 75)
        (listed,) = views.runs(self.config, None, None)["runs"]
        self.assertEqual((listed["id"], listed["status"], listed["outcome"]), (run["id"], "cowork", "handed to Cowork"))

    def test_the_header_shows_the_last_convex_check(self):
        self.assertEqual(views.header(self.config)["convex"], {"checked": False})
        check = {"ok": False, "checks": [{"id": "configuration", "ok": False, "detail": "Target must match"}]}
        self.assertEqual(views.header(self.config, check, "2026-10-14T09:00:00+00:00")["convex"],
                         {"checked": True, "ok": False, "at": "2026-10-14T09:00:00+00:00", "detail": "Target must match"})


class RunEnvTests(view_tests.ViewsTestCase):
    def test_a_run_gets_the_venv_on_its_path_as_activate_would_give_it(self):
        env = run_runner.run_env(Path("/v/venv/bin/python"), {"PATH": "/usr/bin", "HOME": "/h"})
        self.assertEqual(env, {"PATH": "/v/venv/bin:/usr/bin", "HOME": "/h", "VIRTUAL_ENV": "/v/venv",
                               "PYTHONUNBUFFERED": "1"})


class RunsServerTestCase(server_tests.LabServerTestCase):
    check_behaviour = "pass"
    run_behaviour = "0"

    def server_options(self):
        return {
            "pipeline_python": self.root / "venv/bin/python",
            "check_command": lambda python, planned, config_path: [sys.executable, "-c", CHECK_STAND_IN, self.check_behaviour],
            "run_command": lambda python, planned, config_path: [sys.executable, "-c", RUN_STAND_IN, self.run_behaviour,
                                                                 *planned["args"]],
        }

    def start(self, **request):
        return self.post("/api/runs/start", {"mode": "from", "stem": "20260105", "stage": "clip", "confirmed": True,
                                             **request})

    def wait_for(self, run_id, timeout=10.0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            run = next((r for r in self.api("/api/runs")["runs"] if r["id"] == run_id), None)
            if run and run["status"] not in ("starting", "running"):
                return run
            time.sleep(0.02)
        self.fail(f"run {run_id} did not finish")

    def log(self, run_id):
        return self.api(f"/api/runs/log?id={run_id}&offset=0")["text"]

    def outside_runs(self):
        return [row for row in snapshot(self.root) if row[0] != "output" and not row[0].startswith("output/runs")]


class RunsApiTests(RunsServerTestCase):
    def test_the_tab_is_its_view_as_json(self):
        _, config = views.load_config(self.config_path)
        page = self.api("/api/runs")
        self.assertEqual(page.get("episodes"), views.runs(config, None, None)["episodes"])
        self.assertEqual((page.get("pythonFound"), page.get("python")), (False, str(self.root / "venv/bin/python")))

    def test_checking_shows_the_command_every_check_and_that_it_writes_to_convex(self):
        status, result = self.post("/api/runs/check", {"mode": "from", "stem": "20260105", "stage": "clip"})
        self.assertEqual(status, 200, result)
        self.assertEqual([c["id"] for c in result["checks"]], [*CHECKS, "no_other_run"])
        self.assertTrue(result["ok"])
        self.assertEqual(result["command"], f"{self.root}/venv/bin/python pipeline.py {self.root}/episodes/20260105.mp3 "
                                            f"--from clip --config {self.config_path}")
        self.assertEqual((result["writesConvex"], result["stages"]), (True, ["clip", "thumbnail", "publish"]))
        self.assertEqual(result["credentials"], [{"name": "CONVEX_URL", "set": True, "needed": True, "use": "Convex"}])
        header = self.api("/api/header")["convex"]
        self.assertEqual((header["checked"], header["ok"]), (True, True))

    def test_a_run_starts_only_once_confirmed_and_its_log_is_kept(self):
        status, refused = self.start(confirmed=None)
        self.assertEqual((status, refused.get("error")), (400, "Confirm the run first: it writes to Convex."))
        self.assertFalse((self.root / "output/runs").exists())
        status, started = self.start()
        self.assertEqual((status, started["run"]["status"]), (202, "running"), started)
        run = self.wait_for(started["run"]["id"])
        self.assertEqual((run["status"], run["outcome"], run["returncode"]), ("done", "finished", 0))
        log = self.log(run["id"])
        self.assertTrue(log.startswith(f"$ {self.root}/venv/bin/python pipeline.py "), log)
        self.assertIn(f"[1/8] stand-in ['{self.root}/episodes/20260105.mp3', '--from', 'clip']", log)
        self.assertIn(f"VIRTUAL_ENV={self.root}/venv PATH0={self.root}/venv/bin", log)
        self.assertTrue(log.endswith("\nfinished (exit 0)\n"), log)
        self.assertTrue((self.root / f"output/runs/{run['id']}.log").is_file())

    def test_the_log_is_read_on_from_where_the_page_left_off(self):
        run = self.wait_for(self.start()[1]["run"]["id"])
        whole = self.api(f"/api/runs/log?id={run['id']}&offset=0")
        rest = self.api(f"/api/runs/log?id={run['id']}&offset={whole['offset'] - 5}")
        self.assertEqual(rest["text"], whole["text"][-5:])
        self.assertEqual(rest["run"]["id"], run["id"])
        for query in ("id=20990101-000000", "id=../cowork/state", "id=", f"id={run['id']}&offset=x"):
            with self.subTest(query):
                self.assertIn(self.request(f"/api/runs/log?{query}")[0].status, (400, 404))

    def test_what_the_library_refuses_is_a_400_with_its_reason(self):
        for request, message in (({"mode": "backfill"}, "mode must be one of"),
                                 ({"mode": "from", "stem": "20260112", "stage": "clip"}, "no mp3 for 20260112"),
                                 ({"mode": "resume", "stem": "20260119"}, "Cowork has not written")):
            with self.subTest(request):
                for path in ("/api/runs/check", "/api/runs/start"):
                    status, answer = self.post(path, {**request, "confirmed": True})
                    self.assertEqual(status, 400)
                    self.assertIn(message, answer["error"])
        self.assertFalse((self.root / "output/runs").exists())

    def test_runs_posts_are_guarded_like_the_labs(self):
        for kwargs in ({"token": False}, {"token": "wrong"}, {"origin": "http://evil.example"}):
            with self.subTest(kwargs):
                self.assertEqual(self.post("/api/runs/start", {"mode": "unattended", "confirmed": True}, **kwargs)[0], 403)
        self.assertFalse((self.root / "output/runs").exists())

    def test_a_run_writes_only_its_record_and_log(self):
        before = self.outside_runs()
        self.wait_for(self.start()[1]["run"]["id"])
        self.assertEqual(self.outside_runs(), before)
        self.assertEqual(len(list((self.root / "output/runs").iterdir())), 2)

    def test_no_dot_env_value_reaches_the_page_or_the_log(self):
        run = self.wait_for(self.start()[1]["run"]["id"])
        for path in ("/api/runs", f"/api/runs/log?id={run['id']}&offset=0", "/api/header"):
            with self.subTest(path):
                self.assertNotIn(b"do-not-read", self.request(path)[1])


class ExitTests(RunsServerTestCase):
    def test_exit_75_is_handed_to_cowork_never_a_failure(self):
        self.run_behaviour = "75"
        run = self.wait_for(self.start()[1]["run"]["id"])
        self.assertEqual((run["status"], run["outcome"]), ("cowork", "handed to Cowork"))
        self.assertTrue(self.log(run["id"]).endswith("\nhanded to Cowork (exit 75)\n"))

    def test_any_other_exit_is_a_failure(self):
        self.run_behaviour = "1"
        run = self.wait_for(self.start()[1]["run"]["id"])
        self.assertEqual((run["status"], run["outcome"]), ("failed", "failed"))
        self.assertTrue(self.log(run["id"]).endswith("\nfailed (exit 1)\n"))


class FailedCheckTests(RunsServerTestCase):
    check_behaviour = "fail"

    def test_a_failed_check_stops_the_run_before_it_starts(self):
        status, answer = self.start()
        self.assertEqual(status, 400)
        self.assertEqual(answer["error"], "A check failed, so the run was not started.")
        self.assertEqual([c["id"] for c in answer["checks"]["checks"] if not c["ok"]], ["ffmpeg"])
        self.assertFalse((self.root / "output/runs").exists())

    def test_checks_that_cannot_be_read_fail(self):
        self.check_behaviour = "garbage"
        status, result = self.post("/api/runs/check", {"mode": "unattended"})
        self.assertEqual((status, result["ok"]), (200, False))
        self.assertEqual(result["checks"][0]["id"], "checks")
        self.assertIn("Traceback", result["checks"][0]["detail"])


class OneAtATimeTests(RunsServerTestCase):
    run_behaviour = "slow"

    def test_a_second_run_is_refused_while_one_runs_and_the_checks_say_so(self):
        _, first = self.start()
        status, answer = self.start()
        self.assertEqual((status, answer["active"]), (409, first["run"]["id"]))
        _, result = self.post("/api/runs/check", {"mode": "unattended"})
        last = result["checks"][-1]
        self.assertEqual((last["id"], last["ok"]), ("no_other_run", False))
        self.assertIn(first["run"]["id"], last["detail"])
        self.assertEqual(self.api("/api/runs")["active"]["id"], first["run"]["id"])
        self.post("/api/runs/stop", {"id": first["run"]["id"]})

    def test_stop_ends_the_run_and_everything_it_started(self):
        _, started = self.start()
        run_id = started["run"]["id"]
        deadline = time.monotonic() + 10
        while "child " not in self.log(run_id) and time.monotonic() < deadline:
            time.sleep(0.02)
        child = int(self.log(run_id).split("child ")[1].split()[0])
        status, stopped = self.post("/api/runs/stop", {"id": run_id})
        self.assertEqual(status, 200, stopped)
        run = self.wait_for(run_id)
        self.assertEqual((run["status"], run["outcome"]), ("stopped", "stopped"))
        self.assertTrue(self.log(run_id).endswith(f"\nstopped (exit {-signal.SIGTERM})\n"), self.log(run_id))
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                os.kill(child, 0)
            except ProcessLookupError:
                break
            time.sleep(0.02)
        else:
            os.kill(child, signal.SIGKILL)
            self.fail("the run's own child was left running")

    def test_only_the_run_in_progress_can_be_stopped(self):
        for run_id in ("20990101-000000", None, "../x"):
            with self.subTest(run_id):
                self.assertEqual(self.post("/api/runs/stop", {"id": run_id})[0], 400)


class ElsewhereTests(RunsServerTestCase):
    def test_a_run_another_dashboard_is_running_blocks_this_one(self):
        _, config = views.load_config(self.config_path)
        planned = pipeline_runs.plan(config, "unattended")
        other = pipeline_runs.create_run(config, planned, ["python", "pipeline.py"])
        pipeline_runs.start_run(config, other["id"], os.getpid())  # alive: this test's own process
        status, answer = self.start()
        self.assertEqual((status, answer["active"]), (409, other["id"]))
        _, result = self.post("/api/runs/check", {"mode": "unattended"})
        self.assertFalse(result["checks"][-1]["ok"])
        self.assertEqual(self.api("/api/runs")["elsewhere"]["id"], other["id"])


class RedactedLogTests(RunsServerTestCase):
    """The real wrapper, scripts/redacted_run.py, around a stand-in that prints a .env value."""

    def server_options(self):
        options = super().server_options()
        printer = "import os; print('token', os.environ.get('SECRET_TOKEN'))"
        options["run_command"] = lambda python, planned, config_path: [
            sys.executable, "scripts/redacted_run.py", "--", sys.executable, "-c", printer]
        return options

    def test_the_value_is_logged_by_name(self):
        run = self.wait_for(self.start()[1]["run"]["id"])
        log = self.log(run["id"])
        self.assertIn("token [SECRET_TOKEN]", log)
        self.assertNotIn("do-not-read", log)
        self.assertNotIn("do-not-read", (self.root / f"output/runs/{run['id']}.log").read_text())


class RealChecksTests(RunsServerTestCase):
    """The real scripts/check_run.py against the fixture: it fails (no Convex settings), and shows names only."""

    def server_options(self):
        options = super().server_options()
        options["pipeline_python"] = Path(sys.executable)
        del options["check_command"]
        return options

    def test_names_and_set_or_not_only(self):
        status, result = self.post("/api/runs/check", {"mode": "from", "stem": "20260105", "stage": "publish"})
        self.assertEqual(status, 200, result)
        self.assertEqual([c["id"] for c in result["checks"]], [*CHECKS, "no_other_run"])
        self.assertFalse(result["ok"])
        self.assertEqual({row["name"]: row["set"] for row in result["credentials"]}["CONVEX_URL"], False)
        self.assertNotIn("do-not-read", json.dumps(result))
