import os
import subprocess
import unittest
from importlib import import_module, reload
from unittest import mock


class BackfillPipelineFailureTests(unittest.TestCase):
    def setUp(self):
        self._original_env = os.environ.copy()
        os.environ.setdefault("AZURE_STORAGE_CONNECTION_STRING", "UseDevelopmentStorage=true")
        os.environ.setdefault("CONVEX_URL", "https://example.convex.cloud")
        os.environ.setdefault("CONVEX_PIPELINE_TOKEN", "test-token")

        self.backfill = import_module("backfill")
        self.backfill = reload(self.backfill)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._original_env)

    def test_run_pipeline_for_episode_returns_false_on_subprocess_error(self):
        error = subprocess.CalledProcessError(
            1,
            ["python", "pipeline.py", "episodes/20150608.mp3"],
            output="stdout text",
            stderr="stderr text",
        )

        with mock.patch("backfill.subprocess.run", side_effect=error):
            result = self.backfill._run_pipeline_for_episode(
                "20150608.mp3",
                self.backfill.EPISODES_DIR / "20150608.mp3",
            )

        self.assertFalse(result)

    def test_convex_dates_and_episode_upsert_are_idempotent(self):
        client = mock.Mock()
        client.list_episode_dates.return_value = {"2015-06-08"}

        dates = self.backfill.get_db_episode_dates(client)

        self.assertEqual(dates, {"2015-06-08"})
        client.list_episode_dates.assert_called_once_with()

        episode_path = self.backfill.EPISODES_DIR / "20150615.mp3"
        with mock.patch(
            "backfill.read_episode_metadata_from_audio",
            return_value=(2, "Second Episode"),
        ) as read_metadata:
            self.backfill.insert_episode_from_audio_metadata(
                client,
                "20150615.mp3",
                episode_path,
                dates,
            )
            self.backfill.insert_episode_from_audio_metadata(
                client,
                "20150615.mp3",
                episode_path,
                dates,
            )

        read_metadata.assert_called_once_with(episode_path)
        client.upsert_episode_from_audio.assert_called_once_with(
            date="2015-06-15",
            number=2,
            title="Second Episode",
        )
        self.assertIn("2015-06-15", dates)

    def test_upsert_rejects_unbounded_attempt_count(self):
        with self.assertRaisesRegex(ValueError, "max_attempts must be positive"):
            self.backfill.upsert_episode_with_retry(
                "20150615.mp3",
                self.backfill.EPISODES_DIR / "20150615.mp3",
                set(),
                client=mock.Mock(),
                max_attempts=0,
            )


if __name__ == "__main__":
    unittest.main()
