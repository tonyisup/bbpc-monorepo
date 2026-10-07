import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class GenerateLocalVisualScriptTests(unittest.TestCase):
    def test_dry_run_writes_placeholder_png(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_path = Path(tmp_dir) / "visual.png"
            result = subprocess.run(
                [
                    sys.executable,
                    "scripts/generate_local_visual.py",
                    "--prompt",
                    "Neon movie theater with silhouetted hosts",
                    "--output",
                    str(output_path),
                    "--dry-run",
                ],
                check=False,
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            self.assertTrue(output_path.exists())
            self.assertGreater(output_path.stat().st_size, 0)


if __name__ == "__main__":
    unittest.main()
