#!/usr/bin/env python3
"""Sign in to YouTube once and print the refresh token the Lab's uploads use.

    venv/bin/python scripts/youtube_auth.py

Needs YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env: a "Desktop app"
OAuth client from a Google Cloud project with the YouTube Data API v3 turned
on (README, "Publishing to YouTube"). It opens Google's sign-in in the
browser; sign in with the account that owns @badboyspodcast and choose that
channel. The only permission asked for is to upload videos. Google sends the
browser back to a one-time page on 127.0.0.1, and the script prints the
refresh token to put in .env as YOUTUBE_REFRESH_TOKEN. It writes no file.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, Callable, Dict, Optional

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.youtube_upload import TOKEN_URL, UPLOAD_SCOPE  # noqa: E402

SIGN_IN_URL = "https://accounts.google.com/o/oauth2/v2/auth"
WAIT_SECONDS = 300


def sign_in_url(client_id: str, redirect_uri: str, state: str, challenge: str) -> str:
    """Google's consent page, asking to upload videos and for a refresh token (``offline``, ``consent``)."""
    return SIGN_IN_URL + "?" + urllib.parse.urlencode({
        "client_id": client_id, "redirect_uri": redirect_uri, "response_type": "code", "scope": UPLOAD_SCOPE,
        "access_type": "offline", "prompt": "consent", "state": state,
        "code_challenge": challenge, "code_challenge_method": "S256",
    })


def exchange_code(client_id: str, client_secret: str, code: str, redirect_uri: str, verifier: str,
                  open_url: Callable[..., Any] = urllib.request.urlopen) -> Optional[str]:
    """Trade the code Google sent back for a refresh token."""
    form = urllib.parse.urlencode({
        "client_id": client_id, "client_secret": client_secret, "code": code, "redirect_uri": redirect_uri,
        "grant_type": "authorization_code", "code_verifier": verifier,
    }).encode()
    request = urllib.request.Request(TOKEN_URL, data=form, method="POST",
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
    with open_url(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8")).get("refresh_token")


def _wait_for_code(server: HTTPServer, state: str) -> Dict[str, str]:
    """Answer Google's redirect to 127.0.0.1 and return its query (``code``, or ``error``)."""
    answer: Dict[str, str] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            query = {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).items()}
            if query.get("state") != state:
                self.send_response(400)
                self.end_headers()
                return
            answer.update(query)
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write("Done. You can close this tab and go back to the terminal.\n".encode())

        def log_message(self, *args: Any) -> None:
            pass

    server.RequestHandlerClass = Handler
    server.timeout = WAIT_SECONDS
    while not answer:
        server.handle_request()  # returns after the timeout with no request
        if not answer and server.timed_out:
            break
    return answer


class _Server(HTTPServer):
    timed_out = False

    def handle_timeout(self) -> None:
        self.timed_out = True


def main() -> int:
    from lib.runtime_config import load_config  # loads .env, which needs the venv
    load_config(ROOT / "config.json")
    client_id = (os.environ.get("YOUTUBE_CLIENT_ID") or "").strip()
    client_secret = (os.environ.get("YOUTUBE_CLIENT_SECRET") or "").strip()
    if not client_id or not client_secret:
        print("Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env first (README, \"Publishing to YouTube\").")
        return 1
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)
    server = _Server(("127.0.0.1", 0), BaseHTTPRequestHandler)
    redirect_uri = f"http://127.0.0.1:{server.server_address[1]}"
    url = sign_in_url(client_id, redirect_uri, state, challenge)
    print("Opening Google's sign-in. Choose the @badboyspodcast channel. If no browser opens, visit:\n")
    print(f"  {url}\n")
    webbrowser.open(url)
    try:
        answer = _wait_for_code(server, state)
    finally:
        server.server_close()
    if not answer.get("code"):
        print(f"No sign-in came back ({answer.get('error') or f'waited {WAIT_SECONDS} s'}).")
        return 1
    try:
        token = exchange_code(client_id, client_secret, answer["code"], redirect_uri, verifier)
    except urllib.error.HTTPError as exc:
        print(f"Google refused the code: {exc.read().decode('utf-8', 'replace')}")
        return 1
    if not token:
        print("Google sent no refresh token. Remove this app at https://myaccount.google.com/permissions "
              "and run the script again.")
        return 1
    print("Signed in. Add this line to the .env the pipeline loads (keep it secret):\n")
    print(f"YOUTUBE_REFRESH_TOKEN={token}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
