import datetime
import io
import json
import os
import tempfile
import unittest
import urllib.error
import urllib.parse
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from unittest import mock

import dashboard_fixture
from dashboard_fixture import snapshot
from lib import data_dir, lab, publish_log, youtube_upload

STEM = "20260105"
NOW = datetime.datetime(2026, 1, 20, 12, 30, 5, tzinfo=datetime.timezone.utc)
CREDENTIALS = {"YOUTUBE_CLIENT_ID": "client-id", "YOUTUBE_CLIENT_SECRET": "client-secret",
               "YOUTUBE_REFRESH_TOKEN": "refresh-token"}
ROOT = Path(__file__).resolve().parents[1]
SESSION = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=xyz"


class Response(io.BytesIO):
    def __init__(self, body=b"", headers=None, status=200):
        super().__init__(body if isinstance(body, bytes) else json.dumps(body).encode())
        self.headers = headers or {}
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def http_error(url, status, body):
    return urllib.error.HTTPError(url, status, "refused", {}, io.BytesIO(json.dumps(body).encode()))


class FakeGoogle:
    """Stands in for urllib's opener: records each request and answers like Google."""

    def __init__(self, video_id="NEWVIDEO_01", fail=None):
        self.requests = []
        self.video_id = video_id
        self.fail = fail

    def __call__(self, request, timeout=None):
        body = request.data.read() if hasattr(request.data, "read") else request.data
        self.requests.append({"method": request.get_method(), "url": request.full_url,
                              "headers": {k.lower(): v for k, v in request.header_items()}, "body": body})
        if self.fail and self.fail[0] == len(self.requests):
            raise http_error(request.full_url, *self.fail[1:])
        if request.full_url == youtube_upload.TOKEN_URL:
            return Response({"access_token": "access-token", "expires_in": 3599, "token_type": "Bearer"})
        if request.full_url == youtube_upload.UPLOAD_URL:
            return Response(b"", {"Location": SESSION})
        if request.full_url == SESSION:
            return Response({"id": self.video_id, "status": {"privacyStatus": "private"}})
        raise AssertionError(f"unexpected request to {request.full_url}")


class MetadataTests(unittest.TestCase):
    def test_the_title_follows_tonys_pattern(self):
        self.assertEqual(youtube_upload.default_title(801, "Alpha", "Bit 5"), "Bad Boys Podcast - 801 - Alpha - Bit 5")
        self.assertEqual(youtube_upload.default_title(None, None, "Bit 5"), "Bad Boys Podcast - Bit 5")

    def test_a_long_episode_title_is_shortened_so_the_bit_still_fits(self):
        title = youtube_upload.default_title(801, "A" * 120, "Por Diós!")
        self.assertEqual(len(title), youtube_upload.TITLE_MAX_CHARS)
        self.assertTrue(title.startswith("Bad Boys Podcast - 801 - AAAA"))
        self.assertTrue(title.endswith("A… - Por Diós!"))

    def test_the_description_names_the_episode(self):
        self.assertEqual(youtube_upload.default_description(801, "Alpha"), "From Bad Boys Podcast episode 801: Alpha")
        self.assertEqual(youtube_upload.default_description(None, None), "From Bad Boys Podcast")

    def test_the_full_episode_is_linked_at_the_end_of_the_description_once(self):
        link = youtube_upload.with_episode_link
        self.assertEqual(link("From episode 801", "EPISODE_801"), "From episode 801\n\nFull episode: https://youtu.be/EPISODE_801")
        self.assertEqual(link("", "EPISODE_801"), "Full episode: https://youtu.be/EPISODE_801")
        self.assertEqual(link("Watch https://youtu.be/EPISODE_801", "EPISODE_801"), "Watch https://youtu.be/EPISODE_801")
        self.assertEqual(link("From episode 801", None), "From episode 801")

    def test_youtube_limits_are_checked_before_anything_is_sent(self):
        cases = [
            (("", "d"), ["the title is empty"]),
            (("x" * 101, "d"), ["the title is 101 characters; YouTube allows 100"]),
            (("a <b>", "c > d"), ["the title cannot contain < or >", "the description cannot contain < or >"]),
            (("t", "é" * 2501), ["the description is 5002 bytes; YouTube allows 5000"]),
            ((7, None), ["the title must be text", "the description must be text"]),
        ]
        for (title, description), problems in cases:
            with self.subTest(title=title):
                self.assertEqual(youtube_upload.check_metadata(title, description), problems)
        self.assertEqual(youtube_upload.check_metadata("x" * 100, "é" * 2500), [])


class GoogleTests(unittest.TestCase):
    def test_an_access_token_comes_from_the_refresh_token(self):
        google = FakeGoogle()
        self.assertEqual(youtube_upload.access_token(CREDENTIALS, google), "access-token")
        (sent,) = google.requests
        self.assertEqual((sent["method"], sent["url"]), ("POST", youtube_upload.TOKEN_URL))
        self.assertEqual(urllib.parse.parse_qs(sent["body"].decode()), {
            "client_id": ["client-id"], "client_secret": ["client-secret"],
            "refresh_token": ["refresh-token"], "grant_type": ["refresh_token"],
        })

    def test_a_refused_refresh_token_says_what_to_do_and_shows_no_secret(self):
        google = FakeGoogle(fail=(1, 400, {"error": "invalid_grant", "error_description": "Token has been expired or revoked."}))
        with self.assertRaises(youtube_upload.YouTubeError) as caught:
            youtube_upload.access_token(CREDENTIALS, google)
        message = str(caught.exception)
        self.assertEqual(message, "Google refused the sign-in (invalid_grant: Token has been expired or revoked.). "
                                  "Run scripts/youtube_auth.py again and update YOUTUBE_REFRESH_TOKEN in .env.")
        for secret in CREDENTIALS.values():
            self.assertNotIn(secret, message)

    def test_missing_credentials_are_named(self):
        self.assertEqual(youtube_upload.missing_credentials({"YOUTUBE_CLIENT_ID": "x", "YOUTUBE_CLIENT_SECRET": ""}),
                         ["YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"])
        self.assertEqual(youtube_upload.missing_credentials(CREDENTIALS), [])

    def test_the_video_is_sent_private_in_a_resumable_upload(self):
        with tempfile.TemporaryDirectory() as tmp:
            video = Path(tmp) / "01-bit-5.mp4"
            video.write_bytes(b"lab video")
            google = FakeGoogle()
            video_id = youtube_upload.upload_video(video, "My title", "My description", "access-token", google)
        self.assertEqual(video_id, "NEWVIDEO_01")
        start, send = google.requests
        self.assertEqual((start["method"], start["url"]), ("POST", youtube_upload.UPLOAD_URL))
        self.assertEqual(json.loads(start["body"]), {
            "snippet": {"title": "My title", "description": "My description", "categoryId": "23"},
            "status": {"privacyStatus": "private", "selfDeclaredMadeForKids": False},
        })
        self.assertEqual({k: start["headers"].get(k) for k in ("authorization", "x-upload-content-type",
                                                               "x-upload-content-length", "content-type")}, {
            "authorization": "Bearer access-token", "x-upload-content-type": "video/mp4",
            "x-upload-content-length": "9", "content-type": "application/json; charset=utf-8",
        })
        self.assertEqual((send["method"], send["url"], send["body"]), ("PUT", SESSION, b"lab video"))
        self.assertEqual((send["headers"]["content-type"], send["headers"]["content-length"]), ("video/mp4", "9"))

    def test_youtube_refusing_the_upload_is_reported_in_its_own_words(self):
        with tempfile.TemporaryDirectory() as tmp:
            video = Path(tmp) / "clip.mp4"
            video.write_bytes(b"v")
            google = FakeGoogle(fail=(1, 403, {"error": {"code": 403, "message": "The request cannot be completed "
                                                         "because you have exceeded your quota.",
                                                         "errors": [{"reason": "quotaExceeded"}]}}))
            with self.assertRaises(youtube_upload.YouTubeError) as caught:
                youtube_upload.upload_video(video, "t", "d", "access-token", google)
        self.assertEqual(str(caught.exception), "YouTube refused the upload (403 quotaExceeded: The request cannot be "
                                                "completed because you have exceeded your quota.)")


class UploadTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name).resolve()
        self.config = dashboard_fixture.build(self.root)
        self.raw = {"paths": {}, "settings": {"visuals_provider": "local"}}
        self.config["settings"]["visuals_provider"] = "local"
        patcher = mock.patch.dict(os.environ, {data_dir.ENV_VAR: str(self.root)})
        patcher.start()
        self.addCleanup(patcher.stop)

    def rendered(self, clip="pick-2", **request):
        """A Lab run that finished and wrote its clip."""
        run = lab.create_run(self.config, self.raw, stem=STEM, clip=clip, now=NOW, **request)
        dashboard_fixture.write(lab.lab_dir(self.config) / run["id"] / run["clipFile"], data=b"lab video")
        return lab.finish_run(self.config, run["id"], 0)

    def prepare(self, run, title="Bad Boys Podcast - 801 - Alpha - Bit 5", description="From episode 801", active=None,
                episode=None):
        return youtube_upload.prepare(self.config, run["id"], title, description, active=active, now=NOW, episode=episode)

    def refused(self, run, **kwargs):
        with self.assertRaises(youtube_upload.UploadError) as caught:
            self.prepare(run, **kwargs)
        return caught.exception

    def upload(self, run, google=None, env=CREDENTIALS):
        google = google or FakeGoogle()
        return youtube_upload.run_upload(self.config, run["id"], env, google), google

    def decisions(self):
        """Tracked decisions by episode and headline (an untracked row can share a headline)."""
        return {(d["stem"], d["headline"]): d for d in publish_log.load(self.config)["decisions"]
                if d["source"] != "untracked"}


class PrepareTests(UploadTestCase):
    def test_an_upload_is_asked_for_in_the_runs_own_folder(self):
        run = self.rendered()
        before = [row for row in snapshot(self.root) if not row[0].startswith(f"output/lab/{run['id']}")]
        state = self.prepare(run)
        self.assertEqual(state, {
            "status": "ready", "title": "Bad Boys Podcast - 801 - Alpha - Bit 5", "description": "From episode 801",
            "privacy": "private", "episodeUrl": None, "requestedAt": "2026-01-20T12:30:05+00:00", "finishedAt": None,
            "videoId": None, "url": None, "studioUrl": None, "decision": None, "message": None,
        })
        self.assertEqual(json.loads((lab.lab_dir(self.config) / run["id"] / "youtube.json").read_text()), state)
        self.assertEqual(youtube_upload.load(self.config, run["id"]), state)
        after = [row for row in snapshot(self.root) if not row[0].startswith(f"output/lab/{run['id']}")]
        self.assertEqual(after, before)

    def test_only_a_finished_render_with_its_clip_can_be_uploaded(self):
        ready = lab.create_run(self.config, self.raw, stem=STEM, clip="pick-1", now=NOW)
        self.assertEqual(str(self.refused(ready)), "only a finished test render can be uploaded")
        failed = lab.finish_run(self.config, ready["id"], 0)  # no clip was written
        self.assertEqual(str(self.refused(failed)), "only a finished test render can be uploaded")
        with self.assertRaises(youtube_upload.UploadError) as caught:
            youtube_upload.prepare(self.config, "../../clips", "t", "d")
        self.assertEqual(str(caught.exception), "there is no test render called ../../clips")
        self.assertFalse((lab.lab_dir(self.config) / ready["id"] / "youtube.json").exists())

    def test_the_title_and_description_are_checked_first(self):
        run = self.rendered()
        refused = self.refused(run, title="x" * 101, description="<b>")
        self.assertEqual(refused.problems, ["the title is 101 characters; YouTube allows 100",
                                            "the description cannot contain < or >"])
        self.assertIsNone(youtube_upload.load(self.config, run["id"]))

    def test_the_full_episode_is_linked_and_remembered_for_the_episodes_other_clips(self):
        first = self.prepare(self.rendered("pick-1"), episode="https://www.youtube.com/watch?v=EPISODE_801&t=3")
        self.assertEqual((first["description"], first["episodeUrl"]), (
            "From episode 801\n\nFull episode: https://youtu.be/EPISODE_801", "https://youtu.be/EPISODE_801"))
        self.assertEqual(json.loads((self.root / "output" / "episode-videos.json").read_text()), {STEM: "EPISODE_801"})
        second = self.prepare(self.rendered("pick-2"))
        self.assertEqual(second["description"], "From episode 801\n\nFull episode: https://youtu.be/EPISODE_801")
        self.assertEqual(youtube_upload.view(self.config, self.rendered("pick-2"), 801, "Alpha")["episodeUrl"],
                         "https://youtu.be/EPISODE_801")

    def test_without_an_episode_link_the_description_is_left_alone(self):
        state = self.prepare(self.rendered())
        self.assertEqual((state["description"], state["episodeUrl"]), ("From episode 801", None))
        self.assertFalse((self.root / "output" / "episode-videos.json").exists())

    def test_an_episode_link_that_is_not_youtube_is_refused_and_not_remembered(self):
        run = self.rendered()
        refused = self.refused(run, title="", episode="https://vimeo.com/123")
        self.assertEqual(refused.problems, ["the title is empty", "the full episode's link is not a YouTube URL or video ID"])
        self.assertEqual(self.refused(run, episode=801).problems, ["the full episode's link must be text"])
        self.assertIsNone(youtube_upload.load(self.config, run["id"]))
        self.assertFalse((self.root / "output" / "episode-videos.json").exists())

    def test_a_clip_is_uploaded_once(self):
        run = self.rendered()
        self.prepare(run)
        self.assertEqual(str(self.refused(run, active=run["id"])), "this clip is already being uploaded")
        self.upload(run)
        self.assertEqual(str(self.refused(run)), "this clip is already on YouTube: https://youtube.com/shorts/NEWVIDEO_01")

    def test_an_upload_that_failed_or_was_cut_off_can_be_tried_again(self):
        run = self.rendered()
        self.prepare(run)
        self.assertEqual(youtube_upload.load(self.config, run["id"], active=None)["status"], "interrupted")
        self.assertEqual(self.prepare(run)["status"], "ready")
        self.upload(run, FakeGoogle(fail=(2, 500, {"error": {"code": 500, "message": "Backend Error"}})))
        self.assertEqual(youtube_upload.load(self.config, run["id"])["status"], "failed")
        self.assertEqual(self.prepare(run, title="Second try")["title"], "Second try")


class RunUploadTests(UploadTestCase):
    def test_without_credentials_nothing_is_sent(self):
        run = self.rendered()
        self.prepare(run)
        code, google = self.upload(run, env={"YOUTUBE_CLIENT_ID": "client-id"})
        self.assertEqual((code, google.requests), (1, []))
        state = youtube_upload.load(self.config, run["id"])
        self.assertEqual((state["status"], state["message"]), (
            "failed", "YOUTUBE_CLIENT_SECRET and YOUTUBE_REFRESH_TOKEN are not set in .env. "
                      "See the README's YouTube section to set them up."))

    def test_an_upload_needs_asking_for_first(self):
        run = self.rendered()
        code, google = self.upload(run)
        self.assertEqual((code, google.requests), (1, []))
        self.assertIsNone(youtube_upload.load(self.config, run["id"]))

    def test_an_uploaded_pick_is_recorded_as_published(self):
        run = self.rendered("pick-2")
        self.assertEqual(self.decisions()[(STEM, "Bit 5")]["decision"], "skipped")
        self.prepare(run)
        code, google = self.upload(run)
        self.assertEqual((code, len(google.requests)), (0, 3))
        self.assertEqual(google.requests[2]["body"], b"lab video")
        state = youtube_upload.load(self.config, run["id"])
        self.assertEqual({k: state[k] for k in ("status", "videoId", "url", "studioUrl", "message")}, {
            "status": "done", "videoId": "NEWVIDEO_01", "url": "https://youtube.com/shorts/NEWVIDEO_01",
            "studioUrl": "https://studio.youtube.com/video/NEWVIDEO_01/edit", "message": None,
        })
        self.assertEqual(state["decision"], {"source": "pick", "headline": "Bit 5"})
        row = self.decisions()[(STEM, "Bit 5")]
        self.assertEqual({k: row.get(k) for k in ("source", "file", "decision", "youtubeId", "start", "end")}, {
            "source": "pick", "file": "02-bit-5.mp4", "decision": "published", "youtubeId": "NEWVIDEO_01",
            "start": 50.0, "end": 80.0,
        })

    def test_the_log_says_what_to_set_the_related_video_to(self):
        run = self.rendered()
        self.prepare(run, episode="EPISODE_801")
        with mock.patch("sys.stdout", new_callable=io.StringIO) as out:
            self.upload(run)
        self.assertIn("set its Related video to the full episode: https://youtu.be/EPISODE_801", out.getvalue())

    def test_an_uploaded_candidate_is_recorded_as_that_candidate(self):
        run = self.rendered("candidate-1", new_background=True)
        self.prepare(run)
        self.assertEqual(self.upload(run)[0], 0)
        row = self.decisions()[(STEM, "Bit 2")]
        self.assertEqual((row["source"], row["decision"], row["youtubeId"]), ("candidate", "published", "NEWVIDEO_01"))

    def test_a_clip_cut_differently_in_the_lab_is_recorded_as_untracked(self):
        run = self.rendered("pick-2", edits={"start": 52.0, "end": 76.5})
        self.prepare(run)
        self.assertEqual(self.upload(run)[0], 0)
        self.assertEqual(self.decisions()[(STEM, "Bit 5")]["decision"], "skipped")  # the real pick is left alone
        untracked = [d for d in publish_log.load(self.config)["decisions"]
                     if d["source"] == "untracked" and d["youtubeId"] == "NEWVIDEO_01"]
        self.assertEqual([(d["headline"], d.get("reason")) for d in untracked],
                         [("Bit 5", f"Lab run {run['id']}, 52–76.5 s of the episode")])
        self.assertEqual(youtube_upload.load(self.config, run["id"])["decision"], {"source": "untracked", "headline": "Bit 5"})

    def test_a_refused_upload_records_nothing(self):
        run = self.rendered()
        self.prepare(run)
        before = publish_log.load(self.config)
        code, _ = self.upload(run, FakeGoogle(fail=(2, 401, {"error": {"code": 401, "message": "Invalid Credentials"}})))
        self.assertEqual(code, 1)
        state = youtube_upload.load(self.config, run["id"])
        self.assertEqual((state["status"], state["message"], state["videoId"]),
                         ("failed", "YouTube refused the upload (401: Invalid Credentials)", None))
        self.assertEqual(publish_log.load(self.config), before)

    def test_an_upload_whose_decision_cannot_be_recorded_still_says_where_the_video_is(self):
        run = self.rendered()
        self.prepare(run)
        with mock.patch.object(publish_log, "_save", side_effect=OSError("disk full")):
            code, _ = self.upload(run)
        state = youtube_upload.load(self.config, run["id"])
        self.assertEqual((code, state["status"], state["videoId"], state["decision"]), (0, "done", "NEWVIDEO_01", None))
        self.assertEqual(state["message"], "Uploaded, but the publish decision was not recorded (disk full). "
                                           "Record it on the Clips tab.")

    def test_how_an_upload_process_ended_is_recorded_when_it_said_nothing(self):
        run = self.rendered()
        self.prepare(run)
        state = youtube_upload.finish(self.config, run["id"], 3)
        self.assertEqual((state["status"], state["message"]), ("failed", "the upload exited with status 3"))
        self.prepare(run)
        state = youtube_upload.finish(self.config, run["id"], -9, timed_out=True)
        self.assertEqual(state["message"], "stopped: the upload ran past its time limit. Check YouTube Studio "
                                           "before trying again.")
        self.prepare(run)
        self.upload(run)
        self.assertEqual(youtube_upload.finish(self.config, run["id"], 0)["status"], "done")


class ViewTests(UploadTestCase):
    def test_a_finished_render_offers_an_upload_with_a_title_ready(self):
        run = self.rendered("pick-1")
        view = youtube_upload.view(self.config, run, 801, "Alpha")
        self.assertEqual(view, {
            "state": None, "privacy": "private",
            "defaultTitle": "Bad Boys Podcast - 801 - Alpha - Bit 1",
            "defaultDescription": "From Bad Boys Podcast episode 801: Alpha",
            "titleMax": 100, "published": "https://youtube.com/shorts/abcdefghijk", "episodeUrl": None,
        })
        self.assertIsNone(youtube_upload.view(self.config, self.rendered("pick-2"), 801, "Alpha")["published"])

    def test_a_render_that_did_not_finish_offers_nothing(self):
        run = lab.create_run(self.config, self.raw, stem=STEM, clip="pick-1", now=NOW)
        self.assertIsNone(youtube_upload.view(self.config, run, 801, "Alpha"))


def load_auth_script():
    spec = spec_from_file_location("youtube_auth", ROOT / "scripts" / "youtube_auth.py")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AuthScriptTests(unittest.TestCase):
    def test_the_sign_in_address_asks_only_to_upload_and_for_a_refresh_token(self):
        youtube_auth = load_auth_script()
        url = youtube_auth.sign_in_url("client-id", "http://127.0.0.1:5555", "state-1", "challenge-1")
        address, query = url.split("?")
        self.assertEqual(address, "https://accounts.google.com/o/oauth2/v2/auth")
        self.assertEqual(urllib.parse.parse_qs(query), {
            "client_id": ["client-id"], "redirect_uri": ["http://127.0.0.1:5555"], "response_type": ["code"],
            "scope": ["https://www.googleapis.com/auth/youtube.upload"], "access_type": ["offline"],
            "prompt": ["consent"], "state": ["state-1"], "code_challenge": ["challenge-1"],
            "code_challenge_method": ["S256"],
        })

    def test_the_code_is_exchanged_with_its_verifier_for_a_refresh_token(self):
        youtube_auth = load_auth_script()
        sent = []

        def google(request, timeout=None):
            sent.append(urllib.parse.parse_qs(request.data.decode()))
            return Response({"access_token": "a", "refresh_token": "new-refresh-token"})

        token = youtube_auth.exchange_code("client-id", "client-secret", "the-code", "http://127.0.0.1:5555",
                                           "verifier-1", google)
        self.assertEqual(token, "new-refresh-token")
        self.assertEqual(sent, [{"client_id": ["client-id"], "client_secret": ["client-secret"], "code": ["the-code"],
                                 "redirect_uri": ["http://127.0.0.1:5555"], "grant_type": ["authorization_code"],
                                 "code_verifier": ["verifier-1"]}])


if __name__ == "__main__":
    unittest.main()
