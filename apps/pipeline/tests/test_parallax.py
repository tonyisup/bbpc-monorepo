"""Parallax backgrounds: caching, the Blender command, and failing without breaking the clip stage."""
import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image

from lib import parallax

SIZE = dict(width=1080, height=1920, fps=30)


class ParallaxTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.dir = Path(temp.name)
        self.still = self.dir / "01-bit_vertical.png"
        Image.new("RGB", (108, 192), (20, 40, 60)).save(self.still)
        self.blender = self.dir / "Blender"
        self.blender.write_text("#!/bin/sh\necho 'Blender 5.0.1'\n")
        self.blender.chmod(0o755)
        self.settings = {"blender_path": str(self.blender)}

    def test_options_come_from_the_settings_and_reach_the_scene(self):
        opts = parallax.options({"parallax_loop_seconds": 6, "parallax_dust": 0})
        self.assertEqual(opts, parallax.LoopOptions(seconds=6.0, drift=0.13, dust=0, haze=0.015))
        self.assertEqual(opts.scene_args(), ["--seconds", "6.0", "--drift", "0.13", "--dust", "0", "--haze", "0.015"])

    def test_a_loop_is_cached_per_still_options_and_size(self):
        opts = parallax.options({})
        path = parallax.loop_path(self.still, opts, (1080, 1920, 30))
        self.assertEqual(path.parent, self.still.parent)
        self.assertTrue(path.name.startswith("01-bit_vertical_parallax-") and path.suffix == ".mp4")
        self.assertEqual(path, parallax.loop_path(self.still, parallax.options({}), (1080, 1920, 30)))
        self.assertNotEqual(path, parallax.loop_path(self.still, parallax.options({"parallax_haze": 0}), (1080, 1920, 30)))
        self.assertNotEqual(path, parallax.loop_path(self.still, opts, (720, 1280, 30)))

    def fake_blender(self, cmd, **kw):
        out = Path(cmd[cmd.index("--out") + 1])
        out.write_bytes(b"mp4")
        return subprocess.CompletedProcess(cmd, 0, "", "")

    def test_renders_with_blender_and_keeps_the_loop_beside_the_still(self):
        with mock.patch.object(parallax, "estimate_depth") as depth, \
                mock.patch.object(parallax.subprocess, "run", side_effect=self.fake_blender) as run:
            loop = parallax.render_loop(self.still, self.settings, **SIZE)
        self.assertEqual(loop, parallax.loop_path(self.still, parallax.options({}), (1080, 1920, 30)))
        self.assertEqual(loop.read_bytes(), b"mp4")
        self.assertEqual(depth.call_args.args[0], self.still)
        cmd = run.call_args.args[0]
        self.assertEqual(cmd[:7], [str(self.blender), "-b", "--factory-startup", "--python-exit-code", "1",
                                   "-P", str(parallax.SCENE_SCRIPT)])
        self.assertEqual(cmd[cmd.index("--image") + 1], str(self.still.resolve()))
        self.assertEqual(cmd[cmd.index("--width") + 1:cmd.index("--width") + 6], ["1080", "--height", "1920", "--fps", "30"])
        self.assertIn("--drift", cmd)
        self.assertEqual([p.name for p in self.dir.iterdir() if p.name.startswith(".parallax-")], [],
                         "the working folder is removed")

    def test_a_loop_newer_than_its_still_is_reused_and_an_older_one_rerendered(self):
        loop = parallax.loop_path(self.still, parallax.options({}), (1080, 1920, 30))
        loop.write_bytes(b"old")
        with mock.patch.object(parallax, "estimate_depth"), \
                mock.patch.object(parallax.subprocess, "run", side_effect=AssertionError("no render")):
            self.assertEqual(parallax.render_loop(self.still, self.settings, **SIZE), loop)
        past = time.time() - 60
        os.utime(loop, (past, past))
        with mock.patch.object(parallax, "estimate_depth"), \
                mock.patch.object(parallax.subprocess, "run", side_effect=self.fake_blender):
            parallax.render_loop(self.still, self.settings, **SIZE)
        self.assertEqual(loop.read_bytes(), b"mp4")

    def test_each_failure_gives_none_and_leaves_no_loop(self):
        missing = {"blender_path": str(self.dir / "nowhere")}
        failed = subprocess.CalledProcessError(1, "blender", output="Fra:1\nTraceback\nValueError: bad", stderr="")
        cases = {
            "no blender": (missing, {}, {}),
            "depth fails": (self.settings, {"side_effect": RuntimeError("no transformers")}, {}),
            "blender fails": (self.settings, {}, {"side_effect": failed}),
            "blender times out": (self.settings, {}, {"side_effect": subprocess.TimeoutExpired("blender", 1)}),
            "blender writes nothing": (self.settings, {}, {"return_value": subprocess.CompletedProcess([], 0)}),
        }
        for name, (settings, depth_kw, run_kw) in cases.items():
            with self.subTest(name), \
                    mock.patch.object(parallax, "estimate_depth", **depth_kw), \
                    mock.patch.object(parallax.subprocess, "run", **run_kw), \
                    self.assertLogs("lib.parallax", "ERROR"):
                self.assertIsNone(parallax.render_loop(self.still, settings, **SIZE))
            self.assertEqual(list(self.dir.glob("*_parallax-*.mp4")), [])

    def test_setup_names_the_blender_or_says_what_is_missing(self):
        with mock.patch.object(parallax.importlib.util, "find_spec", return_value=object()):
            self.assertEqual(parallax.setup(self.settings), (True, f"Blender 5.0.1 at {self.blender}"))
        with mock.patch.object(parallax.importlib.util, "find_spec", side_effect=lambda n: None if n == "transformers" else object()):
            ok, detail = parallax.setup(self.settings)
        self.assertFalse(ok)
        self.assertIn("lacks transformers", detail)
        ok, detail = parallax.setup({"blender_path": str(self.dir / "nowhere")})
        self.assertFalse(ok)
        self.assertIn("set blender_path", detail)

    def test_the_scene_script_ships_with_the_pipeline(self):
        self.assertTrue(parallax.SCENE_SCRIPT.is_file())


if __name__ == "__main__":
    unittest.main()
