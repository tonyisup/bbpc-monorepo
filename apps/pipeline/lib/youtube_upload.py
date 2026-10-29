"""Upload a Lab test render to the YouTube channel as a private video, and record it as published.

The Lab's "Publish to YouTube" asks for an upload with ``prepare``, which
checks the title and description and writes ``youtube.json`` in the run's
folder. ``scripts/youtube_upload.py <run id>`` then does the upload
(``run_upload``): it trades the refresh token in ``.env`` for an access token,
sends the clip in one resumable upload, and records the clip as published in
``output/publish-decisions.json`` through ``publish_log``, the same calls
``scripts/publish_decisions.py`` makes.

Every upload is private: YouTube keeps videos uploaded through an API project
that has not passed its audit private anyway. Tony makes a Short public in
YouTube Studio.

The dashboard imports this module for ``prepare``, ``load``, ``finish`` and
``view``, which never read ``.env`` or touch the network; only the script
passes credentials in. Standard library only.
"""
from __future__ import annotations

import datetime as _dt
import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable, Dict, List, Mapping, Optional

from lib import lab, publish_log

CREDENTIALS = ("YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN")
TOKEN_URL = "https://oauth2.googleapis.com/token"
UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status"
UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload"
PRIVACY = "private"
CATEGORY_ID = "23"  # Comedy
TITLE_MAX_CHARS = 100        # YouTube's limits
DESCRIPTION_MAX_BYTES = 5000
SHOW_NAME = "Bad Boys Podcast"
TOKEN_TIMEOUT_SECONDS = 30.0
UPLOAD_TIMEOUT_SECONDS = 1200.0
STATE_FILE = "youtube.json"
Opener = Callable[..., Any]  # urllib.request.urlopen, or a stand-in in tests
_JUDGE = object()  # load()'s default: report the status as written


class UploadError(lab.LabError):
    """An upload the Lab refuses before anything is sent."""


class YouTubeError(RuntimeError):
    """Google or YouTube refused a request; the message says why in their words, never with a secret."""


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat()


# --------------------------------------------------------------------------- title and description

def default_title(number: Optional[int], episode_title: Optional[str], headline: str) -> str:
    """``Bad Boys Podcast - <ep#> - <ep title> - <bit>``, the way Tony titles Shorts, within YouTube's 100 characters."""
    def joined(title: Optional[str]) -> str:
        return " - ".join(str(part) for part in (SHOW_NAME, number, title, headline) if part)

    title = joined(episode_title)
    if len(title) > TITLE_MAX_CHARS and episode_title:
        room = TITLE_MAX_CHARS - len(joined("…"))
        title = joined(episode_title[:max(room, 0)].rstrip() + "…") if room > 0 else joined(None)
    return title[:TITLE_MAX_CHARS]


def default_description(number: Optional[int], episode_title: Optional[str]) -> str:
    episode = f" episode {number}" if number else ""
    return f"From {SHOW_NAME}{episode}" + (f": {episode_title}" if episode_title else "")


def check_metadata(title: Any, description: Any) -> List[str]:
    """Why YouTube would refuse this title and description (empty when it would not)."""
    problems: List[str] = []
    if not isinstance(title, str):
        problems.append("the title must be text")
    elif not title.strip():
        problems.append("the title is empty")
    else:
        if len(title) > TITLE_MAX_CHARS:
            problems.append(f"the title is {len(title)} characters; YouTube allows {TITLE_MAX_CHARS}")
        if "<" in title or ">" in title:
            problems.append("the title cannot contain < or >")
    if not isinstance(description, str):
        problems.append("the description must be text")
    else:
        size = len(description.encode("utf-8"))
        if size > DESCRIPTION_MAX_BYTES:
            problems.append(f"the description is {size} bytes; YouTube allows {DESCRIPTION_MAX_BYTES}")
        if "<" in description or ">" in description:
            problems.append("the description cannot contain < or >")
    return problems


# --------------------------------------------------------------------------- Google

def missing_credentials(env: Mapping[str, str]) -> List[str]:
    return [name for name in CREDENTIALS if not (env.get(name) or "").strip()]


def _google_error(exc: urllib.error.HTTPError) -> Dict[str, Any]:
    try:
        body = json.loads(exc.read().decode("utf-8"))
    except (OSError, ValueError):
        body = None
    return body if isinstance(body, dict) else {}


def access_token(env: Mapping[str, str], open_url: Opener = urllib.request.urlopen) -> str:
    """Trade the refresh token for an access token that lasts about an hour."""
    form = urllib.parse.urlencode({
        "client_id": env["YOUTUBE_CLIENT_ID"].strip(), "client_secret": env["YOUTUBE_CLIENT_SECRET"].strip(),
        "refresh_token": env["YOUTUBE_REFRESH_TOKEN"].strip(), "grant_type": "refresh_token",
    }).encode()
    request = urllib.request.Request(TOKEN_URL, data=form, method="POST",
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with open_url(request, timeout=TOKEN_TIMEOUT_SECONDS) as response:
            token = json.loads(response.read().decode("utf-8")).get("access_token")
    except urllib.error.HTTPError as exc:
        body = _google_error(exc)
        reason = ": ".join(str(body[key]) for key in ("error", "error_description") if body.get(key)) or str(exc.code)
        raise YouTubeError(f"Google refused the sign-in ({reason}). Run scripts/youtube_auth.py again and "
                           "update YOUTUBE_REFRESH_TOKEN in .env.") from None
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise YouTubeError(f"could not reach Google to sign in: {exc}") from None
    if not isinstance(token, str) or not token:
        raise YouTubeError("Google's sign-in answer had no access token")
    return token


def _refused(exc: urllib.error.HTTPError) -> YouTubeError:
    error = _google_error(exc).get("error")
    error = error if isinstance(error, dict) else {}
    reasons = [row.get("reason") for row in error.get("errors") or [] if isinstance(row, dict) and row.get("reason")]
    code = " ".join([str(error.get("code") or exc.code)] + reasons[:1])
    return YouTubeError(f"YouTube refused the upload ({code}: {error.get('message') or exc.reason})")


def upload_video(path: Path, title: str, description: str, token: str,
                 open_url: Opener = urllib.request.urlopen) -> str:
    """Send ``path`` as one private video and return its ID: a resumable session, then the bytes in one PUT."""
    path = Path(path)
    size = path.stat().st_size
    metadata = {
        "snippet": {"title": title, "description": description, "categoryId": CATEGORY_ID},
        "status": {"privacyStatus": PRIVACY, "selfDeclaredMadeForKids": False},
    }
    start = urllib.request.Request(UPLOAD_URL, data=json.dumps(metadata).encode("utf-8"), method="POST", headers={
        "Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8",
        "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": str(size),
    })
    try:
        with open_url(start, timeout=TOKEN_TIMEOUT_SECONDS) as response:
            session = response.headers.get("Location")
        if not session:
            raise YouTubeError("YouTube did not open an upload session")
        with path.open("rb") as video:
            send = urllib.request.Request(session, data=video, method="PUT", headers={
                "Content-Type": "video/mp4", "Content-Length": str(size),
            })
            with open_url(send, timeout=UPLOAD_TIMEOUT_SECONDS) as response:
                answer = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise _refused(exc) from None
    except (urllib.error.URLError, ValueError) as exc:
        raise YouTubeError(f"the upload did not finish: {exc}") from None
    video_id = answer.get("id") if isinstance(answer, dict) else None
    if not isinstance(video_id, str) or not video_id:
        raise YouTubeError("YouTube's answer had no video ID; check YouTube Studio before trying again")
    return video_id


# --------------------------------------------------------------------------- one run's upload

def _state_path(config: Dict[str, Any], run_id: str) -> Path:
    return lab.lab_dir(config) / run_id / STATE_FILE


def load(config: Dict[str, Any], run_id: Any, active: Any = _JUDGE) -> Optional[Dict[str, Any]]:
    """The run's upload, or None. Pass ``active`` (the upload in progress, or None) to see one
    left ``ready`` or ``uploading`` by a dashboard that stopped as ``interrupted``."""
    if lab.run_dir(config, run_id) is None:
        return None
    state = lab._read_json(_state_path(config, run_id))
    if not isinstance(state, dict):
        return None
    if active is not _JUDGE and state.get("status") in ("ready", "uploading") and active != run_id:
        state["status"] = "interrupted"
    return state


def _save(config: Dict[str, Any], run_id: str, state: Dict[str, Any]) -> Dict[str, Any]:
    lab._write_json(_state_path(config, run_id), state)
    return state


def _uploadable(config: Dict[str, Any], run: Mapping[str, Any]) -> bool:
    return run.get("status") == "done" and (lab.lab_dir(config) / run["id"] / run["clipFile"]).is_file()


def prepare(config: Dict[str, Any], run_id: Any, title: Any, description: Any,
            active: Optional[str] = None, now: Optional[_dt.datetime] = None) -> Dict[str, Any]:
    """Check an upload and write it down as ``ready``; raise ``UploadError`` when it is refused.

    ``active`` is the upload in progress. A clip is uploaded once: one that is
    on YouTube, or on its way, is refused. A failed or interrupted one may be
    tried again.
    """
    run = lab.load_run(config, run_id)
    if run is None:
        raise UploadError(f"there is no test render called {run_id}")
    if not _uploadable(config, run):
        raise UploadError("only a finished test render can be uploaded")
    state = load(config, run_id, active)
    if state and state.get("status") == "done":
        raise UploadError(f"this clip is already on YouTube: {state.get('url')}")
    if state and state.get("status") in ("ready", "uploading"):
        raise UploadError("this clip is already being uploaded")
    title = " ".join(title.split()) if isinstance(title, str) else title
    description = description.strip() if isinstance(description, str) else description
    problems = check_metadata(title, description)
    if problems:
        raise UploadError("YouTube would not accept this title or description", problems)
    stamp = (now or _dt.datetime.now(_dt.timezone.utc)).replace(microsecond=0).isoformat()
    return _save(config, run_id, {
        "status": "ready", "title": title, "description": description, "privacy": PRIVACY,
        "requestedAt": stamp, "finishedAt": None,
        "videoId": None, "url": None, "studioUrl": None, "decision": None, "message": None,
    })


def _same_clip(clip: Mapping[str, Any], other: Mapping[str, Any]) -> bool:
    return lab._clip_key(clip) == lab._clip_key(other)


def record_decision(config: Dict[str, Any], run: Mapping[str, Any], video_id: str) -> Dict[str, Any]:
    """Record the uploaded clip as published: as the pick or candidate it came from, or, when the
    Lab cut it differently or the SEO file has changed since, as an untracked Short named by its headline."""
    stem, clip = run["stem"], run["clip"]
    recut = "start" in run.get("edits", {}) or "end" in run.get("edits", {})
    row = None
    if not recut and clip["source"] == "pick":
        rendered = [r for r in publish_log.rendered_clips(config, stem) if r["index"] == clip["index"]]
        if rendered and _same_clip(rendered[0]["clip"], clip):
            row = publish_log.mark_rendered(config, stem, clip["index"], "published", video_id)
    elif not recut and clip["source"] == "candidate":
        candidates = publish_log.candidate_clips(config, stem)
        if clip["index"] < len(candidates) and _same_clip(candidates[clip["index"]], clip):
            row = publish_log.mark_candidate(config, stem, clip["index"], "published", video_id)
    if row is None:
        note = f"Lab run {run['id']}, {clip['start']:g}–{clip['end']:g} s of the episode"
        row = publish_log.mark_untracked(config, stem, clip["headline"], video_id, note)
    return {"source": row["source"], "headline": row["headline"]}


def _names(names: List[str]) -> str:
    return names[0] if len(names) == 1 else f"{', '.join(names[:-1])} and {names[-1]}"


def run_upload(config: Dict[str, Any], run_id: str, env: Mapping[str, str],
               open_url: Opener = urllib.request.urlopen) -> int:
    """Upload a run whose upload is ``ready`` and return the exit status. Progress goes to stdout, the log."""
    state = load(config, run_id)
    run = lab.load_run(config, run_id)
    if run is None or not state or state.get("status") != "ready":
        print("Nothing to upload: ask for it first (the Lab's Publish to YouTube, or --title).")
        return 1

    def failed(message: str) -> int:
        print(message)
        _save(config, run_id, {**state, "status": "failed", "message": message, "finishedAt": _now()})
        return 1

    missing = missing_credentials(env)
    if missing:
        return failed(f"{_names(missing)} {'is' if len(missing) == 1 else 'are'} not set in .env. "
                      "See the README's YouTube section to set them up.")
    state = _save(config, run_id, {**state, "status": "uploading", "message": None})
    clip = lab.lab_dir(config) / run_id / run["clipFile"]
    try:
        print("Signing in to Google…", flush=True)
        token = access_token(env, open_url)
        print(f"Uploading {clip.name} ({clip.stat().st_size:,} bytes) as a private video…", flush=True)
        video_id = upload_video(clip, state["title"], state["description"], token, open_url)
    except (YouTubeError, OSError) as exc:
        return failed(str(exc))
    # Written before the decision, so the video's address is kept whatever happens next.
    state = _save(config, run_id, {
        **state, "status": "done", "videoId": video_id, "url": publish_log.short_url(video_id),
        "studioUrl": f"https://studio.youtube.com/video/{video_id}/edit", "finishedAt": _now(),
    })
    print(f"Uploaded: {state['url']} (private)")
    try:
        decision = record_decision(config, run, video_id)
    except (OSError, ValueError) as exc:
        message = f"Uploaded, but the publish decision was not recorded ({exc}). Record it on the Clips tab."
        print(message)
        _save(config, run_id, {**state, "message": message})
        return 0
    print(f"Recorded as published ({decision['source']}: {decision['headline']}).")
    _save(config, run_id, {**state, "decision": decision})
    return 0


def finish(config: Dict[str, Any], run_id: str, returncode: int, timed_out: bool = False) -> Optional[Dict[str, Any]]:
    """After the upload process ends: an upload it left ``ready`` or ``uploading`` failed, and says how."""
    state = load(config, run_id)
    if not state or state.get("status") not in ("ready", "uploading"):
        return state
    if timed_out:
        message = "stopped: the upload ran past its time limit. Check YouTube Studio before trying again."
    else:
        message = f"the upload exited with status {returncode}"
        if state["status"] == "uploading":
            message += ". Check YouTube Studio before trying again."
    return _save(config, run_id, {**state, "status": "failed", "message": message, "finishedAt": _now()})


def view(config: Dict[str, Any], run: Mapping[str, Any], number: Optional[int], episode_title: Optional[str],
         active: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """What the Lab shows about uploading a run: None until its render has finished.

    ``published`` is the Short this clip is already recorded as, if any, so
    the page can say so before a second upload.
    """
    if not _uploadable(config, run):
        return None
    clip = run["clip"]
    published = next((row for row in publish_log.load(config)["decisions"]
                      if row.get("decision") == "published" and row.get("youtubeId") and row["stem"] == run["stem"]
                      and row["source"] != "untracked" and _same_clip(row, clip)), None)
    return {
        "state": load(config, run["id"], active),
        "privacy": PRIVACY,
        "defaultTitle": default_title(number, episode_title, clip["headline"]),
        "defaultDescription": default_description(number, episode_title),
        "titleMax": TITLE_MAX_CHARS,
        "published": publish_log.short_url(published["youtubeId"]) if published else None,
    }
