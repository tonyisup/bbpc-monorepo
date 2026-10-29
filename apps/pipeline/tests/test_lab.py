import datetime
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import dashboard_fixture
from dashboard_fixture import snapshot
from lib import data_dir, lab, settings_schema

ROOT = Path(__file__).resolve().parents[1]
STEM = "20260105"
NOW = datetime.datetime(2026, 1, 20, 12, 30, 5, tzinfo=datetime.timezone.utc)


class LabTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name).resolve()
        self.config = dashboard_fixture.build(self.root)
        # config.json as written: relative paths, and one setting that differs from its default.
        self.raw = {
            "paths": {"episodes_dir": "./episodes", "output_dir": "./output", "transcripts_dir": "./transcripts",
                      "movie_extractions_dir": "./output/movies", "seo_dir": "./output/seo"},
            "settings": {"cowork_outputs_dir": "./output/cowork", "visuals_provider": "openrouter",
                         "caption_max_lines": 2, "cowork_headless": True},
        }
        self.config["settings"].update(visuals_provider="openrouter", caption_max_lines=2, cowork_headless=True)
        self.config_path = self.root / "config.json"
        self.config_path.write_text(lab.config_text(self.raw) or "{}", encoding="utf-8")
        patcher = mock.patch.dict(os.environ, {data_dir.ENV_VAR: str(self.root)})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.lab = self.root / "output" / "lab"

    def draft(self, title="Tight captions", **overrides):
        return lab.save_draft(self.config, self.raw, title, overrides or {"caption_font_size": 60})

    def run_for(self, **request):
        request.setdefault("stem", STEM)
        request.setdefault("clip", "pick-2")
        return lab.create_run(self.config, self.raw, now=NOW, **request)

    def refused(self, **request):
        with self.assertRaises(lab.LabError) as caught:
            self.run_for(**request)
        return caught.exception

    def outside_lab(self):
        """Everything but the Lab's folder (and ``output`` itself, whose listing gains ``lab``)."""
        return [row for row in snapshot(self.root) if row[0] != "output" and not row[0].startswith("output/lab")]


class DraftTests(LabTestCase):
    def test_a_draft_is_a_file_of_overrides_under_output_lab_drafts(self):
        saved = self.draft(caption_font_size=60, clip_zoom_amount=0.3)
        self.assertEqual({k: saved.get(k) for k in ("name", "title", "overrides")}, {
            "name": "tight-captions", "title": "Tight captions",
            "overrides": {"caption_font_size": 60, "clip_zoom_amount": 0.3},
        })
        on_disk = json.loads((self.lab / "drafts" / "tight-captions.json").read_text())
        self.assertEqual(on_disk["overrides"], {"caption_font_size": 60, "clip_zoom_amount": 0.3})
        self.assertEqual(lab.load_draft(self.config, "tight-captions"), on_disk)
        self.assertEqual(sorted(p.name for p in (self.lab / "drafts").iterdir()), ["tight-captions.json"])

    def test_an_override_equal_to_the_current_value_is_not_a_change(self):
        saved = self.draft(caption_font_size=84, caption_max_lines=2, visuals_provider="local", clip_zoom_amount=0.12)
        self.assertEqual(saved["overrides"], {"visuals_provider": "local"})
        self.assertEqual(lab.changes(self.raw["settings"], {"visuals_provider": "local", "caption_font_size": 60}), [
            {"key": "caption_font_size", "from": 84, "to": 60},
            {"key": "visuals_provider", "from": "openrouter", "to": "local"},
        ])

    def test_every_value_is_checked_against_the_schema_before_anything_is_written(self):
        cases = [
            ({"caption_font_size": 500}, "caption_font_size must be between 20 and 240, not 500"),
            ({"caption_color": "yellow"}, "caption_color must be a colour like #FFFF00, not 'yellow'"),
            ({"caption_font_sise": 60}, "caption_font_sise is not a known setting"),
            ({"local_visual_python": "/bin/sh"}, "local_visual_python cannot be changed in a draft"),
            ({"cowork_headless_command": "/bin/sh"}, "cowork_headless_command cannot be changed in a draft"),
            ({"local_visual_reuse_cached_still": True}, "local_visual_reuse_cached_still cannot be changed in a draft"),
            ({"review_clip_max_seconds": 240}, "review_clip_max_seconds cannot be changed in a draft"),
        ]
        for overrides, problem in cases:
            with self.subTest(overrides=overrides):
                with self.assertRaises(lab.LabError) as caught:
                    lab.save_draft(self.config, self.raw, "Bad", dict(overrides, caption_max_chars=20))
                self.assertEqual(caught.exception.problems, [problem])
        self.assertEqual(lab.check_overrides(["caption_font_size"]), ["overrides must be an object of setting: value"])
        self.assertFalse((self.lab / "drafts" / "bad.json").exists())

    def test_draft_names_come_from_the_title_and_never_leave_the_drafts_folder(self):
        self.assertEqual(self.draft("  Bigger & BOLDER captions!  ")["name"], "bigger-bolder-captions")
        for title in ("", "   ", "!!!", "../../etc"):
            with self.subTest(title=title):
                if title == "../../etc":
                    self.assertEqual(self.draft(title)["name"], "etc")
                    continue
                with self.assertRaises(lab.LabError):
                    self.draft(title)
        (self.root / "output" / "outside.json").write_text('{"overrides": {}}')
        for name in ("../outside", "..", "", "Tight Captions", "a/b", ".hidden"):
            with self.subTest(name=name):
                self.assertIsNone(lab.load_draft(self.config, name))
                self.assertFalse(lab.delete_draft(self.config, name))
        self.assertTrue((self.root / "output" / "outside.json").exists())

    def test_saving_under_an_existing_name_replaces_it_and_listing_shows_the_changes(self):
        self.draft()
        self.draft("Zoomier", clip_zoom_amount=0.3)
        updated = lab.save_draft(self.config, self.raw, "Tight captions v2", {"caption_font_size": 72},
                                 name="tight-captions")
        self.assertEqual((updated["name"], updated["title"]), ("tight-captions", "Tight captions v2"))
        listed = lab.list_drafts(self.config, self.raw)
        self.assertEqual([(d["name"], d["title"], d["changes"], d["problems"]) for d in listed], [
            ("tight-captions", "Tight captions v2", [{"key": "caption_font_size", "from": 84, "to": 72}], []),
            ("zoomier", "Zoomier", [{"key": "clip_zoom_amount", "from": 0.12, "to": 0.3}], []),
        ])
        with self.assertRaises(lab.LabError):
            lab.save_draft(self.config, self.raw, "x", {}, name="no-such-draft")
        self.assertTrue(lab.delete_draft(self.config, "zoomier"))
        self.assertEqual([d["name"] for d in lab.list_drafts(self.config, self.raw)], ["tight-captions"])

    def test_a_draft_edited_by_hand_into_something_invalid_is_listed_with_its_problems(self):
        self.draft()
        path = self.lab / "drafts" / "tight-captions.json"
        path.write_text(json.dumps({"name": "tight-captions", "title": "T", "overrides": {"caption_font_size": 9}}))
        (self.lab / "drafts" / "broken.json").write_text("{not json")
        listed = lab.list_drafts(self.config, self.raw)
        self.assertEqual([(d["name"], d["problems"]) for d in listed], [
            ("tight-captions", ["caption_font_size must be between 20 and 240, not 9"]),
        ])


class ApplyTests(LabTestCase):
    def test_config_text_reproduces_the_checked_in_config_json_byte_for_byte(self):
        text = (ROOT / "config.json").read_text(encoding="utf-8")
        self.assertEqual(lab.config_text(json.loads(text)), text)

    def test_apply_writes_the_overrides_into_config_json_and_returns_the_diff(self):
        self.draft(caption_font_size=60, visuals_provider="local")
        before = snapshot(self.root / "output" / "cowork")
        result = lab.apply_draft(self.config_path, self.config, "tight-captions")
        self.assertEqual(result["changes"], [
            {"key": "caption_font_size", "from": 84, "to": 60},
            {"key": "visuals_provider", "from": "openrouter", "to": "local"},
        ])
        written = json.loads(self.config_path.read_text())
        self.assertEqual(written["settings"], dict(self.raw["settings"], visuals_provider="local", caption_font_size=60))
        self.assertEqual(written["paths"], self.raw["paths"])
        self.assertEqual(self.config_path.read_text(), lab.config_text(written))
        self.assertIn('-    "visuals_provider": "openrouter",', result["diff"])
        self.assertIn('+    "visuals_provider": "local",', result["diff"])
        self.assertIn('+    "caption_font_size": 60', result["diff"])
        # Applied means done: the draft is gone, and nothing else in the folder was touched.
        self.assertIsNone(lab.load_draft(self.config, "tight-captions"))
        self.assertEqual(sorted(p.name for p in self.root.iterdir() if p.name.startswith(("config", ".config"))),
                         ["config.json"])
        self.assertEqual(snapshot(self.root / "output" / "cowork"), before)

    def test_apply_refuses_a_missing_or_invalid_draft_and_leaves_config_json_alone(self):
        before = self.config_path.read_text()
        with self.assertRaises(lab.LabError):
            lab.apply_draft(self.config_path, self.config, "no-such-draft")
        self.draft()
        (self.lab / "drafts" / "tight-captions.json").write_text(json.dumps(
            {"name": "tight-captions", "title": "T", "overrides": {"cowork_headless_command": "/bin/sh"}}))
        with self.assertRaises(lab.LabError) as caught:
            lab.apply_draft(self.config_path, self.config, "tight-captions")
        self.assertEqual(caught.exception.problems, ["cowork_headless_command cannot be changed in a draft"])
        self.assertEqual(self.config_path.read_text(), before)


class ClipChoiceTests(LabTestCase):
    def test_the_lab_offers_only_episodes_with_a_local_mp3_and_clips_to_render(self):
        # 20260112 has clips but no mp3; 20260119 has an mp3 but no SEO file yet.
        self.assertEqual(lab.lab_episodes(self.config), [STEM])

    def test_clip_choices_are_the_rendered_picks_then_the_other_candidates(self):
        choices = lab.clip_choices(self.config, STEM)
        self.assertEqual([c["id"] for c in choices[:4]], ["pick-1", "pick-2", "pick-3", "candidate-1"])
        self.assertEqual(len(choices), 20)
        clips = self.root / "output" / "clips" / STEM
        stills = self.root / "output" / "visuals" / STEM
        self.assertEqual({k: choices[1][k] for k in ("id", "source", "index", "headline", "start", "end", "realClip", "still")}, {
            "id": "pick-2", "source": "pick", "index": 2, "headline": "Bit 5", "start": 50.0, "end": 80.0,
            "realClip": clips / "02-bit-5.mp4", "still": stills / "02-bit-5.png",
        })
        self.assertEqual({k: choices[3][k] for k in ("source", "index", "headline", "realClip", "still")},
                         {"source": "candidate", "index": 1, "headline": "Bit 2", "realClip": None, "still": None})
        (stills / "03-bit-10.png").unlink()
        (clips / "03-bit-10.mp4").unlink()
        gone = lab.clip_choices(self.config, STEM)[2]
        self.assertEqual((gone["realClip"], gone["still"]), (None, None))


class CreateRunTests(LabTestCase):
    def test_a_free_run_is_a_folder_holding_a_run_config_a_one_clip_seo_file_and_the_real_still(self):
        self.draft(caption_font_size=60, clip_zoom_amount=0.3)
        before = self.outside_lab()
        run = self.run_for(draft="tight-captions")
        self.assertEqual(run["id"], "20260120-123005-20260105-pick-2")
        folder = self.lab / run["id"]
        self.assertEqual({k: run[k] for k in ("stem", "stage", "status", "paid", "newBackground", "overrides", "draft", "edits")}, {
            "stem": STEM, "stage": "clip", "status": "ready", "paid": False, "newBackground": False,
            "overrides": {"caption_font_size": 60, "clip_zoom_amount": 0.3},
            "draft": {"name": "tight-captions", "title": "Tight captions"}, "edits": {},
        })
        self.assertEqual(run["clipFile"], f"clips/{STEM}/01-bit-5.mp4")
        self.assertEqual(lab.load_run(self.config, run["id"]), run)
        self.assertEqual(lab.run_dir(self.config, run["id"]), folder)

        config = json.loads((folder / "config.json").read_text())
        self.assertEqual(config["paths"], {
            "episodes_dir": str(self.root / "episodes"), "transcripts_dir": str(self.root / "transcripts"),
            "output_dir": str(folder), "seo_dir": str(folder / "seo"), "movie_extractions_dir": str(folder / "movies"),
        })
        self.assertEqual(config["settings"], dict(
            self.raw["settings"], caption_font_size=60, clip_zoom_amount=0.3,
            local_visual_reuse_cached_still=True, cowork_headless=False, cowork_outputs_dir=str(folder / "cowork"),
        ))
        seo = json.loads((folder / "seo" / f"{STEM}.seo.json").read_text())
        self.assertEqual(seo["clipAnalysis"], [dashboard_fixture.clip(5)])
        self.assertEqual((folder / "visuals" / STEM / "01-bit-5.png").read_bytes(), b"\x89PNG still 5")
        self.assertEqual(sorted(p.name for p in (folder / "visuals" / STEM).iterdir()), ["01-bit-5.png"])
        # The real episode is untouched: its SEO file, its clip, its still, state.json.
        self.assertEqual(self.outside_lab(), before)

    def test_the_command_is_the_pipelines_clip_stage_on_an_explicit_episode(self):
        run = self.run_for()
        python = Path("/somewhere/venv/bin/python")
        self.assertEqual(lab.run_command(self.config, run, python), [
            str(python), "pipeline.py", str(self.root / "episodes" / f"{STEM}.mp3"),
            "--config", str(self.lab / run["id"] / "config.json"), "--only", "clip",
        ])

    def test_a_free_run_cannot_reach_a_paid_image_model(self):
        environ = {"PATH": "/bin", "OPENROUTER_API_KEY": "sk-or", "OPENAI_API_KEY": "sk-oa", "CONVEX_URL": "https://x"}
        free = lab.run_env(self.run_for(), environ)
        self.assertEqual(free, {"PATH": "/bin", "OPENROUTER_API_KEY": "", "OPENAI_API_KEY": "", "CONVEX_URL": "https://x"})
        paid = lab.run_env(self.run_for(clip="pick-1", new_background=True, confirm_paid=True), environ)
        self.assertEqual(paid, environ)

    def test_import_and_publish_are_never_run_from_the_lab_and_other_stages_are_not_in_it_yet(self):
        for stage in ("import_transcript", "publish"):
            with self.subTest(stage=stage):
                self.assertEqual(str(self.refused(stage=stage)),
                                 f"{stage} writes to Convex and is never run from the Lab")
        for stage in ("transcribe", "movies", "review_clip", "parse", "thumbnail", "everything", "", None):
            with self.subTest(stage=stage):
                self.assertEqual(str(self.refused(stage=stage)), f"{stage} is not a stage the Lab runs")
        self.assertFalse(self.lab.exists())

    def test_it_refuses_an_episode_or_clip_the_lab_does_not_offer(self):
        self.assertEqual(str(self.refused(stem="20260112")), "20260112 is not an episode the Lab can render")
        self.assertEqual(str(self.refused(stem="../20260105")), "../20260105 is not an episode the Lab can render")
        self.assertEqual(str(self.refused(clip="pick-9")), "pick-9 is not a clip of 20260105")
        self.assertEqual(str(self.refused(draft="no-such-draft")), "there is no draft called no-such-draft")
        self.assertFalse(self.lab.exists())

    def test_a_clip_with_no_still_needs_a_new_background(self):
        error = self.refused(clip="candidate-1")
        self.assertEqual((error.code, str(error)), (
            "needs_background",
            "This clip has no still to reuse. Rendering it needs a new background, which is one image request.",
        ))

    def lab_background(self, clip="candidate-1", status=0, still=True, now=NOW, **request):
        """A Lab run that made a new background for ``clip``, finished as the pipeline would leave it."""
        run = lab.create_run(self.config, self.raw, stem=STEM, clip=clip, new_background=True, confirm_paid=True,
                             now=now, **request)
        folder = self.lab / run["id"]
        if still:
            dashboard_fixture.write(folder / run["clipFile"].replace("clips/", "visuals/", 1).replace(".mp4", ".png"),
                                    data=f"\x89PNG lab {run['id']}".encode())
        dashboard_fixture.write(folder / run["clipFile"], data=b"lab video")
        return lab.finish_run(self.config, run["id"], status)

    def test_a_background_made_in_the_lab_can_be_reused_for_the_same_clip(self):
        first = self.lab_background(edits={"imagePrompt": "A canoe among stars"})
        second = self.lab_background(now=NOW + datetime.timedelta(minutes=5))
        self.lab_background(now=NOW + datetime.timedelta(minutes=6), status=1)   # failed: not offered
        self.lab_background(now=NOW + datetime.timedelta(minutes=7), still=False)
        self.lab_background(clip="candidate-2", now=NOW + datetime.timedelta(minutes=8))
        candidate = next(c for c in lab.clip_choices(self.config, STEM) if c["id"] == "candidate-1")
        self.assertIsNone(candidate["still"])
        self.assertEqual(candidate["labStills"], [
            {"run": second["id"], "createdAt": second["createdAt"], "imagePrompt": "A cracked film reel in fog",
             "still": self.lab / second["id"] / "visuals" / STEM / "01-bit-2.png"},
            {"run": first["id"], "createdAt": first["createdAt"], "imagePrompt": "A canoe among stars",
             "still": self.lab / first["id"] / "visuals" / STEM / "01-bit-2.png"},
        ])

        before = self.outside_lab()
        later = NOW + datetime.timedelta(minutes=10)
        run = lab.create_run(self.config, self.raw, stem=STEM, clip="candidate-1", background=first["id"],
                             edits={"start": 15.0, "end": 45.0}, now=later)
        self.assertEqual({k: run[k] for k in ("paid", "newBackground", "background", "edits")}, {
            "paid": False, "newBackground": False, "background": first["id"], "edits": {"start": 15.0, "end": 45.0},
        })
        self.assertEqual(run["clip"]["imagePrompt"], "A canoe among stars")  # the prompt the background was made from
        folder = self.lab / run["id"]
        self.assertEqual((folder / "visuals" / STEM / "01-bit-2.png").read_bytes(),
                         f"\x89PNG lab {first['id']}".encode())
        self.assertIs(json.loads((folder / "config.json").read_text())["settings"]["local_visual_reuse_cached_still"], True)
        self.assertEqual(lab.run_env(run, {"OPENROUTER_API_KEY": "sk"}), {"OPENROUTER_API_KEY": "", "OPENAI_API_KEY": ""})
        self.assertEqual(self.outside_lab(), before)
        # A render that reused a background made none, so it is not offered as one.
        lab.finish_run(self.config, run["id"], 0)
        candidate = next(c for c in lab.clip_choices(self.config, STEM) if c["id"] == "candidate-1")
        self.assertEqual([row["run"] for row in candidate["labStills"]], [second["id"], first["id"]])

    def test_only_a_background_made_for_this_clip_can_be_reused(self):
        other = self.lab_background(clip="candidate-2")
        made = self.lab_background(now=NOW + datetime.timedelta(minutes=1))
        for background in (other["id"], "../clips", "nope", 7):
            with self.subTest(background=background):
                error = self.refused(clip="candidate-1", background=background)
                self.assertEqual(str(error), f"{background} is not a background made in the Lab for this clip")
        self.assertEqual(str(self.refused(clip="candidate-1", background=made["id"], new_background=True,
                                          confirm_paid=True)),
                         "a render either reuses a background or makes a new one, not both")
        # A pick with its real still can still try a background the Lab made for it.
        pick = self.lab_background(clip="pick-2", now=NOW + datetime.timedelta(minutes=2))
        run = lab.create_run(self.config, self.raw, stem=STEM, clip="pick-2", background=pick["id"],
                             now=NOW + datetime.timedelta(minutes=3))
        self.assertEqual((self.lab / run["id"] / "visuals" / STEM / "01-bit-5.png").read_bytes(),
                         f"\x89PNG lab {pick['id']}".encode())
        self.assertIsNone(self.run_for()["background"])  # the real still

    def test_a_new_background_from_a_paid_provider_must_be_confirmed(self):
        error = self.refused(new_background=True)
        self.assertEqual((error.code, str(error)), (
            "confirm_paid",
            "A new background is one paid image request to openrouter (google/gemini-3.1-flash-image).",
        ))
        self.assertFalse(self.lab.exists())
        run = self.run_for(new_background=True, confirm_paid=True)
        self.assertEqual((run["paid"], run["newBackground"], run["provider"]), (True, True, "openrouter"))
        folder = self.lab / run["id"]
        self.assertFalse((folder / "visuals").exists())  # nothing to reuse: the stage asks for a new image
        self.assertIs(json.loads((folder / "config.json").read_text())["settings"]["local_visual_reuse_cached_still"], False)

    def test_a_new_background_from_the_local_provider_is_free(self):
        self.draft("Local", visuals_provider="local")
        run = self.run_for(clip="candidate-1", draft="local", new_background=True)
        self.assertEqual((run["paid"], run["provider"]), (False, "local"))
        self.assertEqual(lab.run_env(run, {"OPENROUTER_API_KEY": "sk"}), {"OPENROUTER_API_KEY": "", "OPENAI_API_KEY": ""})

    def test_a_different_window_or_image_prompt_goes_into_the_runs_seo_file_only(self):
        run = self.run_for(edits={"start": 40.0, "end": 100.0})
        seo = json.loads((self.lab / run["id"] / "seo" / f"{STEM}.seo.json").read_text())
        self.assertEqual((seo["clipAnalysis"][0]["start"], seo["clipAnalysis"][0]["end"]), (40.0, 100.0))
        self.assertEqual(run["edits"], {"start": 40.0, "end": 100.0})
        prompted = self.run_for(clip="pick-1", new_background=True, confirm_paid=True,
                                edits={"imagePrompt": "A lighthouse made of film reels"})
        seo = json.loads((self.lab / prompted["id"] / "seo" / f"{STEM}.seo.json").read_text())
        self.assertEqual(seo["clipAnalysis"][0]["imagePrompt"], "A lighthouse made of film reels")
        real = json.loads((self.root / "output" / "seo" / f"{STEM}.seo.json").read_text())
        self.assertEqual(real, dashboard_fixture.seo())

    def test_edits_are_checked(self):
        cases = [
            ({"start": 50.0, "end": 60.0}, "the clip must be 20 to 180 seconds long, not 10"),
            ({"start": 0.0, "end": 200.0}, "the clip must be 20 to 180 seconds long, not 200"),
            ({"start": 580.0, "end": 640.0}, "the clip ends at 640s, after the transcript ends (600s)"),
            ({"start": -5.0, "end": 30.0}, "start and end must be seconds, with start before end"),
            ({"start": "soon", "end": 80.0}, "start and end must be seconds, with start before end"),
            ({"imagePrompt": "A lighthouse"}, "the image prompt only matters with a new background"),
            ({"headline": "New name"}, "only start, end and imagePrompt can be changed, not headline"),
        ]
        for edits, message in cases:
            with self.subTest(edits=edits):
                self.assertEqual(str(self.refused(edits=edits)), message)
        self.draft("Short ok", min_clip_duration_seconds=5)
        # Only what differs from the clip is recorded as an edit: the start here is the clip's own.
        self.assertEqual(self.run_for(draft="short-ok", edits={"start": 50.0, "end": 60.0})["edits"], {"end": 60.0})

    def test_two_runs_in_the_same_second_get_different_folders(self):
        first, second = self.run_for(), self.run_for()
        self.assertEqual((first["id"], second["id"]),
                         ("20260120-123005-20260105-pick-2", "20260120-123005-20260105-pick-2-2"))


class RunRecordTests(LabTestCase):
    def render(self, run, data=b"lab video"):
        return dashboard_fixture.write(self.lab / run["id"] / run["clipFile"], data=data)

    def test_a_run_is_done_only_when_the_pipeline_exits_zero_and_the_clip_is_there(self):
        run = self.run_for()
        self.assertEqual(lab.start_run(self.config, run["id"])["status"], "running")
        self.render(run)
        done = lab.finish_run(self.config, run["id"], 0)
        self.assertEqual((done["status"], done["returncode"], done["message"]), ("done", 0, None))
        self.assertEqual(lab.load_run(self.config, run["id"]), done)

        no_clip = self.run_for(clip="pick-1")
        failed = lab.finish_run(self.config, no_clip["id"], 0)
        self.assertEqual((failed["status"], failed["message"]),
                         ("failed", "the pipeline finished but wrote no clip; see the log"))
        crashed = self.run_for(clip="pick-3")
        self.render(crashed)
        self.assertEqual(lab.finish_run(self.config, crashed["id"], 2)["message"], "the pipeline exited with status 2")
        self.assertEqual(lab.finish_run(self.config, crashed["id"], -9, timed_out=True)["message"],
                         "stopped: the render ran past its time limit")

    def test_runs_are_listed_newest_first_and_one_nothing_is_running_is_marked_interrupted(self):
        later = NOW + datetime.timedelta(minutes=5)
        first = self.run_for()
        second = lab.create_run(self.config, self.raw, stem=STEM, clip="pick-1", now=later)
        lab.start_run(self.config, first["id"])
        lab.start_run(self.config, second["id"])
        listed = lab.list_runs(self.config, active=second["id"])
        self.assertEqual([(r["id"], r["status"]) for r in listed], [
            (second["id"], "running"), (first["id"], "interrupted"),
        ])
        self.assertEqual(lab.list_runs(self.config)[0]["status"], "interrupted")
        self.assertEqual(lab.load_run(self.config, first["id"])["status"], "running")  # the record itself is not rewritten

    def test_the_log_tail_is_the_end_of_run_log(self):
        run = self.run_for()
        self.assertEqual(lab.log_tail(self.config, run["id"]), "")
        (self.lab / run["id"] / "run.log").write_text("x" * 100 + "\nClip saved\n")
        self.assertEqual(lab.log_tail(self.config, run["id"], max_bytes=11), "Clip saved\n")

    def test_delete_removes_one_run_folder_and_nothing_else(self):
        self.draft()
        keep, gone = self.run_for(), self.run_for(clip="pick-1")
        before = self.outside_lab()
        self.assertTrue(lab.delete_run(self.config, gone["id"]))
        self.assertFalse((self.lab / gone["id"]).exists())
        self.assertTrue((self.lab / keep["id"] / "run.json").is_file())
        self.assertTrue((self.lab / "drafts" / "tight-captions.json").is_file())
        self.assertFalse(lab.delete_run(self.config, gone["id"]))
        self.assertEqual(self.outside_lab(), before)

    def test_delete_and_load_refuse_anything_that_is_not_a_run_folder_in_the_lab(self):
        self.draft()
        self.run_for()
        outside = self.root / "output" / "clips" / STEM
        stray = self.lab / "20260120-123005-20260105-pick-3"
        stray.mkdir()  # the right shape of name, but not a run: no run.json
        (self.lab / "20260120-123005-20260105-pick-1").symlink_to(outside)
        (outside / "run.json").write_text("{}")
        before = snapshot(self.root)
        for run_id in ("drafts", "..", ".", "", "../clips/20260105", f"../clips/{STEM}", "20260120-123005-20260105-pick-2/..",
                       stray.name, "20260120-123005-20260105-pick-1", "20260120-123005-20260105-pick-9", None, 7):
            with self.subTest(run_id=run_id):
                self.assertFalse(lab.delete_run(self.config, run_id))
                self.assertIsNone(lab.load_run(self.config, run_id))
                self.assertIsNone(lab.run_dir(self.config, run_id))
        self.assertEqual(snapshot(self.root), before)


class SandboxTests(LabTestCase):
    def test_everything_the_lab_writes_is_under_output_lab_apart_from_config_json_on_apply(self):
        before = self.outside_lab()
        self.draft()
        self.draft("Local", visuals_provider="local")
        run = self.run_for(draft="tight-captions")
        lab.start_run(self.config, run["id"])
        lab.finish_run(self.config, run["id"], 1)
        self.run_for(clip="candidate-3", draft="local", new_background=True, edits={"start": 100.0, "end": 160.0})
        lab.delete_draft(self.config, "local")
        lab.delete_run(self.config, run["id"])
        lab.list_runs(self.config)
        lab.list_drafts(self.config, self.raw)
        self.assertEqual(self.outside_lab(), before)
        self.assertEqual(lab.lab_dir(self.config), self.lab)
        lab.apply_draft(self.config_path, self.config, "tight-captions")
        changed = [a[0] for a, b in zip(self.outside_lab(), before) if a != b]
        self.assertEqual(changed, ["config.json"])

    def test_the_lab_has_no_stage_that_writes_to_convex(self):
        self.assertEqual(lab.LAB_STAGES, ("clip",))
        self.assertEqual(lab.NEVER_IN_LAB, ("import_transcript", "publish"))
        self.assertEqual(set(lab.LAB_STAGES) & set(lab.NEVER_IN_LAB), set())
        self.assertTrue(all(settings_schema.BY_KEY[key].draft is False
                            for key in ("local_visual_python", "local_visual_script", "cowork_headless_command")))


if __name__ == "__main__":
    unittest.main()
