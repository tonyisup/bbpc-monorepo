import http.client
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

import dashboard_fixture
from dashboard import server, views
from dashboard_fixture import snapshot
from lib import data_dir

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
        self.server = server.make_server(self.config_path, port=0)
        self.port = self.server.server_address[1]
        thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

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
        self.assertEqual(self.api("/api/header"), round_trip(views.header(config)))
        self.assertEqual(self.api("/api/today"), round_trip(views.today(config)))
        self.assertEqual(self.api("/api/episodes"), round_trip(views.episodes(config)))
        self.assertEqual(self.api("/api/episode?stem=20260105"), round_trip(views.episode(config, "20260105")))
        self.assertEqual(self.api("/api/settings"), round_trip(views.settings(raw)))
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


class ReadOnlyTests(ServerTestCase):
    PATHS = ("/", "/static/app.js", "/static/style.css", "/api/header", "/api/today", "/api/episodes",
             "/api/episode?stem=20260105", "/api/episode?stem=20260112", "/api/episode?stem=20260119",
             "/api/episode?stem=20100101", "/api/settings", "/docs/show-format.md",
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
