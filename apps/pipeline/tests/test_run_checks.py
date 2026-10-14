"""The checks before a pipeline run, and the wrapper that keeps .env values out of a run's log."""
import json
import os
import signal
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from lib import run_checks
from lib.stage_status import STAGES

ROOT = Path(__file__).resolve().parents[1]
URL = "https://quiet-otter-123.convex.cloud"
SECRET = "ak_live_abcdefghij"
SIGNED_IN = {"CONVEX_URL": URL, "CLERK_MACHINE_SECRET_KEY": SECRET, "AZURE_STORAGE_CONNECTION_STRING": "Account=x;Key=y",
             "OPENROUTER_API_KEY": "sk-or-abcdefgh"}
SECRETS = sorted(SIGNED_IN.items())


def config(provider="openrouter"):
    return {"paths": {}, "settings": {"visuals_provider": provider}}


def rows(listed):
    return {row["name"]: (row["set"], row["needed"]) for row in listed}


class StageRangeTests(unittest.TestCase):
    def test_an_unattended_run_may_reach_every_stage_and_a_from_run_the_rest(self):
        self.assertEqual(run_checks.stages_in_range(None), STAGES)
        self.assertEqual(run_checks.stages_in_range("clip"), ["clip", "thumbnail", "publish"])

    def test_an_unknown_stage_is_refused(self):
        with self.assertRaisesRegex(ValueError, "stage must be one of"):
            run_checks.stages_in_range("upload")


class CredentialTests(unittest.TestCase):
    def test_names_and_set_or_not_and_never_a_value(self):
        listed = run_checks.credentials(config(), None, {**SIGNED_IN, "CONVEX_PIPELINE_TOKEN": "  "})
        self.assertEqual(set(listed[0]), {"name", "set", "needed", "use"})
        self.assertEqual(rows(listed), {
            "CONVEX_URL": (True, True),
            "CONVEX_PIPELINE_TOKEN": (False, True),
            "CLERK_MACHINE_SECRET_KEY": (True, True),
            "AZURE_STORAGE_CONNECTION_STRING": (True, True),
            "OPENROUTER_API_KEY": (True, True),
            "OPENAI_API_KEY": (False, False),
        })
        self.assertNotIn(URL, json.dumps(listed))
        self.assertNotIn(SECRET, json.dumps(listed))

    def test_azure_is_needed_only_to_find_the_newest_episode(self):
        self.assertEqual(rows(run_checks.credentials(config(), "movies", {}))["AZURE_STORAGE_CONNECTION_STRING"],
                         (False, False))

    def test_an_image_key_is_needed_only_for_the_provider_the_clip_stage_uses(self):
        for provider, stage, wanted in (("openai", "clip", {"OPENAI_API_KEY"}), ("local", "clip", set()),
                                        ("openrouter", "thumbnail", set()), ("openrouter", None, {"OPENROUTER_API_KEY"})):
            with self.subTest(provider=provider, stage=stage):
                needed = {name for name, (_, need) in rows(run_checks.credentials(config(provider), stage, {})).items()
                          if need and name.endswith("_API_KEY")}
                self.assertEqual(needed, wanted)


class NodeTests(unittest.TestCase):
    def stand_in(self, printed, code=0):
        folder = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(folder))
        path = Path(folder) / "node"
        path.write_text(f"#!/bin/sh\necho '{printed}'\nexit {code}\n")
        path.chmod(0o755)
        return str(path)

    def test_twenty_two_six_or_newer(self):
        for printed, ok in (("v22.6.0", True), ("v22.11.0", True), ("v24.1.0", True), ("v22.5.1", False),
                            ("v20.18.0", False), ("not node", False)):
            with self.subTest(printed):
                self.assertEqual(run_checks.node_version(self.stand_in(printed))[0], ok)
        self.assertEqual(run_checks.node_version(self.stand_in("v22.11.0")), (True, "v22.11.0"))

    def test_missing_or_failing(self):
        self.assertEqual(run_checks.node_version("/nonexistent/node"), (False, "not found: /nonexistent/node"))
        self.assertFalse(run_checks.node_version(self.stand_in("v22.11.0", code=1))[0])


class RunAllTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.data = Path(temp.name).resolve()
        self._env = os.environ.copy()
        self.addCleanup(lambda: (os.environ.clear(), os.environ.update(self._env)))
        os.environ["BBPC_PIPELINE_DATA_DIR"] = str(self.data)
        bin_dir = self.data / "bin"
        bin_dir.mkdir()
        self.node = bin_dir / "node"
        self.node.write_text("#!/bin/sh\necho v22.11.0\n")
        self.node.chmod(0o755)

    def run_all(self, **kw):
        options = dict(environ=SIGNED_IN, secrets=SECRETS, node=str(self.node), has_libass=lambda: True,
                       configuration=lambda: f"Transcript import target verified: {URL}\n")
        options.update(kw)
        return run_checks.run_all(config(), kw.pop("stage", None), **options)

    def test_everything_in_order_and_the_target_is_named_but_not_shown(self):
        result = self.run_all()
        self.assertTrue(result["ok"])
        self.assertEqual([(c["id"], c["ok"]) for c in result["checks"]], [
            ("data_dir", True), ("configuration", True), ("credentials", True), ("ffmpeg", True), ("node", True)])
        self.assertEqual(result["checks"][1]["detail"], "Transcript import target verified: [CONVEX_URL]")
        self.assertNotIn(URL, json.dumps(result))
        self.assertNotIn(SECRET, json.dumps(result))

    def test_each_failure_says_why_and_fails_the_whole(self):
        def refused():
            raise RuntimeError(f"The importer's configuration check failed: Target {URL} must match BBPC_EXPECTED_CONVEX_URL.")
        result = self.run_all(environ={"CONVEX_URL": URL}, configuration=refused, has_libass=lambda: False,
                              node="/nonexistent/node")
        checks = {c["id"]: c for c in result["checks"]}
        self.assertFalse(result["ok"])
        self.assertEqual({key: c["ok"] for key, c in checks.items()},
                         {"data_dir": True, "configuration": False, "credentials": False, "ffmpeg": False, "node": False})
        self.assertIn("Target [CONVEX_URL] must match", checks["configuration"]["detail"])
        self.assertEqual(checks["credentials"]["detail"],
                         "not set: CONVEX_PIPELINE_TOKEN or CLERK_MACHINE_SECRET_KEY, AZURE_STORAGE_CONNECTION_STRING, "
                         "OPENROUTER_API_KEY")
        self.assertIn("ffmpeg-full", checks["ffmpeg"]["detail"])

    def test_a_missing_data_directory(self):
        os.environ["BBPC_PIPELINE_DATA_DIR"] = str(self.data / "gone")
        checks = {c["id"]: c for c in self.run_all()["checks"]}
        self.assertEqual((checks["data_dir"]["ok"], checks["data_dir"]["detail"]), (False, f"not found: {self.data / 'gone'}"))


class ScriptTestCase(unittest.TestCase):
    """The scripts themselves, run as the dashboard runs them, against a temp data directory and stand-ins."""

    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.data = Path(temp.name)
        (self.data / ".env").write_text(f"CONVEX_URL={URL}\nCLERK_MACHINE_SECRET_KEY={SECRET}\n")
        bin_dir = self.data / "bin"
        bin_dir.mkdir()
        # node answers --version, and the importer's --check-config the way the real one does.
        (bin_dir / "node").write_text(
            "#!/bin/sh\nif [ \"$1\" = --version ]; then echo v22.11.0; exit 0; fi\n"
            "while [ \"$1\" != --url ]; do shift; done\necho \"Transcript import target verified: $2\"\n")
        (bin_dir / "ffmpeg").write_text("#!/bin/sh\necho 'Filter subtitles'\n")
        for tool in ("node", "ffmpeg"):
            (bin_dir / tool).chmod(0o755)
        self.config_path = self.data / "config.json"
        self.config_path.write_text(json.dumps({"paths": {}, "settings": {"visuals_provider": "local"}}))
        self.env = {**os.environ, "BBPC_PIPELINE_DATA_DIR": str(self.data), "PATH": f"{bin_dir}:{os.environ['PATH']}"}
        for name in (*SIGNED_IN, "CONVEX_PIPELINE_TOKEN", "BBPC_NODE_BINARY"):
            self.env.pop(name, None)

    def script(self, name, *args):
        return subprocess.run([sys.executable, str(ROOT / "scripts" / name), *args], cwd=str(ROOT), env=self.env,
                              capture_output=True, text=True, timeout=60)


class CheckRunScriptTests(ScriptTestCase):
    def test_json_for_the_dashboard_with_the_target_hidden(self):
        done = self.script("check_run.py", "--config", str(self.config_path), "--from", "movies", "--json")
        result = json.loads(done.stdout)
        self.assertEqual((done.returncode, result["ok"]), (0, True), done.stdout + done.stderr)
        self.assertEqual({c["id"]: c["ok"] for c in result["checks"]},
                         {"data_dir": True, "configuration": True, "credentials": True, "ffmpeg": True, "node": True})
        self.assertNotIn(URL, done.stdout + done.stderr)
        self.assertNotIn(SECRET, done.stdout + done.stderr)

    def test_text_for_a_terminal_and_a_failing_check_exits_1(self):
        done = self.script("check_run.py", "--config", str(self.config_path))  # unattended: Azure is needed
        self.assertEqual(done.returncode, 1, done.stdout + done.stderr)
        self.assertIn("not set: AZURE_STORAGE_CONNECTION_STRING", done.stdout)
        self.assertIn("CLERK_MACHINE_SECRET_KEY  set", done.stdout)
        self.assertNotIn(SECRET, done.stdout + done.stderr)


class RedactedRunScriptTests(ScriptTestCase):
    def test_env_values_become_names_and_the_exit_status_passes_through(self):
        child = (f"import sys; print('target {URL}'); print('key {SECRET}', file=sys.stderr, flush=True); "
                 "print('[1/8] Transcribing'); sys.exit(75)")
        done = self.script("redacted_run.py", "--", sys.executable, "-c", child)
        self.assertEqual(done.returncode, 75, done.stderr)
        self.assertEqual(sorted(done.stdout.splitlines()),
                         ["[1/8] Transcribing", "key [CLERK_MACHINE_SECRET_KEY]", "target [CONVEX_URL]"])
        self.assertEqual(done.stderr, "")

    def test_a_child_ended_by_a_signal_exits_as_a_shell_would_report_it(self):
        child = "import os, signal; os.kill(os.getpid(), signal.SIGTERM)"
        self.assertEqual(self.script("redacted_run.py", "--", sys.executable, "-c", child).returncode,
                         128 + signal.SIGTERM)

    def test_a_command_that_cannot_start(self):
        done = self.script("redacted_run.py", "--", "/nonexistent/command")
        self.assertEqual(done.returncode, 127)
        self.assertIn("could not start", done.stdout)


if __name__ == "__main__":
    unittest.main()
