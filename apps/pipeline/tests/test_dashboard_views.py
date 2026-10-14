import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import dashboard_fixture
from dashboard import views
from dashboard_fixture import snapshot
from lib import cowork_handoff, data_dir, lab, settings_schema, stage_status, visual_prompts

ROOT = Path(__file__).resolve().parents[1]


class ViewsTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name).resolve()
        self.config = dashboard_fixture.build(self.root)
        patcher = mock.patch.dict(os.environ, {data_dir.ENV_VAR: str(self.root)})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self._tmp.cleanup)


class LoadConfigTests(ViewsTestCase):
    def test_load_config_returns_the_file_as_written_and_a_copy_anchored_to_the_data_directory(self):
        path = self.root / "config.json"
        path.write_text(json.dumps({"paths": {"output_dir": "./output"},
                                    "settings": {"cowork_outputs_dir": "./output/cowork", "clip_duration": 60}}))
        raw, config = views.load_config(path)
        self.assertEqual(raw.get("paths"), {"output_dir": "./output"})
        self.assertEqual(raw["settings"]["cowork_outputs_dir"], "./output/cowork")
        self.assertEqual(config["paths"]["output_dir"], str(self.root / "output"))
        self.assertEqual(config["settings"]["cowork_outputs_dir"], str(self.root / "output/cowork"))


class TodayTests(ViewsTestCase):
    def test_needs_you_lists_clips_cowork_stale_phrases_and_unprocessed_transcripts(self):
        needs = views.today(self.config)["needs"]
        self.assertEqual([need["kind"] for need in needs], ["clips", "cowork", "phrases", "unprocessed"])
        clips, cowork, phrases, unprocessed = needs
        self.assertEqual(clips, {"kind": "clips", "stem": "20260112", "date": "2026-01-12", "number": 802,
                                 "title": "Beta", "count": 3})
        self.assertEqual({k: cowork.get(k) for k in ("stem", "date", "number", "ready", "ok", "headless")},
                         {"stem": "20260119", "date": "2026-01-19", "number": None, "ready": False, "ok": False,
                          "headless": False})
        self.config["settings"]["cowork_headless"] = True
        self.assertIs(views.today(self.config)["needs"][1]["headless"], True)
        self.assertEqual({row["label"]: row["status"] for row in cowork["files"]},
                         {"movies": "missing", "seo": "invalid", "shirts": "not_written"})
        self.assertEqual(cowork["files"][1]["problems"], ["'candidateClips' must have exactly 20 clips (found 19)"])
        self.assertIn("must have exactly 20 clips (found 19)", cowork["lastError"])
        self.assertEqual(phrases, {"kind": "phrases", "reportSavedAt": "2027-01-15T08:00:00+00:00",
                                   "ignoreSavedAt": "2027-01-15T13:00:00+00:00"})
        self.assertEqual(unprocessed, {"kind": "unprocessed", "episodes": [
            {"stem": "20100101", "missing": ["SEO file", "state entry"]},
        ]})

        # Nothing is left once every clip is decided, Cowork is done, and the phrases are rescanned.
        out = self.root / "output"
        log = json.loads((out / "publish-decisions.json").read_text())
        for row in list(log["decisions"][:3]):
            log["decisions"].append(dict(row, stem="20260112", decision="skipped"))
        (out / "publish-decisions.json").write_text(json.dumps(log))
        cowork_handoff.mark_episode(self.config, "20260119", cowork_handoff.STATUS_DONE)
        dashboard_fixture.write(out / "seo/20260119.seo.json", dashboard_fixture.seo())
        dashboard_fixture.write(out / "seo/20100101.seo.json", dashboard_fixture.seo())
        cowork_handoff.mark_episode(self.config, "20100101", cowork_handoff.STATUS_DONE)
        os.utime(out / "phrases/ignore.txt", (1_799_000_000, 1_799_000_000))
        self.assertEqual(views.today(self.config)["needs"], [])

    def test_archive_figures(self):
        self.assertEqual(views.today(self.config)["archive"], {
            "transcripts": 4, "firstDate": "2010-01-01", "lastDate": "2026-01-19",
            "done": 2, "waiting": 1,
            "shortsPublished": 2, "decisions": 4,
            "phrasesScanned": True, "phrases": 5, "passages": 2,
        })

    def test_recent_episodes_are_newest_first_with_stages_status_and_shorts(self):
        recent = views.today(self.config)["recent"]
        self.assertEqual([row["stem"] for row in recent], ["20260119", "20260112", "20260105", "20100101"])
        by_stem = {row["stem"]: row for row in recent}
        self.assertEqual({stem: (row["number"], row["title"], row["date"]) for stem, row in by_stem.items()}, {
            "20260119": (None, None, "2026-01-19"),
            "20260112": (802, "Beta", "2026-01-12"),
            "20260105": (801, "Alpha", "2026-01-05"),
            "20100101": (None, None, "2010-01-01"),
        })
        self.assertEqual({stem: row["status"] for stem, row in by_stem.items()}, {
            "20260119": "waiting", "20260112": "review", "20260105": "done", "20100101": "unprocessed",
        })
        self.assertEqual(by_stem["20260105"]["shorts"], {"rendered": 3, "published": 1, "skipped": 2, "toReview": 0})
        self.assertEqual(by_stem["20260112"]["shorts"], {"rendered": 3, "published": 0, "skipped": 0, "toReview": 3})
        self.assertIsNone(by_stem["20260119"]["shorts"])
        for row in recent:
            self.assertEqual(row["stages"], stage_status.stage_statuses(self.config, row["stem"]))
        self.assertEqual([s["state"] for s in by_stem["20260119"]["stages"]],
                         ["done", "inferred", "waiting", "missing", "waiting", "missing", "missing", "unknown"])

    def test_recent_episodes_stop_at_twelve(self):
        for day in range(1, 15):
            dashboard_fixture.write(self.root / f"transcripts/202702{day:02d}.json", [])
        recent = views.today(self.config)["recent"]
        self.assertEqual(len(recent), 12)
        self.assertEqual(recent[0]["stem"], "20270214")


class EpisodeTests(ViewsTestCase):
    def test_a_finished_episode(self):
        ep = views.episode(self.config, "20260105")
        self.assertEqual({k: ep[k] for k in ("stem", "date", "number", "title", "prev", "next")}, {
            "stem": "20260105", "date": "2026-01-05", "number": 801, "title": "Alpha",
            "prev": "20100101", "next": "20260112",
        })
        self.assertEqual(ep["audio"], {"file": "20260105.mp3", "bytes": 10240, "url": "/media/episodes/20260105.mp3"})
        self.assertEqual(ep["thumbnail"], "/media/output/thumbnails/20260105.png")
        self.assertEqual(ep["state"], {"status": "done", "updatedAt": "2026-01-06T00:00:00+00:00"})
        self.assertEqual(ep["stages"], stage_status.stage_statuses(self.config, "20260105"))
        self.assertEqual(ep["seo"], {
            "source": "output/seo/20260105.seo.json", "title": "Alpha, Beta & Gamma | BBPC Ep 801",
            "titleLength": 33, "titleMax": cowork_handoff.TITLE_MAX_CHARS,
        })

    def test_cowork_files_carry_the_validator_result_and_warnings(self):
        cowork = views.episode(self.config, "20260105")["cowork"]
        self.assertEqual(cowork, cowork_handoff.check_episode(self.config, "20260105"))
        rows = {row["label"]: row for row in cowork["files"]}
        self.assertEqual({label: row["status"] for label, row in rows.items()},
                         {"movies": "ok", "seo": "ok", "shirts": "not_written"})
        self.assertEqual(rows["seo"]["warnings"], ["title is 61 characters (keep it to 60)"])

    def test_movies_table_has_each_hosts_rating_and_blanks_where_there_is_none(self):
        movies = views.episode(self.config, "20260105")["movies"]
        self.assertEqual(movies["hosts"], ["Fonso", "Harley", "Tony"])
        self.assertEqual(movies["source"], "output/movies/20260105.movies.json")
        self.assertEqual(movies["extractor"], "cowork_v1 · cowork")
        self.assertEqual(movies["rows"], [
            {"title": "Sketch", "year": 2025, "status": "accepted", "reviewType": "homework", "pickedBy": "Harley",
             "ratings": {"Fonso": "Dollar", "Harley": "Waste", "Tony": "Slater"}, "hasMovieId": True},
            {"title": "Solo Watch", "year": 2024, "status": "accepted", "reviewType": "extra_review",
             "pickedBy": "Tony", "ratings": {"Fonso": None, "Harley": None, "Tony": "Goldblum"}, "hasMovieId": False},
        ])
        # The retired heuristic wrote no host ratings: blanks, not an error.
        old = views.episode(self.config, "20260112")["movies"]
        self.assertEqual(old["extractor"], "hybrid_v3_llm · heuristic")
        self.assertEqual(old["rows"], [
            {"title": "Old Way", "year": 1999, "status": "accepted", "reviewType": None, "pickedBy": None,
             "ratings": {"Fonso": None, "Harley": None, "Tony": None}, "hasMovieId": True},
        ])

    def test_an_episode_without_a_local_mp3_has_no_audio_and_never_uses_the_state_path(self):
        ep = views.episode(self.config, "20260112")
        self.assertIsNone(ep["audio"])
        self.assertEqual(ep["audioEpisodes"], 2)
        self.assertNotIn("episodePath", ep["state"])
        self.assertNotIn("/gone/", json.dumps(ep))

    def test_an_episode_waiting_on_cowork_shows_the_cowork_title_and_the_last_error(self):
        ep = views.episode(self.config, "20260119")
        self.assertEqual((ep["number"], ep["title"], ep["thumbnail"], ep["next"]), (None, None, None, None))
        self.assertEqual(ep["state"].get("status"), "awaiting_cowork")
        self.assertIn("found 19", ep["state"]["lastError"])
        self.assertEqual(ep["seo"]["source"], "output/cowork/20260119.seo.json")
        self.assertEqual(ep["movies"], {"hosts": ["Fonso", "Harley", "Tony"], "source": None, "extractor": None, "rows": []})

    def test_a_long_title_is_measured_against_the_validators_limit(self):
        dashboard_fixture.write(self.root / "output/seo/20260105.seo.json", dashboard_fixture.seo(title="T" * 61))
        seo = views.episode(self.config, "20260105")["seo"]
        self.assertEqual((seo["titleLength"], seo["titleMax"]), (61, 60))

    def test_a_never_processed_episode_and_an_unknown_one(self):
        ep = views.episode(self.config, "20100101")
        self.assertEqual((ep["state"], ep["seo"], ep["prev"]), ({}, None, None))
        self.assertIsNone(views.episode(self.config, "20991231"))
        self.assertIsNone(views.episode(self.config, "../../etc/passwd"))

    def test_a_broken_json_file_is_reported_not_raised(self):
        (self.root / "output/movies/20260105.movies.json").write_text("{not json")
        (self.root / "output/seo/20260105.seo.json").write_text("[]")
        ep = views.episode(self.config, "20260105")
        self.assertEqual(ep["movies"]["rows"], [])
        self.assertEqual(ep["movies"]["source"], "output/movies/20260105.movies.json (could not be read)")
        self.assertEqual(ep["seo"]["title"], None)

    def test_the_episode_list_is_newest_first_with_numbers_and_titles(self):
        self.assertEqual(views.episodes(self.config), [
            {"stem": "20260119", "date": "2026-01-19", "number": None, "title": None},
            {"stem": "20260112", "date": "2026-01-12", "number": 802, "title": "Beta"},
            {"stem": "20260105", "date": "2026-01-05", "number": 801, "title": "Alpha"},
            {"stem": "20100101", "date": "2010-01-01", "number": None, "title": None},
        ])


class MediaUrlTests(ViewsTestCase):
    def test_media_urls_cover_episodes_and_output_and_quote_awkward_names(self):
        out = self.root / "output"
        self.assertEqual(views.media_url(self.config, out / "clips/20260105/01-it's 100% #1?.mp4"),
                         "/media/output/clips/20260105/01-it%27s%20100%25%20%231%3F.mp4")
        self.assertEqual(views.media_url(self.config, self.root / "episodes/20260105.mp3"),
                         "/media/episodes/20260105.mp3")
        self.assertIsNone(views.media_url(self.config, self.root / "transcripts/20260105.json"))


class SettingsTests(ViewsTestCase):
    def setUp(self):
        super().setUp()
        self.raw = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
        self.view = views.settings(self.raw)
        self.rows = {row["key"]: row for group in self.view["groups"] for row in group["settings"]}

    def test_groups_are_in_panel_order_and_hold_every_declared_setting(self):
        self.assertEqual([group["name"] for group in self.view["groups"]], list(settings_schema.GROUPS))
        self.assertEqual(set(self.rows), set(settings_schema.BY_KEY))
        self.assertEqual([row["key"] for row in self.view["groups"][1]["settings"]], [
            "review_clip_merge_gap_seconds", "review_clip_preroll_seconds", "review_clip_postroll_seconds",
            "review_clip_min_seconds", "review_clip_max_seconds", "review_clip_max_per_movie",
        ])

    def test_each_setting_shows_value_default_and_where_the_value_comes_from(self):
        self.assertEqual(self.rows.get("visuals_provider"), {
            "key": "visuals_provider", "type": "choice", "value": "openrouter", "default": "local",
            "source": "config", "stages": ["clip"], "minimum": None, "maximum": None,
            "choices": ["openrouter", "openai", "local"], "problems": [],
            "description": settings_schema.BY_KEY["visuals_provider"].description, "draft": True,
        })
        self.assertEqual({key for key, row in self.rows.items() if row["draft"]},
                         {s.key for s in settings_schema.SETTINGS if s.draft})
        self.assertFalse(self.rows["cowork_headless_command"]["draft"])
        row = self.rows["review_clip_max_seconds"]
        self.assertEqual((row["value"], row["default"], row["source"], row["minimum"], row["maximum"]),
                         (180.0, 180.0, "default", 1, 3600))
        row = self.rows["thumbnail_logo_margin_px"]
        self.assertEqual((row["value"], row["default"], row["source"]), (40, 40, "config"))
        self.assertEqual((self.rows["clip_duration"]["stages"], self.rows["clip_duration"]["value"]), ([], 60))

    def test_a_value_taken_from_a_fallback_setting_names_it(self):
        del self.raw["settings"]["thumbnail_logo_margin_px"]
        rows = {row["key"]: row for group in views.settings(self.raw)["groups"] for row in group["settings"]}
        row = rows.get("thumbnail_logo_margin_px") or {}
        self.assertEqual((row.get("value"), row.get("default"), row.get("source")), (48, 40, "brand_logo_margin_px"))

    def test_config_check_and_an_out_of_range_value(self):
        self.assertEqual(self.view["check"], settings_schema.config_check(self.raw["settings"]))
        self.assertEqual(len(self.view["check"]["notInConfig"]), 29)
        self.raw["settings"]["review_clip_max_per_movie"] = 0
        view = views.settings(self.raw)
        rows = {row["key"]: row for group in view["groups"] for row in group["settings"]}
        self.assertEqual(rows["review_clip_max_per_movie"]["problems"],
                         ["review_clip_max_per_movie must be between 1 and 20, not 0"])
        self.assertEqual(view["check"]["invalid"][0]["key"], "review_clip_max_per_movie")

    def test_the_guardrail_and_cowork_docs_are_shown_read_only(self):
        self.assertNotIn("look", self.view)  # the clip's look is settings now, listed with the rest
        self.assertEqual(self.rows["caption_font_size"]["value"], 84)
        self.assertEqual(self.view["guardrail"], visual_prompts.ABSTRACT_VISUAL_GUARDRAIL)
        self.assertEqual(self.view["docs"], [
            {"name": "docs/cowork-handoff.md", "url": "/docs/cowork-handoff.md"},
            {"name": "docs/show-format.md", "url": "/docs/show-format.md"},
        ])


class LabViewTests(ViewsTestCase):
    def setUp(self):
        super().setUp()
        self.raw = {"paths": {}, "settings": {"visuals_provider": "openrouter", "min_clip_duration_seconds": 15}}

    def test_settings_lists_the_drafts_with_their_changes(self):
        self.assertEqual(views.settings(self.raw)["drafts"], [])
        lab.save_draft(self.config, self.raw, "Tight", {"caption_font_size": 60})
        self.assertEqual(views.settings(self.raw, self.config)["drafts"], lab.list_drafts(self.config, self.raw))
        self.assertEqual(views.settings(self.raw, self.config)["drafts"][0]["changes"],
                         [{"key": "caption_font_size", "from": 84, "to": 60}])

    def test_the_lab_names_the_provider_a_new_background_would_use_and_whether_it_costs_money(self):
        view = views.lab_view(self.config, self.raw, python=Path("/venv/bin/python"), python_found=True)
        self.assertEqual(view["provider"], {"name": "openrouter", "model": "google/gemini-3.1-flash-image", "paid": True})
        self.assertEqual(view["limits"], {"minSeconds": 15.0, "maxSeconds": 180.0})
        self.assertEqual(view["python"], {"path": "/venv/bin/python", "found": True})
        self.assertEqual([e["stem"] for e in view["episodes"]], ["20260105"])

    def test_a_run_is_shown_with_its_clip_once_rendered_beside_the_real_clip(self):
        run = lab.create_run(self.config, self.raw, stem="20260105", clip="pick-2")
        shown = views.lab_run(self.config, run)
        self.assertEqual((shown["clipUrl"], shown["realClipUrl"]), (None, "/media/output/clips/20260105/02-bit-5.mp4"))
        dashboard_fixture.write(lab.lab_dir(self.config) / run["id"] / run["clipFile"], data=b"v")
        self.assertEqual(views.lab_run(self.config, run)["clipUrl"],
                         f"/media/output/lab/{run['id']}/clips/20260105/01-bit-5.mp4")
        (self.root / "output/clips/20260105/02-bit-5.mp4").unlink()
        self.assertIsNone(views.lab_run(self.config, run)["realClipUrl"])
        view = views.lab_view(self.config, self.raw, active=run["id"])
        self.assertEqual([(r["id"], r["status"]) for r in view["runs"]], [(run["id"], "ready")])
        self.assertEqual(views.lab_view(self.config, self.raw)["runs"][0]["status"], "interrupted")


class HeaderTests(ViewsTestCase):
    def test_header_names_the_data_directory_and_leaves_convex_unchecked(self):
        self.assertEqual(views.header(self.config), {"dataDir": str(self.root), "convex": "not checked"})


class ReadOnlyTests(ViewsTestCase):
    def test_no_view_writes_to_the_data_directory(self):
        (self.root / "output/cowork/state.json").unlink()  # the first read seeds state in memory
        before = snapshot(self.root)
        views.header(self.config)
        views.today(self.config)
        views.episodes(self.config)
        for stem in stage_status.known_stems(self.config):
            self.assertIsNotNone(views.episode(self.config, stem))
        views.settings({"settings": dict(self.config["settings"])})
        views.shirts(self.config)
        views.shirt_phrases(self.config, "catchphrases")
        views.clips(self.config)
        self.assertEqual(snapshot(self.root), before)
        self.assertGreater(len(before), 30)


if __name__ == "__main__":
    unittest.main()
