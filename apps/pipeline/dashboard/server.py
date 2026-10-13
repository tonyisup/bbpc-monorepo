"""The dashboard's HTTP layer: loopback only, GET only, read-only.

    python3 -m dashboard              # from apps/pipeline; then open http://127.0.0.1:8765/
    python3 -m dashboard --port 9000

Standard library only, so it runs without the pipeline venv. What each tab
shows is in ``dashboard/views.py``; this module only routes requests, checks
them, and serves files. It does not read ``.env``, write a file, or start a
process.
"""
from __future__ import annotations

import argparse
import json
import re
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Optional, Sequence, Tuple
from urllib.parse import parse_qs, unquote, urlsplit

from dashboard import views
from lib.data_dir import data_dir, require_data_dir

ROOT = Path(__file__).resolve().parents[1]
STATIC_DIR = Path(__file__).resolve().parent / "static"
DEFAULT_PORT = 8765
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

    def __init__(self, port: int, config_path: Path):
        super().__init__((BIND_ADDRESS, port), Handler)
        self.config_path = Path(config_path)


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
        body = b"" if self.command == "HEAD" else json.dumps({"error": "this dashboard is read-only: GET only"}).encode()
        self._send(405, JSON_TYPE, body, {"Allow": "GET"})

    do_POST = do_PUT = do_PATCH = do_DELETE = do_HEAD = do_OPTIONS = _refuse_method

    def _host_allowed(self) -> bool:
        """Refuse a request addressed to any other name: a web page cannot then reach
        this server by pointing its own domain at 127.0.0.1 (DNS rebinding)."""
        port = self.server.server_address[1]
        return (self.headers.get("Host") or "").lower() in {f"{name}:{port}" for name in HOST_NAMES}

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
        if name == "header":
            self._json(200, views.header(config))
        elif name == "today":
            self._json(200, views.today(config))
        elif name == "episodes":
            self._json(200, views.episodes(config))
        elif name == "settings":
            self._json(200, views.settings(raw))
        elif name == "episode":
            page = views.episode(config, (query.get("stem") or [""])[0])
            if page is None:
                self._json(404, {"error": "unknown episode"})
            else:
                self._json(200, page)
        else:
            self._not_found()

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
            **(headers or {}),
        }.items():
            self.send_header(name, value)
        self.end_headers()


def make_server(config_path: Path, port: int = DEFAULT_PORT) -> DashboardServer:
    return DashboardServer(port, config_path)


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(prog="python3 -m dashboard", description="Local, read-only pipeline dashboard.")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"port on {BIND_ADDRESS} (default {DEFAULT_PORT})")
    ap.add_argument("--config", default=str(ROOT / "config.json"))
    return ap.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    require_data_dir()
    views.load_config(Path(args.config))  # stop now, not on the first request, if config.json is unreadable
    server = make_server(Path(args.config), args.port)
    print(f"Pipeline dashboard: http://{BIND_ADDRESS}:{server.server_address[1]}/")
    print(f"  data directory {data_dir()} (read-only); Ctrl-C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()
    finally:
        server.server_close()
    return 0
