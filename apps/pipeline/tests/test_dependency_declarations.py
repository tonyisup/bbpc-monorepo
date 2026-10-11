import unittest
from pathlib import Path


def _declared_requirements():
    requirements = Path(__file__).resolve().parents[1] / "requirements.txt"
    return {
        line.strip().split("#", 1)[0].split(";", 1)[0].split(">=", 1)[0].split("==", 1)[0].strip().lower()
        for line in requirements.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }


class DependencyDeclarationTests(unittest.TestCase):
    def test_laughter_detector_dependency_is_declared(self):
        self.assertIn("librosa", _declared_requirements())

    def test_packages_nothing_imports_are_not_declared(self):
        # Removed with the LLM fallback and the diarize placeholder.
        unused = {"moviepy", "pydub", "pyannote.audio", "google-genai"}
        self.assertEqual(unused & _declared_requirements(), set())


if __name__ == "__main__":
    unittest.main()
