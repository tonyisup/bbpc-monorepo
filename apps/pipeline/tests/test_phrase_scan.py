import json
import os
import tempfile
import unittest
from pathlib import Path

from lib import phrase_scan

DROP = "for your poor sensitive ass you have been warned so buckle up"


def _episode(stem, *lines):
    """A common line plus `lines`, each fenced by a token unique to the episode,
    so a phrase only recurs where a test puts it."""
    texts = []
    for line in ("the first time I saw it",) + lines:
        texts += [f"x{stem}", line]
    texts.append(f"x{stem}")
    return [{"start": 5.0 * i, "end": 5.0 * i + 5.0, "text": " " + text} for i, text in enumerate(texts)]


class ScanTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.options = phrase_scan.ScanOptions(min_episodes=3, burst_window=4, burst_min=3)

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, stem, *lines, name=None):
        (self.dir / (name or f"{stem}.json")).write_text(json.dumps(_episode(stem, *lines)))

    def corpus(self, extra=None):
        """Twelve weekly episodes; `extra` maps an episode number to added lines."""
        extra = extra or {}
        for i in range(12):
            self.write(f"2011{i + 1:02d}01", *extra.get(i, []))

    def scan(self):
        return phrase_scan.scan(self.dir, self.options)

    def phrases(self, result):
        return {p["phrase"]: p for p in result["phrases"]}


class CatchphraseTests(ScanTestCase):
    def test_finds_a_phrase_repeated_across_episodes_with_examples(self):
        self.corpus({2: ["all aboard the pain train tonight"], 5: ["that is the pain train"],
                     9: ["Pain train, baby."]})
        phrase = self.phrases(self.scan())["pain train"]
        self.assertEqual(phrase["episodes"], 3)
        self.assertEqual((phrase["firstStem"], phrase["lastStem"]), ("20110301", "20111001"))
        self.assertEqual(phrase["examples"][0], {"stem": "20110301", "start": 15.0,
                                                  "text": "all aboard the pain train tonight"})

    def test_phrase_made_of_words_found_everywhere_is_a_staple_not_a_catchphrase(self):
        # "the first time I saw it" is in every episode. The scan can't tell ordinary
        # English from a show staple, so it lists it separately for a one-time review.
        self.corpus()
        result = self.scan()
        listed = self.phrases(result)
        self.assertEqual(listed["first time i saw it"]["reasons"], ["staple"])
        catchphrases = phrase_scan.render_markdown(result).split("## Running gags")[0]
        self.assertNotIn("first time i saw it", catchphrases)

    def test_trimming_a_leading_article_keeps_the_shorter_phrase(self):
        self.corpus({i: ["the pain train keeps rolling"] for i in (1, 5, 9)})
        listed = self.phrases(self.scan())
        self.assertIn("pain train keeps rolling", listed)
        self.assertNotIn("the pain train keeps rolling", listed)

    def test_phrases_with_numbers_are_skipped(self):
        self.corpus({i: ["call 442 444 0742 tonight", "rated pg 13 gore"] for i in (1, 5, 9)})
        listed = self.phrases(self.scan())
        self.assertFalse([p for p in listed if any(ch.isdigit() for ch in p)])

    def test_only_the_longest_form_of_a_phrase_is_listed(self):
        self.corpus({i: ["I'd buy that for a dollar"] for i in (1, 4, 7, 10)})
        listed = self.phrases(self.scan())
        self.assertIn("i'd buy that for a dollar", listed)
        self.assertNotIn("buy that for a dollar", listed)
        self.assertNotIn("i'd buy that", listed)

    def test_running_gag_is_marked_as_a_burst(self):
        self.corpus({i: ["is this your homework larry"] for i in (3, 4, 5)})
        phrase = self.phrases(self.scan())["is this your homework larry"]
        self.assertEqual(phrase["burst"]["count"], 3)
        self.assertEqual((phrase["burst"]["fromStem"], phrase["burst"]["toStem"]), ("20110401", "20110601"))
        self.assertIn("burst", phrase["reasons"])

    def test_title_cased_phrases_are_flagged_as_likely_titles(self):
        self.corpus({i: ["Lord of the Rings Extended"] for i in (1, 5, 9)})
        phrase = self.phrases(self.scan())["lord of the rings extended"]
        self.assertTrue(phrase["looksLikeTitle"])

    def test_ignore_list_removes_phrases(self):
        self.corpus({i: ["all aboard the pain train"] for i in (1, 5, 9)})
        (self.dir / "ignore.txt").write_text("# reviewed\nPain Train\n")
        self.options.ignore_file = self.dir / "ignore.txt"
        self.assertNotIn("pain train", self.phrases(self.scan()))


PREFIX = "for your poor sensitive ass you have been warned"


class PassageTests(ScanTestCase):
    def test_recurring_passage_is_one_drop_not_many_fragments(self):
        self.corpus({i: [DROP] for i in (0, 3, 6, 9)})
        result = self.scan()
        (passage,) = result["passages"]
        self.assertEqual(passage["text"], DROP)
        self.assertEqual(passage["episodes"], 4)
        self.assertFalse(any("sensitive ass" in p["phrase"] for p in result["phrases"]))


class PassageAttributionTests(ScanTestCase):
    def test_shared_opening_with_different_endings_is_reported_as_the_shared_text(self):
        # Two versions of a drop: the ending of one must not be credited to all six episodes.
        self.corpus({**{i: [PREFIX + " so buckle up buttercup"] for i in (0, 2, 4)},
                     **{i: [PREFIX + " now hold on very tight"] for i in (6, 8, 10)}})
        passages = self.scan()["passages"]
        shared = [p for p in passages if p["episodes"] == 6]
        self.assertEqual([p["text"] for p in shared], [PREFIX])
        for p in passages:
            if "buckle" in p["text"] or "tight" in p["text"]:
                self.assertLessEqual(p["episodes"], 3)

    def test_ignored_passage_is_omitted(self):
        self.corpus({i: [DROP] for i in (0, 3, 6, 9)})
        (self.dir / "ignore.txt").write_text(DROP.upper() + "\n", encoding="utf-8")
        self.options.ignore_file = self.dir / "ignore.txt"
        self.assertEqual(self.scan()["passages"], [])


class FillerPassageTests(ScanTestCase):
    def test_filler_passage_without_content_words_is_skipped(self):
        self.corpus({i: ["you know what i mean yeah yeah you know what i mean"] for i in (0, 3, 6, 9)})
        self.assertEqual(self.scan()["passages"], [])


class InputAndRerunTests(ScanTestCase):
    def test_only_dated_transcripts_are_scanned(self):
        self.corpus()
        self.write("20110101", "x", name="20110101.parakeet.json")
        self.write("test", "x", name="test_large-v3.json")
        self.assertEqual(self.scan()["transcripts"], 12)

    def test_rerun_reports_new_and_grown_phrases(self):
        self.corpus({i: ["all aboard the pain train"] for i in (1, 5, 9)})
        first = self.scan()
        self.write("20120101", "all aboard the pain train", "never trust a big booty")
        for stem in ("20120201", "20120301"):
            self.write(stem, "never trust a big booty")
        changes = phrase_scan.compare(first, self.scan())
        self.assertIn("never trust a big booty", changes["new"])
        self.assertEqual(changes["grown"]["all aboard the pain train"], [3, 4])
        self.assertNotIn("pain train", changes["grown"])  # covered by the longer phrase

    def test_write_outputs_keeps_json_and_markdown_and_reads_previous_run(self):
        self.corpus({i: ["all aboard the pain train"] for i in (1, 5, 9)})
        out = self.dir / "out"
        phrase_scan.write_outputs(out, self.scan())
        self.write("20120101", "all aboard the pain train")
        changes = phrase_scan.write_outputs(out, self.scan())
        self.assertEqual(changes["grown"]["all aboard the pain train"], [3, 4])
        saved = json.loads((out / "recurring-phrases.json").read_text(encoding="utf-8"))
        self.assertEqual(saved["transcripts"], 13)
        self.assertIn("all aboard the pain train", (out / "recurring-phrases.md").read_text(encoding="utf-8"))

    def test_report_status_before_any_scan(self):
        self.assertEqual(phrase_scan.report_status(self.dir / "out"), {
            "scanned": False, "scannedAt": None, "transcripts": 0, "firstStem": None, "lastStem": None,
            "phrases": 0, "passages": 0, "reportSavedAt": None, "ignoreSavedAt": None, "stale": False,
        })

    def test_report_status_counts_the_report_and_goes_stale_when_ignore_txt_is_newer(self):
        self.corpus({i: ["all aboard the pain train"] for i in (1, 5, 9)})
        out = self.dir / "out"
        result = self.scan()
        phrase_scan.write_outputs(out, result)
        report, ignore = out / "recurring-phrases.json", out / "ignore.txt"
        os.utime(report, (1_800_000_000, 1_800_000_000))
        status = phrase_scan.report_status(out)
        self.assertEqual(status, {
            "scanned": True, "scannedAt": result["scannedAt"], "transcripts": 12,
            "firstStem": "20110101", "lastStem": "20111201",
            "phrases": len(result["phrases"]), "passages": len(result["passages"]),
            "reportSavedAt": "2027-01-15T08:00:00+00:00", "ignoreSavedAt": None, "stale": False,
        })
        self.assertGreater(status["phrases"], 0)

        ignore.write_text("pain train\n", encoding="utf-8")
        os.utime(ignore, (1_800_000_000 - 60, 1_800_000_000 - 60))
        status = phrase_scan.report_status(out)
        self.assertEqual((status["ignoreSavedAt"], status["stale"]), ("2027-01-15T07:59:00+00:00", False))
        os.utime(ignore, (1_800_000_000 + 60, 1_800_000_000 + 60))
        status = phrase_scan.report_status(out)
        self.assertEqual((status["ignoreSavedAt"], status["stale"]), ("2027-01-15T08:01:00+00:00", True))


if __name__ == "__main__":
    unittest.main()
