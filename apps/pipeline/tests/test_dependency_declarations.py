import unittest
from pathlib import Path


class DependencyDeclarationTests(unittest.TestCase):
    def test_laughter_detector_dependency_is_declared(self):
        requirements = Path(__file__).resolve().parents[1] / "requirements.txt"
        declared = {
            line.strip().split("#", 1)[0].split(">=", 1)[0].split("==", 1)[0].strip().lower()
            for line in requirements.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        }

        self.assertIn("librosa", declared)


if __name__ == "__main__":
    unittest.main()
