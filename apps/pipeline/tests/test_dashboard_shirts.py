"""The Shirts tab: its view, its API, and the Rescan button's runner."""
import json
import os
import sys
import time
import unittest
from pathlib import Path
from unittest import mock

import dashboard_fixture
import test_dashboard_server as server_tests
import test_dashboard_views as view_tests
from dashboard import scan_runner, views
from dashboard_fixture import snapshot
from lib import phrase_scan, shirt_ideas

ROOT = Path(__file__).resolve().parents[1]
IDLE = {"running": False, "startedAt": None, "finishedAt": None, "returncode": None, "timedOut": False,
        "output": ""}
PERSON = {"kind": "person", "text": "Names a real person: Slater"}
UNSURE = {"kind": "unsure", "text": "Origin not checked: it may be a quote"}

# A stand-in for scripts/scan_phrases.py: rewrites the report and says so.
def in_the_past(root):
    """The fixture dates its report and ignore list in 2027; put both behind us, the report older."""
    for name, saved in (("recurring-phrases.json", 1_600_000_000), ("ignore.txt", 1_600_018_000)):
        os.utime(root / "output" / "phrases" / name, (saved, saved))


STAND_IN = """
import json, pathlib, sys, time
report, behaviour = pathlib.Path(sys.argv[1]), sys.argv[2]
print("Scanning", flush=True)
if behaviour == "slow":
    time.sleep(30)
if behaviour == "crash":
    print("no transcripts", file=sys.stderr)
    sys.exit(3)
result = json.loads(report.read_text())
result["scannedAt"] = "2026-03-01T09:00:00+00:00"
report.write_text(json.dumps(result))
print("Scanned 4 transcripts")
"""


class ShirtsViewTests(view_tests.ViewsTestCase):
    def test_an_empty_shortlist_still_shows_every_source(self):
        view = views.shirts(self.config)
        self.assertEqual({key: view.get(key) for key in ("file", "saved", "statuses", "origins", "ideas", "rescan")}, {
            "file": "output/tshirt/ideas.json", "saved": False,
            "statuses": ["idea", "shortlisted", "designing", "done", "rejected"],
            "origins": ["original", "quote", "unsure"], "ideas": [], "rescan": IDLE,
        })
        self.assertEqual(view.get("scan"), {
            **phrase_scan.report_status(self.root / "output" / "phrases"),
            "sections": shirt_ideas.scan_sections(self.config),
        })
        self.assertEqual((view.get("scan") or {}).get("stale"), True)
        self.assertEqual(view.get("notes"), {"file": "output/tshirt/ideas.txt", "lines": shirt_ideas.notes(self.config)})
        self.assertEqual(len((view.get("notes") or {}).get("lines") or []), 4)

    def test_episode_picks_name_the_episode_and_can_be_heard_when_its_audio_is_here(self):
        dashboard_fixture.write(self.root / "output/cowork/20260105.shirts.json", dashboard_fixture.shirts(
            "20260105", dashboard_fixture.shirt("Free parking", 30)))
        episodes = views.shirts(self.config).get("episodes") or []
        self.assertEqual([{key: ep.get(key) for key in ("stem", "date", "number", "title", "audioUrl", "problems")}
                          for ep in episodes], [
            {"stem": "20260112", "date": "2026-01-12", "number": 802, "title": "Beta", "audioUrl": None, "problems": []},
            {"stem": "20260105", "date": "2026-01-05", "number": 801, "title": "Alpha",
             "audioUrl": "/media/episodes/20260105.mp3", "problems": []},
        ])
        self.assertEqual([ep.get("phrases") for ep in episodes],
                         [row["phrases"] for row in shirt_ideas.episode_phrases(self.config)])

    def test_each_idea_carries_its_flags_where_it_came_from_and_its_audio(self):
        dashboard_fixture.write(self.root / "output/cowork/20260105.shirts.json", dashboard_fixture.shirts(
            "20260105", dashboard_fixture.shirt("Free parking", 30)))
        slater = shirt_ideas.add_from_scan(self.config, "give it a slater")
        parking = shirt_ideas.add_from_episode(self.config, "20260105", 1)
        gravy = shirt_ideas.add_from_episode(self.config, "20260112", 1)
        view = views.shirts(self.config)
        self.assertEqual(view.get("saved"), True)
        self.assertEqual(view.get("ideas"), [
            {**slater, "flags": [UNSURE, PERSON], "hear": None,
             "fromText": "phrase scan, Catchphrases, 30 episodes 20110416-20260105"},
            {**parking, "flags": [], "fromText": "episode 20260105 at 0:00:30, Harley",
             "hear": {"url": "/media/episodes/20260105.mp3", "start": 30.0}},
            {**gravy, "flags": [], "fromText": "episode 20260112 at 0:00:20, Harley", "hear": None},
        ])
        self.assertEqual(views.shirt_idea(self.config, parking), view["ideas"][1] if view.get("ideas") else None)

    def test_the_view_passes_on_what_the_rescan_runner_reports(self):
        state = {**IDLE, "running": True, "startedAt": "2026-03-01T09:00:00+00:00"}
        self.assertEqual(views.shirts(self.config, state).get("rescan"), state)

    def test_a_page_of_phrases_is_the_librarys_with_audio_for_examples_that_have_it(self):
        page = views.shirt_phrases(self.config, "catchphrases", query="pain")
        expected = shirt_ideas.scan_rows(self.config, "catchphrases", query="pain")
        self.assertEqual({key: value for key, value in page.items() if key != "rows"},
                         {key: value for key, value in expected.items() if key != "rows"})
        (row,) = page.get("rows") or [{}]
        self.assertEqual(row.get("examples"), [
            {"stem": "20100101", "start": 20.0, "text": "All aboard the pain train.", "audioUrl": None},
            {"stem": "20260105", "start": 30.0, "text": "That is the pain train, baby.",
             "audioUrl": "/media/episodes/20260105.mp3"},
        ])
        self.assertEqual({key: value for key, value in row.items() if key != "examples"},
                         {key: value for key, value in expected["rows"][0].items() if key != "examples"})
        self.assertEqual(views.shirt_phrases(self.config, "gags", offset=1, limit=1).get("rows"),
                         [{**row, "examples": []} for row in shirt_ideas.scan_rows(self.config, "gags", offset=1, limit=1)["rows"]])

    def test_looking_at_the_tab_writes_nothing(self):
        before = snapshot(self.root)
        views.shirts(self.config)
        for section, _ in phrase_scan.SECTIONS:
            views.shirt_phrases(self.config, section)
        self.assertEqual(snapshot(self.root), before)
        self.assertFalse((self.root / "output/tshirt/ideas.json").exists())


class ScanRunnerTests(unittest.TestCase):
    def test_a_rescan_is_the_scan_script_run_by_this_python(self):
        self.assertEqual(scan_runner.scan_command(Path("/x/config.json")), [
            sys.executable, str(ROOT / "scripts" / "scan_phrases.py"), "--config", "/x/config.json"])

    def test_before_any_rescan_there_is_nothing_to_report(self):
        self.assertEqual(scan_runner.ScanRunner().state(), IDLE)


class ShirtsServerTestCase(server_tests.LabServerTestCase):
    scan_behaviour = "scan"
    scan_timeout = 20.0

    def server_options(self):
        report = self.root / "output" / "phrases" / "recurring-phrases.json"

        def command(config_path):
            return [sys.executable, "-c", STAND_IN, str(report), self.scan_behaviour]
        return dict(super().server_options(), scan_command=command, scan_timeout=self.scan_timeout)

    def setUp(self):
        super().setUp()
        self.ideas = self.root / "output" / "tshirt" / "ideas.json"

    def saved(self):
        return json.loads(self.ideas.read_text()).get("ideas") if self.ideas.is_file() else None

    def rescan_finished(self, timeout=15.0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            state = self.api("/api/shirts").get("rescan") or {}
            if state.get("finishedAt") and not state.get("running"):
                return state
            time.sleep(0.02)
        self.fail("the rescan did not finish")


class ShirtsApiTests(ShirtsServerTestCase):
    def test_the_tab_and_a_page_of_phrases_are_their_views_as_json(self):
        _, config = views.load_config(self.config_path)
        round_trip = lambda value: json.loads(json.dumps(value))  # noqa: E731
        self.assertEqual(self.api("/api/shirts"), round_trip(views.shirts(config, IDLE)))
        self.assertEqual(self.api("/api/shirts/phrases?section=passages&q=place&offset=0&limit=1"),
                         round_trip(views.shirt_phrases(config, "passages", "place", 0, 1)))
        self.assertEqual(self.api("/api/shirts/phrases?section=gags")["total"], 2)

    def test_a_page_request_the_library_refuses_is_a_400(self):
        for query in ("", "?section=bangers", "?section=gags&limit=lots", "?section=gags&offset=-1",
                      "?section=gags&limit=0"):
            with self.subTest(query):
                response, body = self.request(f"/api/shirts/phrases{query}")
                self.assertEqual(response.status, 400)
                self.assertIn("error", json.loads(body))

    def test_an_idea_can_be_typed_in_changed_and_removed(self):
        status, answer = self.post("/api/shirts/ideas", {
            "from": "manual", "phrase": "Give it a Slater", "printText": "GIVE IT A SLATER", "notes": "Rating shirt"})
        self.assertEqual(status, 200)
        idea = (answer or {}).get("idea") or {}
        self.assertEqual({key: idea.get(key) for key in ("id", "phrase", "printText", "status", "origin", "flags", "fromText")}, {
            "id": 1, "phrase": "Give it a Slater", "printText": "GIVE IT A SLATER", "status": "idea",
            "origin": "unsure", "flags": [UNSURE, PERSON], "fromText": "typed in"})
        status, answer = self.post("/api/shirts/ideas/update", {
            "id": 1, "status": "designing", "origin": "quote", "source": "Some Film"})
        self.assertEqual((status, answer["idea"]["status"], answer["idea"]["source"], answer["idea"]["flags"][0]["kind"]),
                         (200, "designing", "Some Film", "quote"))
        status, answer = self.post("/api/shirts/ideas/update", {"id": 1, "origin": "original", "source": None})
        self.assertEqual((status, answer["idea"]["origin"], answer["idea"]["source"]), (200, "original", None))
        self.assertEqual([(i["id"], i["status"], i["origin"]) for i in self.saved()], [(1, "designing", "original")])
        self.assertEqual(self.api("/api/shirts")["ideas"][0]["printText"], "GIVE IT A SLATER")
        status, answer = self.post("/api/shirts/ideas/delete", {"id": 1})
        self.assertEqual((status, answer["deleted"]["id"], self.saved()), (200, 1, []))

    def test_a_phrase_is_promoted_from_the_scan_an_episode_and_the_notes(self):
        self.assertEqual(self.post("/api/shirts/ideas", {"from": "scan", "phrase": "pain train"})[0], 200)
        self.assertEqual(self.post("/api/shirts/ideas", {"from": "episode", "stem": "20260112", "index": 2})[0], 200)
        self.assertEqual(self.post("/api/shirts/ideas", {"from": "notes", "line": 6})[0], 200)
        self.assertEqual(self.post("/api/shirts/ideas", {"from": "notes", "line": 3, "phrase": "Draculas",
                                                         "status": "shortlisted"})[0], 200)
        self.assertEqual([(i["phrase"], i["status"], i["origin"], i["source"], i["from"]["kind"]) for i in self.saved() or []], [
            ("pain train", "shortlisted", "unsure", None, "scan"),
            ("I'd buy that for a dollar", "shortlisted", "quote", "RoboCop", "episode"),
            ("Goldblum", "idea", "unsure", None, "notes"),
            ("Draculas", "shortlisted", "unsure", None, "notes"),
        ])
        view = self.api("/api/shirts")
        self.assertEqual([row["ideaId"] for row in view["episodes"][0]["phrases"]], [None, 2, None])
        self.assertEqual([row["ideaId"] for row in view["notes"]["lines"]], [None, 4, 3, None])
        self.assertEqual(self.api("/api/shirts/phrases?section=catchphrases")["rows"][0]["ideaId"], 1)

    def test_what_the_library_refuses_is_a_400_with_its_reason_and_nothing_is_written(self):
        refused = [
            ("/api/shirts/ideas", {"phrase": "We ride together", "origin": "quote"}, "a quote needs its source"),
            ("/api/shirts/ideas", {"from": "manual"}, "phrase must be text"),
            ("/api/shirts/ideas", {"from": "scan", "phrase": "gravy boat"}, "is not in the phrase report"),
            ("/api/shirts/ideas", {"from": "episode", "stem": "../state", "index": 1}, "no shirts file"),
            ("/api/shirts/ideas", {"from": "episode", "stem": "20260112", "index": "2"}, "does not exist"),
            ("/api/shirts/ideas", {"from": "notes", "line": 1}, "is not an idea"),
            ("/api/shirts/ideas", {"from": "dream", "phrase": "Pain train"}, "from must be one of"),
            ("/api/shirts/ideas/update", {"id": 5, "status": "done"}, "no idea #5"),
            ("/api/shirts/ideas/update", {"status": "done"}, "no idea #None"),
            ("/api/shirts/ideas/delete", {"id": "1"}, "no idea #1"),
        ]
        # The lock a change takes is there after the first change; a refused one changes nothing else.
        lock = self.root / "output" / "tshirt" / ".ideas.json.lock"
        lock.parent.mkdir(parents=True, exist_ok=True)
        lock.touch()
        before = snapshot(self.root)
        for path, payload, reason in refused:
            with self.subTest(path=path, payload=payload):
                status, answer = self.post(path, payload)
                self.assertEqual(status, 400)
                self.assertIn(reason, (answer or {}).get("error", ""))
        self.assertEqual(snapshot(self.root), before)

    def test_fields_the_page_may_not_set_are_ignored_or_refused(self):
        status, answer = self.post("/api/shirts/ideas", {"phrase": "Pain train", "id": 40, "from": "manual",
                                                         "addedAt": "1999", "came_from": {"kind": "scan"}})
        self.assertEqual((status, answer["idea"]["id"], answer["idea"]["from"]), (200, 1, {"kind": "manual"}))
        self.assertNotEqual(answer["idea"]["addedAt"], "1999")
        status, answer = self.post("/api/shirts/ideas/update", {"id": 1, "phrase": "Gain train", "status": "done"})
        self.assertEqual((status, self.saved()[0]["phrase"], self.saved()[0]["status"]), (200, "Pain train", "done"))

    def test_shirts_posts_are_guarded_like_the_labs(self):
        idea = {"phrase": "Pain train"}
        refused = [("no token", dict(token=False), 403), ("another site", dict(origin="http://evil.example"), 403),
                   ("another host", dict(host=f"evil.example:{self.port}"), 403),
                   ("a form post", dict(content_type="application/x-www-form-urlencoded"), 415)]
        before = snapshot(self.root)
        for label, how, status in refused:
            with self.subTest(label):
                self.assertEqual(self.post("/api/shirts/ideas", idea, **how)[0], status)
                self.assertEqual(self.post("/api/shirts/rescan", {}, **how)[0], status)
        self.assertEqual(snapshot(self.root), before)
        self.assertEqual(self.api("/api/shirts")["rescan"], IDLE)

    def test_unknown_shirts_paths_are_404_and_get_only_paths_refuse_posts(self):
        for path in ("/api/shirts/nope", "/api/shirts/", "/api/shirts/phrases", "/api/shirts/ideas/"):
            with self.subTest(path):
                self.assertEqual(self.post(path, {})[0], 404)
        response, _ = self.request("/api/shirts", method="POST", body=b"{}", headers={
            "Content-Type": "application/json", "Origin": f"http://127.0.0.1:{self.port}",
            "X-Dashboard-Token": self.token})
        self.assertEqual((response.status, response.getheader("Allow")), (405, "GET"))
        self.assertEqual(self.status("/api/shirts/ideas"), 404)
        self.assertEqual(self.status("/api/shirts/rescan"), 404)

    def test_a_broken_ideas_file_is_reported_not_served_as_empty(self):
        dashboard_fixture.write(self.ideas, {"version": 2, "ideas": []})
        with mock.patch("traceback.print_exc"):
            response, body = self.request("/api/shirts")
        self.assertEqual(response.status, 500)
        self.assertIn("ideas.json is version 2", json.loads(body)["error"])
        status, answer = self.post("/api/shirts/ideas", {"phrase": "Pain train"})
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(self.ideas.read_text()), {"version": 2, "ideas": []})


class IgnoreApiTests(ShirtsServerTestCase):
    def setUp(self):
        super().setUp()
        self.ignore = self.root / "output" / "phrases" / "ignore.txt"

    def test_ignore_adds_a_report_phrase_to_ignore_txt_and_the_page_marks_it(self):
        in_the_past(self.root)
        self.assertEqual(self.post("/api/shirts/ignore", {"phrase": "big booty"}), (200, {"ignored": "big booty"}))
        self.assertEqual(self.ignore.read_text(encoding="utf-8"), "pain train\nbig booty\n")
        self.assertTrue(self.api("/api/shirts")["scan"]["stale"])  # until the next Rescan
        rows = self.api("/api/shirts/phrases?section=gags&limit=200")["rows"]
        self.assertIn(("big booty", True), [(row["text"], row.get("ignored")) for row in rows])

    def test_what_the_library_refuses_is_a_400_and_nothing_is_written(self):
        before = snapshot(self.root)
        for payload, reason in (({"phrase": "gravy boat"}, "is not in the phrase report"),
                                ({"phrase": "PAIN TRAIN"}, "already in ignore.txt"), ({}, "phrase must be text")):
            with self.subTest(payload):
                status, answer = self.post("/api/shirts/ignore", payload)
                self.assertEqual(status, 400)
                self.assertIn(reason, (answer or {}).get("error", ""))
        self.assertEqual(snapshot(self.root), before)


class RescanTests(ShirtsServerTestCase):
    def test_rescan_runs_the_scan_and_reports_what_it_printed(self):
        in_the_past(self.root)
        self.assertEqual(self.api("/api/today")["needs"][2]["kind"], "phrases")
        status, answer = self.post("/api/shirts/rescan", {})
        self.assertEqual(status, 202)
        self.assertEqual(((answer or {}).get("rescan") or {}).get("running"), True)
        state = self.rescan_finished()
        self.assertEqual({key: state.get(key) for key in ("running", "returncode", "timedOut", "output")},
                         {"running": False, "returncode": 0, "timedOut": False,
                          "output": "Scanning\nScanned 4 transcripts\n"})
        self.assertLessEqual(state["startedAt"], state["finishedAt"])
        view = self.api("/api/shirts")
        self.assertEqual((view["scan"]["scannedAt"], view["scan"]["stale"]), ("2026-03-01T09:00:00+00:00", False))
        self.assertNotIn("phrases", [need["kind"] for need in self.api("/api/today")["needs"]])


class RescanFailureTests(ShirtsServerTestCase):
    scan_behaviour = "crash"

    def test_a_rescan_that_fails_says_so_and_keeps_the_old_report(self):
        report = self.root / "output/phrases/recurring-phrases.json"
        before = report.read_bytes()
        self.assertEqual(self.post("/api/shirts/rescan", {})[0], 202)
        state = self.rescan_finished()
        self.assertEqual((state.get("returncode"), state.get("output")), (3, "Scanning\nno transcripts\n"))
        self.assertEqual(report.read_bytes(), before)
        self.assertEqual(self.post("/api/shirts/rescan", {})[0], 202)  # and it can be tried again
        self.rescan_finished()


class RescanBusyTests(ShirtsServerTestCase):
    scan_behaviour = "slow"
    scan_timeout = 0.6

    def test_one_rescan_at_a_time_and_one_past_its_limit_is_stopped(self):
        self.assertEqual(self.post("/api/shirts/rescan", {})[0], 202)
        status, answer = self.post("/api/shirts/rescan", {})
        self.assertEqual((status, "already running" in (answer or {}).get("error", "")), (409, True))
        # The scan reads ignore.txt as it starts, so a phrase ignored now would not count until the next one.
        ignore = self.root / "output" / "phrases" / "ignore.txt"
        before = ignore.read_bytes()
        status, answer = self.post("/api/shirts/ignore", {"phrase": "big booty"})
        self.assertEqual((status, (answer or {}).get("error")), (409, "A rescan is running. Ignore phrases once it has finished."))
        self.assertEqual(ignore.read_bytes(), before)
        state = self.rescan_finished()
        self.assertEqual((state.get("timedOut"), state.get("running")), (True, False))
        self.assertNotEqual(state.get("returncode"), 0)


class RealRescanTests(server_tests.LabServerTestCase):
    """No stand-in: the button runs scripts/scan_phrases.py on the temp data directory."""

    def test_the_real_scan_script_rewrites_the_report_for_this_data_directory(self):
        in_the_past(self.root)
        self.assertTrue(self.api("/api/shirts")["scan"]["stale"])
        before = snapshot(self.root)
        self.assertEqual(self.post("/api/shirts/rescan", {})[0], 202)
        deadline = time.monotonic() + 30
        state = {}
        while time.monotonic() < deadline and not state.get("finishedAt"):
            time.sleep(0.05)
            state = self.api("/api/shirts").get("rescan") or {}
        self.assertEqual((state.get("returncode"), state.get("timedOut")), (0, False))
        self.assertIn("Scanned 4 transcripts (20100101–20260119)", state.get("output", ""))
        view = self.api("/api/shirts")["scan"]
        self.assertEqual((view["transcripts"], view["stale"]), (4, False))
        changed = sorted({row[0] for row in set(snapshot(self.root)) ^ set(before)})
        self.assertEqual(changed, ["output/phrases", "output/phrases/recurring-phrases.json",
                                   "output/phrases/recurring-phrases.md"])


class ShirtsReadOnlyTests(server_tests.ServerTestCase):
    def test_get_requests_for_the_tab_write_nothing(self):
        before = snapshot(self.root)
        for path in ("/api/shirts", "/api/shirts/phrases?section=catchphrases", "/api/shirts/phrases?section=titles&q=x"):
            with self.subTest(path):
                self.assertEqual(self.status(path), 200)
        self.assertEqual(snapshot(self.root), before)


if __name__ == "__main__":
    unittest.main()
