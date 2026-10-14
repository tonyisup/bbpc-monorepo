"""The Clips tab: rendered picks, the candidates that were not rendered, and publish decisions."""
import json
import unittest
from unittest import mock

import dashboard_fixture
import test_dashboard_server as server_tests
import test_dashboard_views as view_tests
from dashboard import views
from dashboard_fixture import snapshot
from lib import publish_log

PUBLISHED = {"stem": "20260105", "source": "pick", "start": 10.0, "end": 40.0, "headline": "Bit 1",
             "file": "01-bit-1.mp4", "decision": "published", "youtubeId": "abcdefghijk",
             "youtubeUrl": "https://youtube.com/shorts/abcdefghijk"}


class ClipsViewTests(view_tests.ViewsTestCase):
    def test_the_tab_opens_on_the_newest_episode_with_clips_left_to_review(self):
        view = views.clips(self.config)
        self.assertEqual((view.get("stem"), view.get("number"), view.get("title"), view.get("date")),
                         ("20260112", 802, "Beta", "2026-01-12"))
        self.assertEqual(view.get("counts"), publish_log.report(self.config, ["20260112"])[0])
        self.assertEqual((view.get("prev"), view.get("next")), ("20260105", None))

    def test_with_nothing_left_to_review_it_opens_on_the_newest_episode(self):
        publish_log.mark_rest(self.config, "20260112", "skipped")
        self.assertEqual(views.clips(self.config).get("stem"), "20260112")
        (self.root / "output/publish-decisions.json").unlink()
        for stem in ("20260105", "20260112"):
            for path in (self.root / "output/clips" / stem).iterdir():
                path.unlink()
            (self.root / "output/clips" / stem).rmdir()
        self.assertEqual(views.clips(self.config), {
            "episodes": [], "stem": None, "lengths": {"count": 0, "shortest": None, "longest": None}})

    def test_every_episode_with_clips_or_decisions_is_in_the_picker_newest_first(self):
        episodes = views.clips(self.config).get("episodes") or []
        self.assertEqual([(ep["stem"], ep["number"], ep["title"], ep["rendered"], ep["toReview"], ep["published"],
                           ep["skipped"], ep["untracked"]) for ep in episodes], [
            ("20260112", 802, "Beta", 3, 3, 0, 0, 0),
            ("20260105", 801, "Alpha", 3, 0, 1, 2, 0),
            ("20251201", None, None, 0, 0, 0, 0, 1),
        ])

    def test_rendered_picks_can_be_played_and_show_what_was_decided(self):
        view = views.clips(self.config, "20260105")
        self.assertEqual((view.get("prev"), view.get("next")), ("20251201", "20260112"))
        rendered = view.get("rendered") or []
        self.assertEqual(rendered[:1], [{
            "index": 1, "file": "01-bit-1.mp4", "fileExists": True, "url": "/media/output/clips/20260105/01-bit-1.mp4",
            "headline": "Bit 1", "start": 10.0, "end": 40.0, "seconds": 30.0, "why": "Funny",
            "decision": PUBLISHED, "longerThanPublished": False, "labClip": "pick-1",
        }])
        self.assertEqual([(r["index"], r["decision"]["decision"]) for r in rendered],
                         [(1, "published"), (2, "skipped"), (3, "skipped")])
        self.assertEqual(view.get("lengths"), {"count": 1, "shortest": 30.0, "longest": 30.0})

    def test_a_pick_whose_file_is_gone_has_nothing_to_play(self):
        (self.root / "output/clips/20260105/02-bit-5.mp4").unlink()
        rendered = views.clips(self.config, "20260105").get("rendered") or [{}, {}]
        self.assertEqual((rendered[1].get("fileExists"), rendered[1].get("url")), (False, None))

    def test_only_candidates_that_were_not_rendered_are_listed_by_their_position(self):
        publish_log.mark_candidate(self.config, "20260105", 2, "skipped", reason="slow")
        view = views.clips(self.config, "20260105")
        candidates = view.get("candidates") or []
        self.assertEqual(view.get("candidateCount"), 20)
        self.assertEqual([c["index"] for c in candidates], [i for i in range(20) if i not in (0, 4, 9)])
        self.assertEqual(candidates[1], {
            "index": 2, "headline": "Bit 3", "start": 30.0, "end": 60.0, "seconds": 30.0, "why": "Funny",
            "decision": {**publish_log.listing(self.config, "20260105")["candidates"][2]["decision"], "youtubeUrl": None},
            "longerThanPublished": False, "labClip": "candidate-2",
        })
        self.assertEqual(candidates[1]["decision"]["reason"], "slow")
        self.assertIsNone(candidates[0]["decision"])

    def test_published_clips_come_first_and_the_rest_keep_their_order(self):
        publish_log.mark_rendered(self.config, "20260112", 3, "published", youtube="cdefghijklm")
        publish_log.mark_rendered(self.config, "20260112", 1, "skipped")
        publish_log.mark_candidate(self.config, "20260112", 15, "published", youtube="defghijklmn")
        publish_log.mark_candidate(self.config, "20260112", 6, "published", youtube="efghijklmno")
        publish_log.mark_candidate(self.config, "20260112", 2, "skipped")
        view = views.clips(self.config, "20260112")
        self.assertEqual([row["index"] for row in view.get("rendered") or []], [3, 1, 2])
        self.assertEqual([row["index"] for row in view.get("candidates") or []],
                         [6, 15] + [i for i in range(20) if i not in (0, 4, 9, 6, 15)])

    def test_the_lab_is_offered_only_for_an_episode_whose_audio_is_here(self):
        with_audio, without = views.clips(self.config, "20260105"), views.clips(self.config, "20260112")
        self.assertEqual((with_audio.get("lab"), without.get("lab")), (True, False))
        self.assertEqual({row.get("labClip") for row in (without.get("rendered") or [{}]) + (without.get("candidates") or [{}])},
                         {None})

    def test_an_episode_known_only_by_an_untracked_short(self):
        view = views.clips(self.config, "20251201")
        self.assertEqual((view.get("rendered"), view.get("candidates"), view.get("lab")), ([], [], False))
        self.assertEqual([(d["headline"], d["youtubeId"], d.get("youtubeUrl")) for d in view.get("untracked") or []],
                         [("Bingo Card", "bcdefghijkl", "https://youtube.com/shorts/bcdefghijkl")])

    def test_an_episode_with_no_clips_and_no_decisions_is_not_on_the_tab(self):
        for stem in ("20100101", "20260119", "20991231", "../20260105", ""):
            with self.subTest(stem):
                self.assertIsNone(views.clips(self.config, stem))

    def test_today_counts_the_clips_left_to_review(self):
        self.assertEqual(views.today(self.config).get("clipsToReview"), 3)
        publish_log.mark_rendered(self.config, "20260112", 1, "skipped")
        self.assertEqual(views.today(self.config).get("clipsToReview"), 2)

    def test_looking_at_the_tab_writes_nothing(self):
        before = snapshot(self.root)
        views.clips(self.config)
        for stem in ("20260105", "20260112", "20251201"):
            views.clips(self.config, stem)
        self.assertEqual(snapshot(self.root), before)


class ClipsServerTestCase(server_tests.LabServerTestCase):
    def setUp(self):
        super().setUp()
        self.log = self.root / "output" / "publish-decisions.json"

    def decisions(self, stem="20260112"):
        return [(d["source"], d["headline"], d["decision"], d.get("youtubeId"), d.get("reason"))
                for d in json.loads(self.log.read_text())["decisions"] if d["stem"] == stem]


class ClipsApiTests(ClipsServerTestCase):
    def test_the_tab_is_its_view_as_json(self):
        _, config = views.load_config(self.config_path)
        round_trip = lambda value: json.loads(json.dumps(value))  # noqa: E731
        self.assertEqual(self.api("/api/clips"), round_trip(views.clips(config)))
        self.assertEqual(self.api("/api/clips?stem=20260105"), round_trip(views.clips(config, "20260105")))
        self.assertEqual(self.api("/api/clips")["stem"], "20260112")
        self.assertEqual(self.api("/api/today")["clipsToReview"], 3)

    def test_an_episode_that_is_not_on_the_tab_is_a_404(self):
        for stem in ("20100101", "20991231", "..%2F20260105", "nope"):
            with self.subTest(stem):
                response, body = self.request(f"/api/clips?stem={stem}")
                self.assertEqual(response.status, 404)
                self.assertIn("error", json.loads(body))

    def test_a_rendered_clip_is_marked_published_then_skipped_instead(self):
        status, answer = self.post("/api/clips/decide", {
            "stem": "20260112", "clip": 2, "decision": "published", "youtube": "https://youtube.com/shorts/abcdefghijk"})
        self.assertEqual((status, [(r["headline"], r["youtubeId"]) for r in (answer or {}).get("rows", [])]),
                         (200, [("Bit 5", "abcdefghijk")]))
        self.assertEqual(self.decisions(), [("pick", "Bit 5", "published", "abcdefghijk", None)])
        self.assertEqual(self.api("/api/clips?stem=20260112")["counts"]["toReview"], 2)
        status, _ = self.post("/api/clips/decide", {"stem": "20260112", "clip": "2", "decision": "skipped",
                                                   "reason": "changed my mind"})
        self.assertEqual((status, self.decisions()), (200, [("pick", "Bit 5", "skipped", None, "changed my mind")]))

    def test_the_rest_a_candidate_and_an_untracked_short(self):
        self.assertEqual(self.post("/api/clips/decide", {"stem": "20260112", "clip": "c2", "decision": "published",
                                                         "youtube": "bcdefghijkl"})[0], 200)
        status, answer = self.post("/api/clips/decide", {"stem": "20260112", "clip": "rest", "decision": "skipped",
                                                         "reason": "none landed"})
        self.assertEqual((status, len(answer["rows"])), (200, 3))
        status, answer = self.post("/api/clips/untracked", {"stem": "20260112", "label": "Bingo Card",
                                                            "youtube": "U7w5VheXhAc", "note": "cut by hand"})
        self.assertEqual((status, (answer or {}).get("row", {}).get("source")), (200, "untracked"))
        self.assertEqual(self.decisions(), [
            ("candidate", "Bit 3", "published", "bcdefghijkl", None),
            ("pick", "Bit 1", "skipped", None, "none landed"),
            ("pick", "Bit 5", "skipped", None, "none landed"),
            ("pick", "Bit 10", "skipped", None, "none landed"),
            ("untracked", "Bingo Card", "published", "U7w5VheXhAc", "cut by hand"),
        ])
        view = self.api("/api/clips?stem=20260112")
        self.assertEqual((view["counts"]["toReview"], view["counts"]["publishedNotPicked"], len(view["untracked"])),
                         (0, 1, 1))
        self.assertEqual(self.api("/api/today")["clipsToReview"], 0)

    def test_what_the_library_refuses_is_a_400_with_its_reason_and_nothing_is_written(self):
        refused = [
            ("/api/clips/decide", {"stem": "20260112", "clip": 1, "decision": "published"}, "publish needs the Short's"),
            ("/api/clips/decide", {"stem": "20260112", "clip": 1, "decision": "published", "youtube": "soon"},
             "not a YouTube video ID or URL"),
            ("/api/clips/decide", {"stem": "20260112", "clip": "rest", "decision": "published", "youtube": "abcdefghijk"},
             "rest can only be skipped"),
            ("/api/clips/decide", {"stem": "20260112", "clip": 7, "decision": "skipped"}, "does not exist"),
            ("/api/clips/decide", {"stem": "../20260112", "clip": 1, "decision": "skipped"}, "episode must be a date"),
            ("/api/clips/decide", {"stem": "20260112", "decision": "skipped"}, "clip must be"),
            ("/api/clips/decide", {"stem": "20260112", "clip": 1}, "decision must be one of"),
            ("/api/clips/untracked", {"stem": "20260112", "youtube": "U7w5VheXhAc"}, "needs a label"),
            ("/api/clips/untracked", {"stem": "20260112", "label": "Bingo Card"}, "needs its YouTube URL or ID"),
        ]
        before = snapshot(self.root)
        for path, payload, reason in refused:
            with self.subTest(path=path, payload=payload):
                status, answer = self.post(path, payload)
                self.assertEqual(status, 400)
                self.assertIn(reason, (answer or {}).get("error", ""))
        self.assertEqual(snapshot(self.root), before)

    def test_clips_posts_are_guarded_like_the_labs(self):
        skip = {"stem": "20260112", "clip": 1, "decision": "skipped"}
        before = snapshot(self.root)
        for label, how, status in (("no token", dict(token=False), 403),
                                   ("another site", dict(origin="http://evil.example"), 403),
                                   ("another host", dict(host=f"evil.example:{self.port}"), 403),
                                   ("a form post", dict(content_type="application/x-www-form-urlencoded"), 415)):
            with self.subTest(label):
                self.assertEqual(self.post("/api/clips/decide", skip, **how)[0], status)
        self.assertEqual(snapshot(self.root), before)

    def test_unknown_clips_paths_are_404_and_the_view_refuses_posts(self):
        for path in ("/api/clips/nope", "/api/clips/", "/api/clips/decide/x"):
            with self.subTest(path):
                self.assertEqual(self.post(path, {})[0], 404)
        response, _ = self.request("/api/clips", method="POST", body=b"{}", headers={
            "Content-Type": "application/json", "Origin": f"http://127.0.0.1:{self.port}",
            "X-Dashboard-Token": self.token})
        self.assertEqual((response.status, response.getheader("Allow")), (405, "GET"))
        self.assertEqual(self.status("/api/clips/decide"), 404)

    def test_a_decision_touches_only_the_decisions_log(self):
        before = snapshot(self.root)
        self.assertEqual(self.post("/api/clips/decide", {"stem": "20260112", "clip": 1, "decision": "skipped"})[0], 200)
        changed = sorted({row[0] for row in set(snapshot(self.root)) ^ set(before)})
        self.assertEqual(changed, ["output", "output/publish-decisions.json"])
        self.assertEqual(sorted(p.name for p in (self.root / "output").iterdir() if p.name.startswith(".")),
                         [".hidden.png"])


class ClipsReadOnlyTests(server_tests.ServerTestCase):
    def test_get_requests_for_the_tab_write_nothing(self):
        before = snapshot(self.root)
        for path in ("/api/clips", "/api/clips?stem=20260105", "/api/clips?stem=20251201",
                     "/media/output/clips/20260105/01-bit-1.mp4"):
            with self.subTest(path):
                self.assertEqual(self.status(path), 200)
        self.assertEqual(snapshot(self.root), before)

    def test_a_broken_decisions_log_is_reported_not_served_as_empty(self):
        dashboard_fixture.write(self.root / "output/publish-decisions.json", data=b"{not json")
        with mock.patch("traceback.print_exc"):
            self.assertEqual(self.status("/api/clips"), 500)


if __name__ == "__main__":
    unittest.main()
