import http.client
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

import dashboard_fixture
from dashboard import server, views
from dashboard_fixture import snapshot
from lib import data_dir, lab

ROOT = Path(__file__).resolve().parents[1]
MP3 = dashboard_fixture.MP3_BYTES
JSON = "application/json; charset=utf-8"


class RangeTests(unittest.TestCase):
    def test_a_single_byte_range_is_clamped_to_the_file(self):
        cases = [
            ("bytes=100-199", (100, 199)), ("bytes=0-0", (0, 0)), ("bytes=10000-", (10000, 10239)),
            ("bytes=-16", (10224, 10239)), ("bytes=5000-99999", (5000, 10239)), ("bytes=-99999", (0, 10239)),
            (" bytes=100-199 ", (100, 199)),
        ]
        for header, expected in cases:
            with self.subTest(header):
                self.assertEqual(server.parse_range(header, 10240), expected)

    def test_no_range_or_one_this_server_does_not_serve_means_the_whole_file(self):
        for header in (None, "", "bytes=abc", "bytes=0-1,5-6", "bytes=-", "items=0-5", "bytes=9-3"):
            with self.subTest(header):
                self.assertIsNone(server.parse_range(header, 10240))
        self.assertEqual(server.parse_range("bytes=0-", 10240), (0, 10239))  # a real range still works

    def test_a_range_past_the_end_cannot_be_satisfied(self):
        for header, size in (("bytes=10240-", 10240), ("bytes=20000-20010", 10240), ("bytes=-0", 10240), ("bytes=0-", 0)):
            with self.subTest(header):
                with self.assertRaises(server.Unsatisfiable):
                    server.parse_range(header, size)


class ArgumentTests(unittest.TestCase):
    def test_the_port_is_fixed_unless_port_is_given(self):
        self.assertEqual(server.parse_args([]).port, server.DEFAULT_PORT)
        self.assertEqual(server.DEFAULT_PORT, 8765)
        self.assertEqual(server.parse_args(["--port", "9001"]).port, 9001)
        self.assertEqual(Path(server.parse_args([]).config), ROOT / "config.json")

    def test_lab_renders_use_the_checkouts_venv_unless_told_otherwise(self):
        self.assertEqual(Path(server.parse_args([]).pipeline_python), ROOT / "venv" / "bin" / "python")
        self.assertEqual(server.parse_args(["--pipeline-python", "/x/venv/bin/python"]).pipeline_python,
                         "/x/venv/bin/python")

    def test_it_stops_when_the_data_directory_is_missing(self):
        with mock.patch.dict(os.environ, {data_dir.ENV_VAR: "/nonexistent/bbpc-data"}):
            with self.assertRaises(SystemExit) as stopped:
                server.main(["--port", "0"])
        self.assertIn("Pipeline data directory not found", str(stopped.exception))


class ServerTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name).resolve()
        self.config = dashboard_fixture.build(self.root)
        self.config_path = self.root / "config.json"
        self.config_path.write_text(json.dumps({
            "paths": {"episodes_dir": "./episodes", "output_dir": "./output", "transcripts_dir": "./transcripts",
                      "movie_extractions_dir": "./output/movies", "seo_dir": "./output/seo"},
            "settings": {"cowork_outputs_dir": "./output/cowork", "clip_duration": 60},
        }))
        patcher = mock.patch.dict(os.environ, {data_dir.ENV_VAR: str(self.root)})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.server = server.make_server(self.config_path, port=0, **self.server_options())
        self.port = self.server.server_address[1]
        thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def server_options(self):
        return {}

    def request(self, path, method="GET", host="", headers=None, body=None):
        """One request on its own connection; ``host=None`` sends no Host header."""
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        self.addCleanup(conn.close)
        conn.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
        if host is not None:
            conn.putheader("Host", host or f"127.0.0.1:{self.port}")
        for name, value in (headers or {}).items():
            conn.putheader(name, value)
        if body is not None:
            conn.putheader("Content-Length", str(len(body)))
        conn.endheaders(body)
        response = conn.getresponse()
        return response, response.read()

    def status(self, path, **kwargs):
        return self.request(path, **kwargs)[0].status

    def api(self, path):
        response, body = self.request(path)
        self.assertEqual((response.status, response.getheader("Content-Type")), (200, JSON))
        return json.loads(body)


class BindingTests(ServerTestCase):
    def test_it_listens_on_loopback_only(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")

    def test_only_this_servers_own_host_names_are_answered(self):
        for host in (f"127.0.0.1:{self.port}", f"localhost:{self.port}", f"LOCALHOST:{self.port}"):
            with self.subTest(host):
                self.assertEqual(self.status("/api/header", host=host), 200)
        refused = ("evil.example", f"evil.example:{self.port}", f"127.0.0.1:{self.port + 1}", "127.0.0.1",
                   "localhost", f"127.0.0.1.evil.example:{self.port}", f"[::1]:{self.port}", None)
        for host in refused:
            with self.subTest(host):
                response, body = self.request("/api/today", host=host)
                self.assertEqual(response.status, 403)
                self.assertNotIn(b"needs", body)
                self.assertEqual(self.status("/media/episodes/20260105.mp3", host=host), 403)
                self.assertEqual(self.status("/", host=host), 403)

    def test_only_get_is_served(self):
        for method in ("POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"):
            for path in ("/api/today", "/", "/media/episodes/20260105.mp3"):
                with self.subTest(method=method, path=path):
                    response, body = self.request(path, method=method, body=b"{}" if method != "HEAD" else None)
                    self.assertEqual((response.status, response.getheader("Allow")), (405, "GET"))
                    self.assertNotIn(b"needs", body)


class ApiTests(ServerTestCase):
    def test_each_tab_is_its_view_as_json(self):
        raw, config = views.load_config(self.config_path)
        self.assertEqual(config["paths"], self.config["paths"])
        round_trip = lambda value: json.loads(json.dumps(value))  # noqa: E731
        self.assertEqual(self.api("/api/header"), {**round_trip(views.header(config)), "token": self.server.token})
        self.assertEqual(self.api("/api/today"), round_trip(views.today(config)))
        self.assertEqual(self.api("/api/episodes"), round_trip(views.episodes(config)))
        self.assertEqual(self.api("/api/episode?stem=20260105"), round_trip(views.episode(config, "20260105")))
        self.assertEqual(self.api("/api/settings"), round_trip(views.settings(raw, config)))
        self.assertEqual(self.api("/api/today")["archive"]["transcripts"], 4)

    def test_responses_are_not_cached_or_sniffed(self):
        response, _ = self.request("/api/today")
        self.assertEqual(response.getheader("Cache-Control"), "no-store")
        self.assertEqual(response.getheader("X-Content-Type-Options"), "nosniff")

    def test_unknown_episodes_and_paths_are_404(self):
        for path in ("/api/episode?stem=20991231", "/api/episode", "/api/episode?stem=../../etc/passwd",
                     "/api/nope", "/nope", "/api/", "/apitoday"):
            with self.subTest(path):
                response, body = self.request(path)
                self.assertEqual((response.status, response.getheader("Content-Type")), (404, JSON))
                self.assertIn("error", json.loads(body))

    def test_a_view_that_fails_is_a_500_and_the_server_keeps_running(self):
        with mock.patch.object(views, "today", side_effect=RuntimeError("boom")), \
                mock.patch("traceback.print_exc"):
            response, body = self.request("/api/today")
        self.assertEqual((response.status, json.loads(body or b"{}")), (500, {"error": "RuntimeError: boom"}))
        self.assertEqual(self.status("/api/today"), 200)

    def test_config_json_is_read_again_on_every_request(self):
        self.assertEqual(self.api("/api/settings")["check"]["unread"], ["clip_duration"])
        config = json.loads(self.config_path.read_text())
        del config["settings"]["clip_duration"]
        self.config_path.write_text(json.dumps(config))
        self.assertEqual(self.api("/api/settings")["check"]["unread"], [])


class StaticTests(ServerTestCase):
    def test_the_page_and_its_two_files_are_served_with_a_strict_content_policy(self):
        expected = (("/", "text/html; charset=utf-8", b"<title>BBPC pipeline</title>"),
                    ("/static/app.js", "text/javascript; charset=utf-8", b"/api/today"),
                    ("/static/style.css", "text/css; charset=utf-8", b"--border"))
        for path, content_type, marker in expected:
            with self.subTest(path):
                response, body = self.request(path)
                self.assertEqual((response.status, response.getheader("Content-Type")), (200, content_type))
                self.assertIn(marker, body)
        policy = self.request("/")[0].getheader("Content-Security-Policy") or ""
        self.assertIn("default-src 'none'", policy)
        self.assertIn("script-src 'self'", policy)
        self.assertNotIn("unsafe", policy)
        self.assertNotIn("http", policy)

    def test_the_page_loads_nothing_from_another_host(self):
        for name in ("index.html", "app.js", "style.css"):
            text = (ROOT / "dashboard" / "static" / name).read_text(encoding="utf-8")
            with self.subTest(name):
                self.assertGreater(len(text), 200)
                for marker in ("http://", "https://", "//cdn", "@import"):
                    self.assertNotIn(marker, text)

    def test_nothing_else_under_the_dashboard_folder_is_served(self):
        for path in ("/static/../server.py", "/static/%2e%2e/server.py", "/static/", "/static/index.html/x",
                     "/static/nope.js", "/static/..%2Fviews.py", "/server.py"):
            with self.subTest(path):
                self.assertEqual(self.status(path), 404)

    def test_the_two_cowork_documents_are_served_as_text_and_nothing_else_is(self):
        response, body = self.request("/docs/cowork-handoff.md")
        self.assertEqual((response.status, response.getheader("Content-Type")), (200, "text/plain; charset=utf-8"))
        self.assertEqual(body, (ROOT / "docs" / "cowork-handoff.md").read_bytes())
        self.assertEqual(self.status("/docs/show-format.md"), 200)
        for path in ("/docs/../config.json", "/docs/%2e%2e/config.json", "/docs/plans", "/docs/", "/docs/README.md"):
            with self.subTest(path):
                self.assertEqual(self.status(path), 404)


class MediaTests(ServerTestCase):
    def test_a_whole_file(self):
        response, body = self.request("/media/episodes/20260105.mp3")
        self.assertEqual(response.status, 200)
        self.assertEqual(body, MP3)
        self.assertEqual({name: response.getheader(name) for name in ("Content-Type", "Content-Length", "Accept-Ranges")},
                         {"Content-Type": "audio/mpeg", "Content-Length": "10240", "Accept-Ranges": "bytes"})
        response, body = self.request("/media/output/thumbnails/20260105.png")
        self.assertEqual((response.status, response.getheader("Content-Type"), body), (200, "image/png", b"\x89PNG fake"))
        response, body = self.request("/media/output/clips/20260105/02-bit-5.mp4")
        self.assertEqual((response.status, response.getheader("Content-Type"), body), (200, "video/mp4", b"videovideo"))

    def test_a_byte_range_so_the_browser_can_seek(self):
        cases = [("bytes=100-199", "bytes 100-199/10240", MP3[100:200]),
                 ("bytes=10000-", "bytes 10000-10239/10240", MP3[10000:]),
                 ("bytes=-16", "bytes 10224-10239/10240", MP3[-16:]),
                 ("bytes=0-0", "bytes 0-0/10240", MP3[:1])]
        for header, content_range, expected in cases:
            with self.subTest(header):
                response, body = self.request("/media/episodes/20260105.mp3", headers={"Range": header})
                self.assertEqual(response.status, 206)
                self.assertEqual(response.getheader("Content-Range"), content_range)
                self.assertEqual(response.getheader("Content-Length"), str(len(expected)))
                self.assertEqual(body, expected)

    def test_a_range_past_the_end_is_416_and_an_unsupported_one_gets_the_whole_file(self):
        response, body = self.request("/media/episodes/20260105.mp3", headers={"Range": "bytes=20000-"})
        self.assertEqual((response.status, response.getheader("Content-Range"), body), (416, "bytes */10240", b""))
        response, body = self.request("/media/episodes/20260105.mp3", headers={"Range": "bytes=0-1,5-6"})
        self.assertEqual((response.status, body), (200, MP3))

    def test_a_file_name_with_awkward_characters_round_trips_through_its_url(self):
        path = self.root / "output/clips/20260105/04-it's 100% #1?.mp4"
        path.write_bytes(b"odd name")
        url = views.media_url(self.config, path)
        self.assertEqual(self.request(url), (mock.ANY, b"odd name"))
        self.assertEqual(self.status(url), 200)

    def test_only_media_under_episodes_and_output_is_served(self):
        outside = self.root.parent / f"{self.root.name}-outside.mp3"
        outside.write_bytes(b"outside the data directory")
        self.addCleanup(outside.unlink)
        out = self.root / "output"
        (out / "leak.mp3").symlink_to(outside)
        (out / "alias.png").symlink_to(out / ".hidden.png")
        (out / "inside.png").symlink_to(out / "thumbnails/20260105.png")
        dashboard_fixture.write(out / ".secret/clip.mp4", data=b"dot folder")
        dashboard_fixture.write(self.root / "transcripts/tone.mp3", data=b"wrong root")
        refused = [
            "/media/episodes/../.env", "/media/output/../.env", "/media/output/%2e%2e/.env",
            "/media/episodes/..%2F.env", "/media/episodes/%2e%2e%2f.env", "/media/.env", "/media/output/..",
            "/media/output/.hidden.png", "/media/output/.secret/clip.mp4", "/media/output/alias.png",
            "/media/output/leak.mp3", "/media/transcripts/tone.mp3", "/media/transcripts/20260105.json",
            "/media/output/cowork/state.json", "/media/output/cowork/notes.json",
            "/media/output/publish-decisions.json", "/media/output/seo/20260105.seo.json",
            "/media/output/clips/20260105", "/media/output/clips/20260105/", "/media/output/missing.mp4",
            "/media/output", "/media/", "/media", "/media//etc/passwd", "/media/output//etc/passwd",
            "/media/output/clips%5C20260105%5C01-bit-1.mp4", "/media/output/thumbnails/20260105.png%00.json",
            f"/media/output/../../{outside.name}", f"/media/episodes/%2e%2e/%2e%2e/{outside.name}",
        ]
        for path in refused:
            with self.subTest(path):
                response, body = self.request(path)
                self.assertEqual(response.status, 404)
                self.assertNotIn(b"do-not-read", body)
                self.assertNotIn(b"outside the data directory", body)
        self.assertEqual(self.status("/media/output/inside.png"), 200)  # a link that stays inside is fine

    def test_media_file_refuses_roots_that_have_left_the_data_directory(self):
        elsewhere = tempfile.TemporaryDirectory()
        self.addCleanup(elsewhere.cleanup)
        moved = Path(elsewhere.name).resolve() / "episodes"
        dashboard_fixture.write(moved / "20260105.mp3", data=b"elsewhere")
        self.assertEqual(server.media_file(self.config, ["episodes", "20260105.mp3"]),
                         self.root / "episodes/20260105.mp3")
        config = {"paths": dict(self.config["paths"], episodes_dir=str(moved))}
        self.assertIsNone(server.media_file(config, ["episodes", "20260105.mp3"]))


# A stand-in for `pipeline.py --only clip`: writes the clip the run expects and says what it saw.
STAND_IN = """
import os, pathlib, sys, time
clip, behaviour = pathlib.Path(sys.argv[1]), sys.argv[2]
print("image key:", repr(os.environ.get("OPENROUTER_API_KEY")), flush=True)
if behaviour == "slow":
    time.sleep(30)
if behaviour == "crash":
    sys.exit(3)
clip.parent.mkdir(parents=True, exist_ok=True)
clip.write_bytes(b"lab video")
print("Clip saved:", clip.name)
"""


class LabServerTestCase(ServerTestCase):
    behaviour = "render"

    def server_options(self):
        def command(config, run, python):
            clip = lab.lab_dir(config) / run["id"] / run["clipFile"]
            return [sys.executable, "-c", STAND_IN, str(clip), self.behaviour]
        return {"lab_command": command}

    def setUp(self):
        super().setUp()
        self.token = self.api("/api/header").get("token") or ""
        self.lab = self.root / "output" / "lab"

    def post(self, path, payload, token=None, origin="", content_type="application/json", host="", raw=None):
        headers = {"Content-Type": content_type}
        if origin is not None:
            headers["Origin"] = origin or f"http://127.0.0.1:{self.port}"
        if token is not False:
            headers["X-Dashboard-Token"] = self.token if token is None else token
        body = raw if raw is not None else json.dumps(payload).encode()
        response, answer = self.request(path, method="POST", headers=headers, body=body, host=host)
        try:
            return response.status, json.loads(answer or b"null")
        except ValueError:
            return response.status, answer

    def render(self, **request):
        request = {"stem": "20260105", "clip": "pick-2", "stage": "clip", **request}
        return self.post("/api/lab/runs", request)

    def wait_for(self, run_id, timeout=10.0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            run = self.api(f"/api/lab/run?id={run_id}")
            if run["run"]["status"] not in ("ready", "running"):
                return run
            time.sleep(0.02)
        self.fail(f"run {run_id} did not finish")

    def outside_lab(self):
        return [row for row in snapshot(self.root) if row[0] != "output" and not row[0].startswith("output/lab")]


class PostGuardTests(LabServerTestCase):
    def test_the_page_gets_a_token_made_when_the_server_started(self):
        self.assertGreaterEqual(len(self.token), 32)
        other = server.make_server(self.config_path, port=0)
        self.addCleanup(other.server_close)
        self.assertNotEqual(getattr(other, "token", self.token), self.token)

    def test_a_post_needs_the_token_this_servers_origin_and_a_json_body(self):
        draft = {"title": "Tight", "overrides": {"caption_font_size": 60}}
        port = self.port
        refused = [
            ("no token", dict(token=False), 403),
            ("wrong token", dict(token="x" * 43), 403),
            ("empty token", dict(token=""), 403),
            ("no Origin", dict(origin=None), 403),
            ("another site", dict(origin="http://evil.example"), 403),
            ("another port", dict(origin=f"http://127.0.0.1:{port + 1}"), 403),
            ("https", dict(origin=f"https://127.0.0.1:{port}"), 403),
            ("null origin", dict(origin="null"), 403),
            ("another host", dict(host=f"evil.example:{port}"), 403),
            ("a form post", dict(content_type="application/x-www-form-urlencoded"), 415),
            ("plain text", dict(content_type="text/plain"), 415),
            ("not JSON", dict(raw=b"{title"), 400),
            ("not an object", dict(raw=b"[1, 2]"), 400),
            ("too large", dict(raw=b'{"title": "' + b"x" * 70000 + b'"}'), 413),
        ]
        before = snapshot(self.root)
        for label, how, status in refused:
            with self.subTest(label):
                self.assertEqual(self.post("/api/lab/drafts", draft, **how)[0], status)
        self.assertEqual(snapshot(self.root), before)
        for origin in (f"http://127.0.0.1:{port}", f"http://localhost:{port}"):
            with self.subTest(origin):
                self.assertEqual(self.post("/api/lab/drafts", draft, origin=origin)[0], 200)

    def test_only_the_lab_shirts_and_clips_paths_take_posts(self):
        for path in ("/api/today", "/api/settings", "/", "/media/episodes/20260105.mp3", "/api/lab"):
            with self.subTest(path):
                response, _ = self.request(path, method="POST", body=b"{}", headers={
                    "Content-Type": "application/json", "Origin": f"http://127.0.0.1:{self.port}",
                    "X-Dashboard-Token": self.token})
                self.assertEqual((response.status, response.getheader("Allow")), (405, "GET"))
        for path in ("/api/lab/nope", "/api/lab/run", "/api/lab/"):
            self.assertEqual(self.post(path, {})[0], 404)


class LabDraftApiTests(LabServerTestCase):
    def test_a_draft_is_saved_listed_and_deleted(self):
        status, saved = self.post("/api/lab/drafts", {"title": "Tight captions",
                                                      "overrides": {"caption_font_size": 60, "caption_max_lines": 2}})
        self.assertEqual((status, saved["draft"]["name"], saved["draft"]["overrides"]),
                         (200, "tight-captions", {"caption_font_size": 60}))
        listed = self.api("/api/lab")["drafts"]
        self.assertEqual([(d["name"], d["changes"]) for d in listed],
                         [("tight-captions", [{"key": "caption_font_size", "from": 84, "to": 60}])])
        self.assertEqual(self.api("/api/settings")["drafts"], listed)
        status, updated = self.post("/api/lab/drafts", {"name": "tight-captions", "title": "Tight captions",
                                                        "overrides": {"caption_font_size": 72}})
        self.assertEqual((status, updated["draft"]["overrides"]), (200, {"caption_font_size": 72}))
        self.assertEqual(self.post("/api/lab/drafts/delete", {"name": "tight-captions"}), (200, {"deleted": True}))
        self.assertEqual(self.post("/api/lab/drafts/delete", {"name": "tight-captions"}), (200, {"deleted": False}))
        self.assertEqual(self.api("/api/lab")["drafts"], [])

    def test_a_draft_the_schema_rejects_is_a_400_with_each_problem(self):
        status, answer = self.post("/api/lab/drafts", {"title": "Bad", "overrides": {
            "caption_font_size": 500, "cowork_headless_command": "/bin/sh"}})
        self.assertEqual((status, answer["problems"]), (400, [
            "caption_font_size must be between 20 and 240, not 500",
            "cowork_headless_command cannot be changed in a draft",
        ]))
        self.assertFalse(self.lab.exists())

    def test_apply_writes_config_json_and_answers_with_the_diff(self):
        self.post("/api/lab/drafts", {"title": "Tight", "overrides": {"caption_font_size": 60}})
        status, answer = self.post("/api/lab/drafts/apply", {"name": "tight"})
        self.assertEqual((status, answer["changes"]), (200, [{"key": "caption_font_size", "from": 84, "to": 60}]))
        self.assertIn('+    "caption_font_size": 60', answer["diff"])
        self.assertIn("gitDiff", answer)
        self.assertEqual(json.loads(self.config_path.read_text())["settings"]["caption_font_size"], 60)
        self.assertEqual(self.api("/api/lab")["drafts"], [])
        self.assertEqual(self.post("/api/lab/drafts/apply", {"name": "tight"})[0], 400)


class LabRunApiTests(LabServerTestCase):
    def test_a_test_render_runs_the_clip_stage_and_can_be_played_compared_and_deleted(self):
        self.post("/api/lab/drafts", {"title": "Tight", "overrides": {"caption_font_size": 60}})
        before = self.outside_lab()
        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "sk-or-would-cost-money"}):
            status, answer = self.render(draft="tight")
            self.assertEqual((status, answer["run"]["status"], answer["run"]["draft"]["name"]), (202, "running", "tight"))
            finished = self.wait_for(answer["run"]["id"])
        run = finished["run"]
        self.assertEqual((run["status"], run["message"], run["overrides"]), ("done", None, {"caption_font_size": 60}))
        self.assertEqual(run["realClipUrl"], "/media/output/clips/20260105/02-bit-5.mp4")
        self.assertEqual(run["clipUrl"], f"/media/output/lab/{run['id']}/clips/20260105/01-bit-5.mp4")
        self.assertEqual(self.request(run["clipUrl"])[1], b"lab video")
        # A free run's child process has no image key, whatever this process has.
        self.assertIn("image key: ''", finished["log"])
        self.assertIn("Clip saved: 01-bit-5.mp4", finished["log"])
        self.assertNotIn("would-cost-money", finished["log"])
        listed = self.api("/api/lab")
        self.assertEqual([(r["id"], r["status"]) for r in listed["runs"]], [(run["id"], "done")])
        self.assertIsNone(listed["active"])
        self.assertEqual(self.outside_lab(), before)

        self.assertEqual(self.post("/api/lab/runs/delete", {"id": run["id"]}), (200, {"deleted": True}))
        self.assertFalse((self.lab / run["id"]).exists())
        self.assertEqual(self.status(run["clipUrl"]), 404)
        self.assertEqual(self.api("/api/lab")["runs"], [])
        self.assertEqual(self.post("/api/lab/runs/delete", {"id": "../clips/20260105"}), (200, {"deleted": False}))
        self.assertEqual(self.outside_lab(), before)

    def test_the_server_refuses_import_publish_and_anything_unconfirmed_that_costs_money(self):
        config = json.loads(self.config_path.read_text())
        config["settings"]["visuals_provider"] = "openrouter"
        self.config_path.write_text(json.dumps(config))
        cases = [
            (dict(stage="import_transcript"), "never_in_lab", "import_transcript writes to Convex and is never run from the Lab"),
            (dict(stage="publish"), "never_in_lab", "publish writes to Convex and is never run from the Lab"),
            (dict(stage="thumbnail"), "invalid", "thumbnail is not a stage the Lab runs"),
            (dict(newBackground=True), "confirm_paid",
             "A new background is one paid image request to openrouter (google/gemini-3.1-flash-image)."),
            (dict(newBackground=True, confirmPaid="yes"), "confirm_paid",
             "A new background is one paid image request to openrouter (google/gemini-3.1-flash-image)."),
            (dict(clip="candidate-1"), "needs_background",
             "This clip has no still to reuse. Rendering it needs a new background, which is one image request."),
            (dict(stem="20260112"), "invalid", "20260112 is not an episode the Lab can render"),
            (dict(edits={"start": 50.0, "end": 55.0}), "invalid", "the clip must be 20 to 180 seconds long, not 5"),
        ]
        for request, code, message in cases:
            with self.subTest(request=request):
                status, answer = self.render(**request)
                self.assertEqual((status, answer.get("code"), answer.get("error")), (400, code, message))
        self.assertFalse(self.lab.exists())
        self.assertEqual(self.api("/api/lab")["runs"], [])

    def test_a_missing_stage_is_refused_rather_than_assumed(self):
        status, answer = self.post("/api/lab/runs", {"stem": "20260105", "clip": "pick-2"})
        self.assertEqual((status, answer.get("error")), (400, "None is not a stage the Lab runs"))

    def test_a_run_that_fails_says_why(self):
        self.behaviour = "crash"
        _, answer = self.render()
        finished = self.wait_for(answer["run"]["id"])
        self.assertEqual((finished["run"]["status"], finished["run"]["message"], finished["run"]["clipUrl"]),
                         ("failed", "the pipeline exited with status 3", None))
        self.assertIsNone(self.api("/api/lab")["active"])


class LabBusyTests(LabServerTestCase):
    behaviour = "slow"

    def server_options(self):
        return dict(super().server_options(), lab_timeout=0.6)

    def test_one_render_at_a_time_and_a_render_past_its_limit_is_stopped(self):
        status, first = self.render()
        self.assertEqual(status, 202)
        run_id = first["run"]["id"]
        self.assertEqual(self.api("/api/lab")["active"], run_id)
        status, second = self.render(clip="pick-1")
        self.assertEqual((status, second.get("active")), (409, run_id))
        self.assertEqual(self.post("/api/lab/runs/delete", {"id": run_id})[0], 409)
        self.assertEqual(sorted(p.name for p in self.lab.iterdir()), [run_id])
        finished = self.wait_for(run_id)
        self.assertEqual((finished["run"]["status"], finished["run"]["message"]),
                         ("failed", "stopped: the render ran past its time limit"))
        self.assertIsNone(self.api("/api/lab")["active"])


class LabPythonTests(LabServerTestCase):
    def server_options(self):
        return {"pipeline_python": self.root / "no-venv" / "bin" / "python"}

    def test_without_the_pipelines_python_a_render_is_refused_before_anything_is_written(self):
        view = self.api("/api/lab")
        self.assertEqual(view["python"], {"path": str(self.root / "no-venv" / "bin" / "python"), "found": False})
        status, answer = self.render()
        self.assertEqual(status, 400)
        self.assertIn("--pipeline-python", answer["error"])
        self.assertFalse(self.lab.exists())


class LabViewApiTests(LabServerTestCase):
    def test_the_lab_view_lists_what_can_be_rendered(self):
        view = self.api("/api/lab")
        self.assertEqual((view["stages"], view["neverInLab"]), (["clip"], ["import_transcript", "publish"]))
        self.assertEqual(view["provider"], {"name": "local", "model": "stabilityai/sdxl-turbo", "paid": False})
        self.assertEqual(view["limits"], {"minSeconds": 20.0, "maxSeconds": 180.0})
        self.assertEqual([(e["stem"], e["number"], e["title"], len(e["clips"])) for e in view["episodes"]],
                         [("20260105", 801, "Alpha", 20)])
        clips = view["episodes"][0]["clips"]
        self.assertEqual(clips[1], {
            "id": "pick-2", "source": "pick", "index": 2, "headline": "Bit 5", "start": 50.0, "end": 80.0,
            "imagePrompt": "A cracked film reel in fog", "hasStill": True,
            "realClip": "/media/output/clips/20260105/02-bit-5.mp4",
        })
        self.assertEqual((clips[3]["id"], clips[3]["hasStill"], clips[3]["realClip"]), ("candidate-1", False, None))
        self.assertEqual((view["drafts"], view["runs"], view["active"]), ([], [], None))


class ReadOnlyTests(ServerTestCase):
    PATHS = ("/", "/static/app.js", "/static/style.css", "/api/header", "/api/today", "/api/episodes", "/api/lab",
             "/api/episode?stem=20260105", "/api/episode?stem=20260112", "/api/episode?stem=20260119",
             "/api/episode?stem=20100101", "/api/settings", "/docs/show-format.md",
             "/api/shirts", "/api/shirts/phrases?section=catchphrases",
             "/api/clips", "/api/clips?stem=20260105", "/api/runs",
             "/media/episodes/20260105.mp3", "/media/output/thumbnails/20260105.png")

    def test_serving_every_page_leaves_the_data_directory_untouched_and_never_shows_dot_env(self):
        (self.root / "output/cowork/state.json").unlink()  # the first read seeds state in memory
        before = snapshot(self.root)
        for path in self.PATHS:
            with self.subTest(path):
                response, body = self.request(path)
                self.assertEqual(response.status, 200)
                self.assertNotIn(b"do-not-read", body)
        self.request("/api/today", method="POST", body=b"{}")
        self.assertEqual(snapshot(self.root), before)
        self.assertNotIn("SECRET_TOKEN", os.environ)

    def test_the_server_needs_only_the_standard_library_and_never_loads_dot_env(self):
        # -S leaves site-packages off the path, so any third-party import fails outright.
        probe = (
            "import sys, dashboard.server, dashboard.views\n"
            "loaded = [m for m in ('dotenv', 'lib.runtime_config', 'PIL', 'lib.clipper') if m in sys.modules]\n"
            "print(loaded)"
        )
        result = subprocess.run([sys.executable, "-S", "-c", probe], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual((result.returncode, result.stdout.strip(), result.stderr), (0, "[]", ""))


if __name__ == "__main__":
    unittest.main()
