"""The dashboard's HTTP layer: loopback only.

    python3 -m dashboard              # from apps/pipeline; then open http://127.0.0.1:8765/
    python3 -m dashboard --port 9000

Standard library only, so it runs without the pipeline venv. What each tab
shows is in ``dashboard/views.py``; this module only routes requests, checks
them, and serves files. It does not read ``.env``.

A GET never writes. The POSTs are:

- the Lab's (``/api/lab/...``): they write under the data directory's
  ``output/lab/``, start the pipeline's clip stage on a run folder there, and
  rewrite ``config.json`` when a draft is applied. ``/api/lab/youtube`` runs
  ``scripts/youtube_upload.py``, which uploads a finished test render to the
  YouTube channel as a private video and records it in
  ``output/publish-decisions.json``; the page confirms it first;
- the Shirts tab's (``/api/shirts/...``): they change the shortlist,
  ``output/tshirt/ideas.json``, and Rescan runs ``scripts/scan_phrases.py``,
  which rewrites the report under ``output/phrases/``;
- the Clips tab's (``/api/clips/...``): they record a publish decision in
  ``output/publish-decisions.json``;
- the Runs tab's (``/api/runs/...``): Check runs ``scripts/check_run.py``, and
  Start runs ``pipeline.py`` itself, which writes to Convex and everywhere a
  pipeline run writes. Each run is recorded under ``output/runs/``.

Each needs the token made when the server started and this server's own
Origin, because any web page open in the browser can post to localhost.
"""
from __future__ import annotations

import argparse
import hmac
import json
import re
import secrets
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Optional, Sequence, Tuple
from urllib.parse import parse_qs, unquote, urlsplit

from dashboard import upload_runner, views
from dashboard.lab_runner import DEFAULT_TIMEOUT_SECONDS, LabBusy, LabRunner
from dashboard.run_runner import ChecksFailed, RunBusy, RunRunner
from dashboard.scan_runner import DEFAULT_TIMEOUT_SECONDS as SCAN_TIMEOUT_SECONDS, ScanBusy, ScanRunner
from dashboard.upload_runner import DEFAULT_TIMEOUT_SECONDS as UPLOAD_TIMEOUT_SECONDS, UploadBusy, UploadRunner
from lib import lab, pipeline_runs, publish_log, shirt_ideas, youtube_upload
from lib.data_dir import data_dir, require_data_dir

ROOT = Path(__file__).resolve().parents[1]
STATIC_DIR = Path(__file__).resolve().parent / "static"
DEFAULT_PORT = 8765
DEFAULT_PIPELINE_PYTHON = ROOT / "venv" / "bin" / "python"
BIND_ADDRESS = "127.0.0.1"
HOST_NAMES = ("127.0.0.1", "localhost")
STATIC_FILES = {
    "index.html": "text/html; charset=utf-8",
    "app.js": "text/javascript; charset=utf-8",
    "style.css": "text/css; charset=utf-8",
}
MEDIA_TYPES = {
    ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
}
JSON_TYPE = "application/json; charset=utf-8"
# The page is three local files; nothing is loaded from anywhere else.
CONTENT_POLICY = (
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; "
    "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
)
CHUNK_BYTES = 64 * 1024
MAX_POST_BYTES = 64 * 1024
TOKEN_HEADER = "X-Dashboard-Token"
POST_PREFIXES = ("/api/lab/", "/api/shirts/", "/api/clips/", "/api/runs/")
# What the page may send when it adds an idea, and the library's name for each.
IDEA_FIELDS = (("printText", "print_text"), ("origin", "origin"), ("source", "source"), ("status", "status"),
               ("notes", "notes"))
IDEA_SOURCES = ("manual", "scan", "episode", "notes")
_RANGE = re.compile(r"bytes=(\d*)-(\d*)")


class Unsatisfiable(ValueError):
    """The requested byte range starts past the end of the file."""


def parse_range(header: Optional[str], size: int) -> Optional[Tuple[int, int]]:
    """Return the inclusive (first, last) bytes a ``Range`` header asks for.

    None means "send the whole file": no header, or one this server does not
    serve (several ranges, another unit, a malformed value), which HTTP allows
    a server to ignore.
    """
    match = _RANGE.fullmatch((header or "").strip())
    if not match or match.group(1) == match.group(2) == "":
        return None
    first, last = match.groups()
    if first == "":  # "-N": the final N bytes
        if int(last) == 0 or size == 0:
            raise Unsatisfiable(header)
        return max(size - int(last), 0), size - 1
    if last != "" and int(last) < int(first):
        return None
    if int(first) >= size:
        raise Unsatisfiable(header)
    return int(first), min(int(last), size - 1) if last else size - 1


def _plain_name(part: str) -> bool:
    """A single path component that is not hidden and cannot step out of its folder."""
    return bool(part) and not part.startswith(".") and not any(ch in part for ch in "/\\\x00")


def media_file(config: Dict[str, Any], parts: Sequence[str]) -> Optional[Path]:
    """Resolve ``/media/<root>/<path...>`` to a file, or None when it must not be served.

    Served: clips, thumbnails and audio under the data directory's
    ``episodes/`` and ``output/``. Never a dotfile, never anything a link
    leads to outside those folders, and never a file that is not media
    (``state.json`` and the decisions log live under ``output/`` too).
    """
    if len(parts) < 2 or not all(_plain_name(part) for part in parts):
        return None
    key = dict(views.MEDIA_ROOTS).get(parts[0])
    configured = config.get("paths", {}).get(key) if key else None
    if not configured:
        return None
    root = Path(configured).resolve()
    target = root.joinpath(*parts[1:]).resolve()
    if not root.is_relative_to(data_dir()) or not target.is_relative_to(root):
        return None
    if any(part.startswith(".") for part in target.relative_to(root).parts):
        return None  # a link that leads to a dotfile
    if target.suffix.lower() not in MEDIA_TYPES or not target.is_file():
        return None
    return target


class DashboardServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port: int, config_path: Path, runner: LabRunner, scans: ScanRunner, runs: RunRunner,
                 uploads: UploadRunner):
        super().__init__((BIND_ADDRESS, port), Handler)
        self.config_path = Path(config_path)
        self.runner = runner
        self.uploads = uploads
        self.scans = scans
        self.runs = runs
        # One change at a time to the shortlist and to the decisions log: each rewrites its whole file.
        self.ideas_lock = threading.Lock()
        self.ignore_lock = threading.Lock()
        self.decisions_lock = threading.Lock()
        # Sent to the page with /api/header and required back on every POST. Another site's
        # page cannot read it (no CORS), and a rebound domain is refused by the Host check.
        self.token = secrets.token_urlsafe(32)


class Handler(BaseHTTPRequestHandler):
    server_version = "BBPCDashboard"
    protocol_version = "HTTP/1.1"

    # ----------------------------------------------------------------------- requests

    def do_GET(self) -> None:
        if not self._host_allowed():
            self._json(403, {"error": "this dashboard answers only as 127.0.0.1 or localhost on its own port"})
            return
        url = urlsplit(self.path)
        self._started = False
        try:
            self._route(url.path, parse_qs(url.query))
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True  # the browser stopped listening (it does when seeking)
        except Exception as exc:  # a broken file must not take the dashboard down
            traceback.print_exc()
            if self._started:
                self.close_connection = True  # part of a response has gone out; it cannot become a 500
            else:
                self._json(500, {"error": f"{type(exc).__name__}: {exc}"})

    def _refuse_method(self) -> None:
        self.close_connection = True  # any request body is left unread
        body = b"" if self.command == "HEAD" else json.dumps({"error": "this path takes only GET"}).encode()
        self._send(405, JSON_TYPE, body, {"Allow": "GET"})

    do_PUT = do_PATCH = do_DELETE = do_HEAD = do_OPTIONS = _refuse_method

    def do_POST(self) -> None:
        self.close_connection = True  # a refused request's body is left unread
        path = urlsplit(self.path).path
        prefix = next((prefix for prefix in POST_PREFIXES if path.startswith(prefix)), None)
        if prefix is None:
            self._refuse_method()
            return
        refusal = self._post_refusal()
        if refusal:
            self._json(refusal[0], {"error": refusal[1]})
            return
        try:
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])).decode("utf-8"))
        except ValueError:
            payload = None
        if not isinstance(payload, dict):
            self._json(400, {"error": "the body must be a JSON object"})
            return
        self._started = False
        try:
            post = {"/api/lab/": self._lab_post, "/api/shirts/": self._shirts_post, "/api/clips/": self._clips_post,
                    "/api/runs/": self._runs_post}
            post[prefix](path[len(prefix):], payload)
        except lab.LabError as exc:
            self._json(400, {"error": str(exc), "problems": exc.problems, "code": exc.code})
        except LabBusy as exc:
            self._json(409, {"error": "A render is already running. One at a time.", "active": exc.active})
        except ScanBusy:
            self._json(409, {"error": "A rescan is already running."})
        except UploadBusy as exc:
            self._json(409, {"error": "An upload is already going. One at a time.", "active": exc.active})
        except RunBusy as exc:
            self._json(409, {"error": "A run is already going. One at a time.", "active": exc.active})
        except ChecksFailed as exc:
            self._json(400, {"error": str(exc), "checks": exc.result})
        except ValueError as exc:  # what the shortlist or the decisions library refuses, in its own words
            self._json(400, {"error": str(exc)})
        except Exception as exc:
            traceback.print_exc()
            if not self._started:
                self._json(500, {"error": f"{type(exc).__name__}: {exc}"})

    def _post_refusal(self) -> Optional[Tuple[int, str]]:
        """Why this POST is refused before its body is read, or None."""
        if not self._host_allowed():
            return 403, "this dashboard answers only as 127.0.0.1 or localhost on its own port"
        if (self.headers.get("Origin") or "").lower() not in {f"http://{host}" for host in self._host_names()}:
            return 403, "a POST must come from this dashboard's own page"
        if not hmac.compare_digest((self.headers.get(TOKEN_HEADER) or "").encode(), self.server.token.encode()):
            return 403, "missing or wrong dashboard token; reload the page"
        if (self.headers.get("Content-Type") or "").split(";")[0].strip().lower() != "application/json":
            return 415, "the body must be application/json"
        length = self.headers.get("Content-Length") or ""
        if not length.isdigit():
            return 411, "Content-Length is required"
        if int(length) > MAX_POST_BYTES:
            return 413, "the body is too large"
        return None

    def _host_names(self) -> set:
        port = self.server.server_address[1]
        return {f"{name}:{port}" for name in HOST_NAMES}

    def _host_allowed(self) -> bool:
        """Refuse a request addressed to any other name: a web page cannot then reach
        this server by pointing its own domain at 127.0.0.1 (DNS rebinding)."""
        return (self.headers.get("Host") or "").lower() in self._host_names()

    def _route(self, path: str, query: Dict[str, Any]) -> None:
        if path == "/":
            self._static("index.html")
        elif path.startswith("/static/"):
            self._static(path[len("/static/"):])
        elif path.startswith("/api/"):
            self._api(path[len("/api/"):], query)
        elif path.startswith("/media/"):
            self._media([unquote(part) for part in path[len("/media/"):].split("/")])
        elif path.startswith("/docs/") and path[len("/docs/"):] in views.DOCS:
            self._send(200, "text/plain; charset=utf-8", (ROOT / "docs" / path[len("/docs/"):]).read_bytes())
        else:
            self._not_found()

    # ----------------------------------------------------------------------- pages

    def _static(self, name: str) -> None:
        if name not in STATIC_FILES:
            self._not_found()
            return
        self._send(200, STATIC_FILES[name], (STATIC_DIR / name).read_bytes())

    def _api(self, name: str, query: Dict[str, Any]) -> None:
        raw, config = views.load_config(self.server.config_path)  # read per request: edits show on reload
        runner = self.server.runner
        if name == "header":
            runs = self.server.runs
            self._json(200, {**views.header(config, runs.last_check, runs.last_check_at), "token": self.server.token})
        elif name == "runs":
            self._json(200, views.runs(config, self.server.runs.active, self.server.runs.python))
        elif name == "runs/log":
            self._run_log(config, query)
        elif name == "lab":
            self._json(200, views.lab_view(config, raw, runner.active, runner.python, self._can_render(),
                                           self.server.uploads.active))
        elif name == "lab/run":
            run = lab.load_run(config, (query.get("id") or [""])[0])
            if run is None:
                self._not_found()
            else:
                (run,) = [r for r in lab.list_runs(config, runner.active) if r["id"] == run["id"]]
                self._json(200, {"run": views.lab_run(config, run, self.server.uploads.active),
                                 "log": lab.log_tail(config, run["id"]),
                                 "youtubeLog": lab.log_tail(config, run["id"], name=upload_runner.LOG_FILE)})
        elif name == "clips":
            page = views.clips(config, (query.get("stem") or [None])[0])
            if page is None:
                self._json(404, {"error": "no clips or decisions for that episode"})
            else:
                self._json(200, page)
        elif name == "shirts":
            self._json(200, views.shirts(config, self.server.scans.state()))
        elif name == "shirts/phrases":
            self._shirt_phrases(config, query)
        elif name == "today":
            self._json(200, views.today(config))
        elif name == "episodes":
            self._json(200, views.episodes(config))
        elif name == "settings":
            self._json(200, views.settings(raw, config))
        elif name == "episode":
            page = views.episode(config, (query.get("stem") or [""])[0])
            if page is None:
                self._json(404, {"error": "unknown episode"})
            else:
                self._json(200, page)
        else:
            self._not_found()

    # ----------------------------------------------------------------------- the Lab's writes

    def _can_render(self) -> bool:
        runner = self.server.runner
        return runner.custom_command or runner.python_found()

    def _lab_post(self, name: str, payload: Dict[str, Any]) -> None:
        raw, config = views.load_config(self.server.config_path)
        runner = self.server.runner
        if name == "drafts":
            draft = lab.save_draft(config, raw, payload.get("title"), payload.get("overrides"), payload.get("name"))
            self._json(200, {"draft": draft})
        elif name == "drafts/delete":
            self._json(200, {"deleted": lab.delete_draft(config, payload.get("name"))})
        elif name == "drafts/apply":
            applied = lab.apply_draft(self.server.config_path, config, payload.get("name"))
            self._json(200, {**applied, "gitDiff": lab.git_diff(self.server.config_path)})
        elif name == "runs":
            self._lab_render(config, raw, payload)
        elif name == "youtube":
            self._lab_upload(config, payload)
        elif name == "runs/delete":
            if payload.get("id") == runner.active and runner.active is not None:
                self._json(409, {"error": "This render is still running.", "active": runner.active})
            elif payload.get("id") == self.server.uploads.active and self.server.uploads.active is not None:
                self._json(409, {"error": "This clip is being uploaded.", "active": self.server.uploads.active})
            else:
                self._json(200, {"deleted": lab.delete_run(config, payload.get("id"))})
        else:
            self._not_found()

    def _lab_render(self, config: Dict[str, Any], raw: Dict[str, Any], payload: Dict[str, Any]) -> None:
        runner = self.server.runner
        if not self._can_render():
            raise lab.LabError(
                f"The pipeline's Python was not found at {runner.python}. "
                "Start the dashboard with --pipeline-python pointing at the venv's python."
            )
        runner.reserve()
        try:
            run = lab.create_run(
                config, raw,
                stem=payload.get("stem"), clip=payload.get("clip"), stage=payload.get("stage"),
                draft=payload.get("draft"), edits=payload.get("edits"),
                new_background=payload.get("newBackground") is True,
                # Only a literal true confirms spending money.
                confirm_paid=payload.get("confirmPaid") is True,
            )
        except BaseException:
            runner.release()
            raise
        self._json(202, {"run": views.lab_run(config, runner.start(config, run), self.server.uploads.active)})

    def _lab_upload(self, config: Dict[str, Any], payload: Dict[str, Any]) -> None:
        """Upload a finished test render to YouTube. It posts to the channel: only a literal true confirms it."""
        uploads = self.server.uploads
        if payload.get("confirmed") is not True:
            self._json(400, {"error": "Confirm the upload first: it posts to the YouTube channel."})
            return
        if not uploads.can_start():
            raise lab.LabError(
                f"The pipeline's Python was not found at {uploads.python}. "
                "Start the dashboard with --pipeline-python pointing at the venv's python."
            )
        run_id = payload.get("id")
        uploads.reserve()
        try:
            youtube_upload.prepare(config, run_id, payload.get("title"), payload.get("description"))
        except BaseException:
            uploads.release()
            raise
        uploads.start(config, run_id, self.server.config_path)
        self._json(202, {"upload": youtube_upload.load(config, run_id, uploads.active)})

    # ----------------------------------------------------------------------- the Runs tab

    def _run_log(self, config: Dict[str, Any], query: Dict[str, Any]) -> None:
        run_id = (query.get("id") or [""])[0]
        try:
            offset = int((query.get("offset") or ["-1"])[0])
        except ValueError:
            self._json(400, {"error": "offset must be a whole number"})
            return
        log = pipeline_runs.read_log(config, run_id, offset)
        if log is None:
            self._json(404, {"error": "no such run"})
            return
        (run,) = [run for run in views.runs(config, self.server.runs.active, None)["runs"] if run["id"] == run_id] or [
            pipeline_runs.load_run(config, run_id)]
        self._json(200, {**log, "run": run})

    def _runs_post(self, name: str, payload: Dict[str, Any]) -> None:
        """Check or start a pipeline run, or stop the one going. A start writes to Convex: the page confirms it first."""
        _, config = views.load_config(self.server.config_path)
        runs = self.server.runs
        if name == "stop":
            runs.stop(payload.get("id"))
            self._json(200, {"stopping": payload.get("id")})
            return
        if name not in ("check", "start"):
            self._not_found()
            return
        planned = pipeline_runs.plan(config, payload.get("mode"), payload.get("stem"), payload.get("stage"))
        if name == "check":
            self._json(200, runs.check(config, planned, self.server.config_path))
        elif payload.get("confirmed") is not True:  # only a literal true starts a run
            self._json(400, {"error": "Confirm the run first: it writes to Convex."})
        else:
            self._json(202, {"run": runs.start(config, planned, self.server.config_path)})

    # ----------------------------------------------------------------------- the Clips tab

    def _clips_post(self, name: str, payload: Dict[str, Any]) -> None:
        """Record a publish decision: the same calls ``scripts/publish_decisions.py`` makes."""
        _, config = views.load_config(self.server.config_path)
        if name == "decide":
            with self.server.decisions_lock:
                rows = publish_log.decide(config, payload.get("stem"), payload.get("clip"), payload.get("decision"),
                                          payload.get("youtube"), payload.get("reason"))
            self._json(200, {"rows": rows})
        elif name == "untracked":
            with self.server.decisions_lock:
                row = publish_log.mark_untracked(config, payload.get("stem"), payload.get("label"),
                                                 payload.get("youtube"), payload.get("note"))
            self._json(200, {"row": row})
        else:
            self._not_found()

    # ----------------------------------------------------------------------- the Shirts tab

    def _shirt_phrases(self, config: Dict[str, Any], query: Dict[str, Any]) -> None:
        def one(name: str, default: str) -> str:
            return (query.get(name) or [default])[0]
        try:
            page = views.shirt_phrases(config, one("section", ""), one("q", ""), int(one("offset", "0")),
                                       int(one("limit", str(shirt_ideas.PAGE_ROWS))))
        except ValueError as exc:
            self._json(400, {"error": str(exc)})
            return
        self._json(200, page)

    def _shirts_post(self, name: str, payload: Dict[str, Any]) -> None:
        _, config = views.load_config(self.server.config_path)
        if name == "ideas":
            with self.server.ideas_lock:
                idea = self._add_idea(config, payload)
            self._json(200, {"idea": views.shirt_idea(config, idea)})
        elif name == "ideas/update":
            changes = {key: payload[key] for key in shirt_ideas.EDITABLE if key in payload}
            with self.server.ideas_lock:
                idea = shirt_ideas.update(config, payload.get("id"), **changes)
            self._json(200, {"idea": views.shirt_idea(config, idea)})
        elif name == "ideas/delete":
            with self.server.ideas_lock:
                removed = shirt_ideas.remove(config, payload.get("id"))
            self._json(200, {"deleted": removed})
        elif name == "rescan":
            self._json(202, {"rescan": self.server.scans.start(self.server.config_path)})
        elif name == "ignore":
            # A scan reads ignore.txt as it starts, so a line added during one would not count until the next.
            with self.server.ignore_lock:
                if self.server.scans.state()["running"]:
                    self._json(409, {"error": "A rescan is running. Ignore phrases once it has finished."})
                    return
                ignored = shirt_ideas.ignore_from_scan(config, payload.get("phrase"))
            self._json(200, {"ignored": ignored["phrase"]})
        else:
            self._not_found()

    def _add_idea(self, config: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
        """Add an idea from whichever source the page names; where it came from is the library's to record."""
        fields = {name: payload[key] for key, name in IDEA_FIELDS if payload.get(key) is not None}
        source = payload.get("from", "manual")
        if source == "manual":
            return shirt_ideas.add(config, payload.get("phrase"), **fields)
        if source == "scan":
            return shirt_ideas.add_from_scan(config, payload.get("phrase"), **fields)
        if source == "episode":
            return shirt_ideas.add_from_episode(config, payload.get("stem"), payload.get("index"), **fields)
        if source == "notes":
            if payload.get("phrase") is not None:
                fields["phrase"] = payload["phrase"]
            return shirt_ideas.add_from_notes(config, payload.get("line"), **fields)
        raise ValueError(f"from must be one of {', '.join(IDEA_SOURCES)}, not {source!r}")

    def _media(self, parts: Sequence[str]) -> None:
        _, config = views.load_config(self.server.config_path)
        path = media_file(config, parts)
        if path is None:
            self._not_found()
            return
        size = path.stat().st_size
        headers = {"Accept-Ranges": "bytes", "Cache-Control": "no-cache"}
        try:
            wanted = parse_range(self.headers.get("Range"), size)
        except Unsatisfiable:
            self._send(416, MEDIA_TYPES[path.suffix.lower()], b"", {**headers, "Content-Range": f"bytes */{size}"})
            return
        first, last = wanted or (0, size - 1)
        if wanted:
            headers["Content-Range"] = f"bytes {first}-{last}/{size}"
        remaining = last - first + 1
        self._start(206 if wanted else 200, MEDIA_TYPES[path.suffix.lower()], remaining, headers)
        with path.open("rb") as f:
            f.seek(first)
            while remaining > 0:
                chunk = f.read(min(CHUNK_BYTES, remaining))
                if not chunk:
                    self.close_connection = True  # the file shrank while it was being sent
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    # ----------------------------------------------------------------------- responses

    def _not_found(self) -> None:
        self._json(404, {"error": "not found"})

    def _json(self, status: int, payload: Any) -> None:
        self._send(status, JSON_TYPE, json.dumps(payload, ensure_ascii=False).encode("utf-8"))

    def _send(self, status: int, content_type: str, body: bytes, headers: Optional[Dict[str, str]] = None) -> None:
        self._start(status, content_type, len(body), headers)
        self.wfile.write(body)

    def _start(self, status: int, content_type: str, length: int, headers: Optional[Dict[str, str]] = None) -> None:
        self._started = True
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        for name, value in {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "Content-Security-Policy": CONTENT_POLICY,
            "Cross-Origin-Resource-Policy": "same-origin",
            **(headers or {}),
        }.items():
            self.send_header(name, value)
        self.end_headers()


def make_server(
    config_path: Path,
    port: int = DEFAULT_PORT,
    pipeline_python: Optional[Path] = None,
    lab_command: Any = None,
    lab_timeout: float = DEFAULT_TIMEOUT_SECONDS,
    scan_command: Any = None,
    scan_timeout: float = SCAN_TIMEOUT_SECONDS,
    run_command: Any = None,
    check_command: Any = None,
    upload_command: Any = None,
    upload_timeout: float = UPLOAD_TIMEOUT_SECONDS,
) -> DashboardServer:
    """``lab_command`` replaces the pipeline command a Lab render runs, ``scan_command`` the
    phrase scan a Rescan runs, ``run_command`` and ``check_command`` a pipeline run and
    its checks, and ``upload_command`` a YouTube upload; tests pass stand-ins."""
    python = Path(pipeline_python or DEFAULT_PIPELINE_PYTHON)
    runner = LabRunner(python, lab_command, lab_timeout)
    runs = RunRunner(python, run_command, check_command)
    uploads = UploadRunner(python, upload_command, upload_timeout)
    return DashboardServer(port, config_path, runner, ScanRunner(scan_command, scan_timeout), runs, uploads)


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(prog="python3 -m dashboard", description="Local pipeline dashboard.")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"port on {BIND_ADDRESS} (default {DEFAULT_PORT})")
    ap.add_argument("--config", default=str(ROOT / "config.json"))
    ap.add_argument("--pipeline-python", default=str(DEFAULT_PIPELINE_PYTHON),
                    help="python of the pipeline's venv, which runs the Lab's test renders and YouTube uploads "
                         "and the Runs tab's checks and runs (default: venv/bin/python)")
    return ap.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    require_data_dir()
    views.load_config(Path(args.config))  # stop now, not on the first request, if config.json is unreadable
    server = make_server(Path(args.config), args.port, Path(args.pipeline_python).expanduser())
    print(f"Pipeline dashboard: http://{BIND_ADDRESS}:{server.server_address[1]}/")
    print(f"  data directory {data_dir()}; Ctrl-C to stop")
    print("  writes only: output/lab/ (Lab), output/tshirt/ideas.json (Shirts), output/phrases/ (Rescan), "
          "output/publish-decisions.json (Clips, and a Lab YouTube upload), output/runs/ and a pipeline run's own "
          "writes (Runs, Convex included)")
    print("  sends out only: a Lab clip you confirm uploading (YouTube, private) and a Runs-tab pipeline run")
    if not server.runner.python_found():
        print(f"  no pipeline python at {server.runner.python}: the Lab cannot render and Runs cannot start "
              "(see --pipeline-python)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()
    finally:
        server.server_close()
    return 0
