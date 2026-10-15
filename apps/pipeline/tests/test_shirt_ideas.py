import fcntl
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

import dashboard_fixture
from dashboard_fixture import snapshot
from lib import data_dir, phrase_scan, shirt_ideas

ROOT = Path(__file__).resolve().parents[1]
T1, T2 = "2026-02-01T10:00:00+00:00", "2026-02-02T11:30:00+00:00"
DOLLAR = "a dollar. I'd buy that for a dollar"


class ShirtIdeasTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name).resolve()
        self.config = dashboard_fixture.build(self.root)
        self.path = self.root / "output" / "tshirt" / "ideas.json"
        self.at(T1)

    def at(self, moment):
        patcher = mock.patch.object(shirt_ideas, "_now", return_value=moment)
        patcher.start()
        self.addCleanup(patcher.stop)

    def saved(self):
        return json.loads(self.path.read_text(encoding="utf-8")) if self.path.is_file() else {}

    def ideas(self):
        return {idea.get("id"): idea for idea in shirt_ideas.load(self.config).get("ideas", [])}

    def refused(self, message, call, *args, **kwargs):
        with self.assertRaises(ValueError) as caught:
            call(self.config, *args, **kwargs)
        self.assertIn(message, str(caught.exception))


class StorageTests(ShirtIdeasTestCase):
    def test_the_list_lives_beside_tonys_notes(self):
        self.assertEqual(shirt_ideas.ideas_path(self.config), self.path)
        self.assertEqual(shirt_ideas.notes_path(self.config), self.root / "output" / "tshirt" / "ideas.txt")
        self.assertEqual(shirt_ideas.STATUSES, ("idea", "shortlisted", "designing", "done", "rejected"))
        self.assertEqual(shirt_ideas.ORIGINS, ("original", "quote", "unsure"))

    def test_no_file_is_an_empty_list_and_reading_it_writes_nothing(self):
        before = snapshot(self.root)
        self.assertEqual(shirt_ideas.load(self.config), {"version": 1, "nextId": 1, "ideas": []})
        self.assertEqual(snapshot(self.root), before)

    def test_a_typed_idea_is_saved_with_its_defaults(self):
        idea = shirt_ideas.add(self.config, "  Pain   train ")
        self.assertEqual(idea, {
            "id": 1, "phrase": "Pain train", "printText": "Pain train", "origin": "unsure", "source": None,
            "status": "idea", "notes": "", "from": {"kind": "manual"}, "addedAt": T1, "updatedAt": T1,
        })
        self.assertEqual(self.saved(), {"version": 1, "nextId": 2, "ideas": [idea]})
        self.assertTrue(self.path.read_text(encoding="utf-8").endswith("}\n"))
        self.assertEqual(sorted(p.name for p in self.path.parent.iterdir()), [".ideas.json.lock", "ideas.json", "ideas.txt"])

    def test_every_field_can_be_given_when_adding(self):
        idea = shirt_ideas.add(self.config, "I'd buy that for a dollar", print_text="I'D BUY THAT FOR A DOLLAR",
                               origin="quote", source=" RoboCop ", status="shortlisted", notes="The rating drop.")
        self.assertEqual({k: idea.get(k) for k in ("printText", "origin", "source", "status", "notes")}, {
            "printText": "I'D BUY THAT FOR A DOLLAR", "origin": "quote", "source": "RoboCop",
            "status": "shortlisted", "notes": "The rating drop.",
        })

    def test_ids_are_never_reused(self):
        first = shirt_ideas.add(self.config, "Pain train")
        second = shirt_ideas.add(self.config, "Big booty")
        shirt_ideas.remove(self.config, second.get("id"))
        third = shirt_ideas.add(self.config, "Nobody outruns the gravy")
        self.assertEqual((first.get("id"), second.get("id"), third.get("id")), (1, 2, 3))
        self.assertEqual(sorted(self.ideas()), [1, 3])

    def test_the_same_phrase_is_not_listed_twice(self):
        shirt_ideas.add(self.config, "Pain train", status="designing")
        for again in ("pain train", "PAIN  TRAIN!", " Pain, train. "):
            with self.subTest(again):
                self.refused("already on the list as #1 (designing)", shirt_ideas.add, again)
        self.assertEqual(len(self.ideas()), 1)

    def test_a_quote_names_its_source_and_nothing_else_has_one(self):
        self.refused("a quote needs its source", shirt_ideas.add, "We ride together", origin="quote")
        self.refused("a quote needs its source", shirt_ideas.add, "We ride together", origin="quote", source="  ")
        self.refused("only a quote has a source", shirt_ideas.add, "We ride together", origin="original",
                     source="Bad Boys II")
        self.refused("origin must be one of original, quote, unsure, not 'stolen'", shirt_ideas.add,
                     "We ride together", origin="stolen")
        self.refused("status must be one of idea, shortlisted, designing, done, rejected, not 'printed'",
                     shirt_ideas.add, "We ride together", status="printed")
        self.assertFalse(self.path.exists())

    def test_a_phrase_needs_words_and_has_a_length_limit(self):
        for phrase in ("", "   ", "?!", None, 7):
            with self.subTest(phrase=phrase):
                self.refused("phrase", shirt_ideas.add, phrase)
        self.refused("phrase is 301 characters (the limit is 300)", shirt_ideas.add, "pain " * 60 + "x")
        self.refused("notes must be text", shirt_ideas.add, "Pain train", notes=["a"])
        self.assertFalse(self.path.exists())

    def test_update_changes_only_the_fields_named(self):
        shirt_ideas.add(self.config, "Pain train")
        other = shirt_ideas.add(self.config, "Big booty")
        self.at(T2)
        idea = shirt_ideas.update(self.config, 1, status="designing", printText="PAIN TRAIN", notes="Train art?")
        self.assertEqual(idea, {
            "id": 1, "phrase": "Pain train", "printText": "PAIN TRAIN", "origin": "unsure", "source": None,
            "status": "designing", "notes": "Train art?", "from": {"kind": "manual"}, "addedAt": T1, "updatedAt": T2,
        })
        self.assertEqual(self.ideas(), {1: idea, 2: other})

    def test_update_refuses_what_it_does_not_know(self):
        shirt_ideas.add(self.config, "Pain train")
        before = self.saved()
        self.refused("no idea #9", shirt_ideas.update, 9, status="done")
        self.refused("no idea #1", shirt_ideas.update, "1", status="done")
        self.refused("cannot change phrase", shirt_ideas.update, 1, phrase="Gain train")
        self.refused("cannot change id", shirt_ideas.update, 1, id=4)
        self.refused("status must be one of", shirt_ideas.update, 1, status="printed")
        self.refused("printText needs some text", shirt_ideas.update, 1, printText=" ")
        self.refused("nothing to change", shirt_ideas.update, 1)
        self.assertEqual(self.saved(), before)

    def test_origin_and_source_change_together(self):
        shirt_ideas.add(self.config, "We ride together")
        self.refused("a quote needs its source", shirt_ideas.update, 1, origin="quote")
        quote = shirt_ideas.update(self.config, 1, origin="quote", source="Bad Boys II")
        self.assertEqual((quote.get("origin"), quote.get("source")), ("quote", "Bad Boys II"))
        renamed = shirt_ideas.update(self.config, 1, source="Bad Boys")
        self.assertEqual((renamed.get("origin"), renamed.get("source")), ("quote", "Bad Boys"))
        self.refused("a quote needs its source", shirt_ideas.update, 1, source=None)
        # No longer a quote: the source goes with it.
        original = shirt_ideas.update(self.config, 1, origin="original")
        self.assertEqual((original.get("origin"), original.get("source")), ("original", None))
        self.refused("only a quote has a source", shirt_ideas.update, 1, source="Bad Boys")

    def test_remove_returns_the_idea_and_takes_it_off_the_list(self):
        idea = shirt_ideas.add(self.config, "Pain train")
        self.assertEqual(shirt_ideas.remove(self.config, 1), idea)
        self.assertEqual(self.saved(), {"version": 1, "nextId": 2, "ideas": []})
        self.refused("no idea #1", shirt_ideas.remove, 1)

    def test_a_write_that_fails_leaves_the_old_file_and_no_scraps(self):
        shirt_ideas.add(self.config, "Pain train")
        before = self.path.read_bytes()
        with mock.patch("os.replace", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                shirt_ideas.add(self.config, "Big booty")
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(sorted(p.name for p in self.path.parent.iterdir()), [".ideas.json.lock", "ideas.json", "ideas.txt"])

    def test_a_file_from_a_newer_version_is_not_rewritten(self):
        self.path.write_text(json.dumps({"version": 2, "ideas": [], "boards": {}}))
        before = self.path.read_bytes()
        self.refused("ideas.json is version 2; this code reads version 1", shirt_ideas.add, "Pain train")
        self.refused("ideas.json is version 2", lambda config: shirt_ideas.load(config))
        self.assertEqual(self.path.read_bytes(), before)

    def test_a_file_that_is_not_a_list_of_ideas_is_refused(self):
        for text in ("[]", '{"version": 1, "ideas": {}}', "not json"):
            with self.subTest(text):
                self.path.write_text(text)
                self.refused("ideas.json", lambda config: shirt_ideas.load(config))


class FlagTests(unittest.TestCase):
    def flags(self, phrase, origin="original", source=None, print_text=None, came_from=None):
        return shirt_ideas.flags({"phrase": phrase, "printText": print_text or phrase, "origin": origin,
                                  "source": source, "from": came_from or {"kind": "manual"}})

    def test_an_original_line_with_nobody_named_has_no_flags(self):
        self.assertEqual(self.flags("Nobody outruns the gravy"), [])

    def test_a_quote_names_whose_line_it_is(self):
        self.assertEqual(self.flags("I'd buy that for a dollar", "quote", "RoboCop"), [
            {"kind": "quote", "text": "Quote from RoboCop: someone else's line"}])

    def test_an_unchecked_origin_is_said_plainly(self):
        self.assertEqual(self.flags("We ride together", "unsure"), [
            {"kind": "unsure", "text": "Origin not checked: it may be a quote"}])

    def test_the_two_rating_names_that_are_real_people_are_flagged(self):
        cases = [
            ("Give it a Slater", "Slater"), ("certified slater", "Slater"), ("Jeff Goldblum's", "Goldblum"),
            ("the gold bloom", "Goldblum"), ("GOLDBLUM", "Goldblum"),
        ]
        for phrase, name in cases:
            with self.subTest(phrase):
                self.assertEqual(self.flags(phrase), [{"kind": "person", "text": f"Names a real person: {name}"}])
        for phrase in ("A high dollar", "Waste of time", "Slaterized", "translate rain"):
            with self.subTest(phrase):
                self.assertEqual(self.flags(phrase), [])

    def test_the_text_to_print_is_checked_as_well_as_the_phrase(self):
        self.assertEqual(self.flags("a pile of shit", print_text="THE GOLDBLUM"),
                         [{"kind": "person", "text": "Names a real person: Goldblum"}])
        self.assertEqual(self.flags("Slater and Goldblum"), [
            {"kind": "person", "text": "Names a real person: Slater"},
            {"kind": "person", "text": "Names a real person: Goldblum"}])

    def test_a_phrase_the_scan_took_for_a_title_says_so(self):
        came_from = {"kind": "scan", "section": "titles"}
        self.assertEqual(self.flags("thomas crown", "unsure", came_from=came_from), [
            {"kind": "unsure", "text": "Origin not checked: it may be a quote"},
            {"kind": "title", "text": "The scan lists it as a likely title or name"}])

    def test_a_line_the_show_notes_credit_to_a_film_is_flagged_whatever_its_origin_says(self):
        known = {"kind": "known_quote", "text": "Known quote: RoboCop (docs/show-format.md)"}
        unsure = {"kind": "unsure", "text": "Origin not checked: it may be a quote"}
        self.assertEqual(self.flags("a dollar. I'd buy that for a dollar", "unsure"), [unsure, known])
        self.assertEqual(self.flags("I\u2019d BUY THAT for a dollar!", "original"), [known])
        self.assertEqual(self.flags("pain train", print_text="I'D BUY THAT FOR A DOLLAR"), [known])
        # Once Tony has recorded it as a quote, the quote flag says it all.
        self.assertEqual(self.flags("I'd buy that for a dollar", "quote", "RoboCop"),
                         [{"kind": "quote", "text": "Quote from RoboCop: someone else's line"}])
        self.assertEqual(self.flags("a high dollar"), [])
        self.assertEqual(shirt_ideas.KNOWN_QUOTES, (("buy that for a dollar", "RoboCop"),))

    def test_flags_are_listed_together(self):
        self.assertEqual([flag["kind"] for flag in self.flags("Give it a Slater", "quote", "Some Film") or []],
                         ["quote", "person"])


class ScanSectionTests(ShirtIdeasTestCase):
    def test_sections_are_the_reports_lists_with_their_counts(self):
        self.assertEqual(shirt_ideas.scan_sections(self.config), [
            {"id": "catchphrases", "title": "Catchphrases", "count": 2},
            {"id": "gags", "title": "Running gags", "count": 2},
            {"id": "passages", "title": "Drops and rituals", "count": 2},
            {"id": "staples", "title": "Staples", "count": 1},
            {"id": "titles", "title": "Titles and names", "count": 1},
        ])

    def test_a_row_has_the_episode_count_span_and_examples(self):
        page = shirt_ideas.scan_rows(self.config, "catchphrases")
        self.assertEqual({k: page.get(k) for k in ("section", "total", "offset", "limit")},
                         {"section": "catchphrases", "total": 2, "offset": 0, "limit": 50})
        self.assertEqual(page.get("rows"), [
            {"text": "pain train", "episodes": 40, "firstStem": "20100101", "lastStem": "20260105", "burst": None,
             "looksLikeTitle": False, "ideaId": None, "ignored": True, "flags": [], "examples": [
                 {"stem": "20100101", "start": 20.0, "text": "All aboard the pain train."},
                 {"stem": "20260105", "start": 30.0, "text": "That is the pain train, baby."}]},
            {"text": "give it a slater", "episodes": 30, "firstStem": "20110416", "lastStem": "20260105",
             "burst": {"count": 5, "window": 20, "fromStem": "20250106", "toStem": "20260105"},
             "looksLikeTitle": False, "ideaId": None, "ignored": False,
             "flags": [{"kind": "person", "text": "Names a real person: Slater"}], "examples": []},
        ])

    def test_gags_are_ordered_by_their_burst_and_passages_have_no_examples(self):
        self.assertEqual([row["text"] for row in shirt_ideas.scan_rows(self.config, "gags").get("rows", [])],
                         ["big booty", "give it a slater"])
        passages = shirt_ideas.scan_rows(self.config, "passages").get("rows", [])
        self.assertEqual(passages[:1], [
            {"text": DOLLAR, "episodes": 135, "firstStem": "20110416", "lastStem": "20260105", "burst": None,
             "looksLikeTitle": False, "ideaId": None, "ignored": False, "examples": [],
             "flags": [{"kind": "known_quote", "text": "Known quote: RoboCop (docs/show-format.md)"}]}])
        titles = shirt_ideas.scan_rows(self.config, "titles").get("rows", [])
        self.assertEqual([(row["text"], row["looksLikeTitle"], row["flags"]) for row in titles], [
            ("thomas crown", True, [{"kind": "title", "text": "The scan lists it as a likely title or name"}])])

    def test_rows_can_be_searched_and_paged(self):
        found = shirt_ideas.scan_rows(self.config, "passages", query="  PLACE to ")
        self.assertEqual((found.get("total"), [row["text"] for row in found.get("rows", [])]),
                         (1, ["one two three in the place to be"]))
        second = shirt_ideas.scan_rows(self.config, "passages", offset=1, limit=1)
        self.assertEqual((second.get("total"), second.get("offset"), second.get("limit"),
                          [row["text"] for row in second.get("rows", [])]),
                         (2, 1, 1, ["one two three in the place to be"]))
        self.assertEqual(shirt_ideas.scan_rows(self.config, "passages", offset=5).get("rows"), [])
        self.assertEqual(shirt_ideas.scan_rows(self.config, "passages", limit=5000).get("limit"), 200)

    def test_a_search_counts_its_matches_in_every_section(self):
        # A phrase is in whichever lists the scan put it; the counts say where to look.
        self.assertEqual([(row["id"], row["count"]) for row in shirt_ideas.scan_sections(self.config, " SLATER ") or []],
                         [("catchphrases", 1), ("gags", 1), ("passages", 0), ("staples", 0), ("titles", 0)])
        page = shirt_ideas.scan_rows(self.config, "staples", query="slater")
        self.assertEqual((page.get("total"), page.get("sections")), (0, shirt_ideas.scan_sections(self.config, "slater")))
        self.assertEqual(shirt_ideas.scan_rows(self.config, "staples").get("sections"),
                         shirt_ideas.scan_sections(self.config))

    def test_an_unknown_section_or_a_bad_page_is_refused(self):
        self.refused("no section 'bangers' (use catchphrases, gags, passages, staples, titles)",
                     shirt_ideas.scan_rows, "bangers")
        for bad in ({"offset": -1}, {"limit": 0}, {"offset": "2"}, {"query": 5}):
            with self.subTest(bad):
                self.refused("", shirt_ideas.scan_rows, "gags", **bad)

    def test_before_any_scan_every_section_is_empty(self):
        (self.root / "output/phrases/recurring-phrases.json").unlink()
        self.assertEqual([row["count"] for row in shirt_ideas.scan_sections(self.config) or [{"count": None}]],
                         [0, 0, 0, 0, 0])
        self.assertEqual(shirt_ideas.scan_rows(self.config, "gags").get("rows"), [])


class PromoteFromScanTests(ShirtIdeasTestCase):
    def test_a_scan_phrase_joins_the_shortlist_with_its_count_and_span(self):
        idea = shirt_ideas.add_from_scan(self.config, "Pain Train")
        self.assertEqual(idea, {
            "id": 1, "phrase": "pain train", "printText": "pain train", "origin": "unsure", "source": None,
            "status": "shortlisted", "notes": "", "addedAt": T1, "updatedAt": T1,
            "from": {"kind": "scan", "section": "catchphrases", "episodes": 40, "firstStem": "20100101",
                     "lastStem": "20260105", "scannedAt": "2026-01-20T08:22:00+00:00"},
        })
        self.assertEqual(self.saved().get("ideas"), [idea])
        rows = shirt_ideas.scan_rows(self.config, "catchphrases").get("rows", [])
        self.assertEqual([row["ideaId"] for row in rows], [1, None])

    def test_a_passage_is_promoted_as_spoken_and_fields_can_be_set_on_the_way(self):
        idea = shirt_ideas.add_from_scan(self.config, DOLLAR, print_text="I'D BUY THAT FOR A DOLLAR",
                                         origin="quote", source="RoboCop", status="idea")
        self.assertEqual((idea.get("phrase"), idea.get("printText"), idea.get("origin"), idea.get("source"),
                          idea.get("status"), (idea.get("from") or {}).get("section")),
                         (DOLLAR, "I'D BUY THAT FOR A DOLLAR", "quote", "RoboCop", "idea", "passages"))

    def test_a_phrase_in_two_lists_is_credited_to_the_first_and_marked_in_both(self):
        idea = shirt_ideas.add_from_scan(self.config, "give it a slater")
        self.assertEqual((idea.get("from") or {}).get("section"), "catchphrases")
        for section in ("catchphrases", "gags"):
            with self.subTest(section):
                rows = {row["text"]: row for row in shirt_ideas.scan_rows(self.config, section).get("rows", [])}
                self.assertEqual(rows["give it a slater"]["ideaId"], 1)

    def test_a_phrase_the_report_does_not_list_or_already_on_the_list_is_refused(self):
        self.refused("'gravy boat' is not in the phrase report", shirt_ideas.add_from_scan, "gravy boat")
        shirt_ideas.add(self.config, "Pain train!")
        self.refused("already on the list as #1 (idea)", shirt_ideas.add_from_scan, "pain train")
        self.assertEqual(len(self.ideas()), 1)


class EpisodePhraseTests(ShirtIdeasTestCase):
    def test_each_shirts_file_is_listed_with_cowork_flags(self):
        self.assertEqual(shirt_ideas.episode_phrases(self.config), [{"stem": "20260112", "problems": [], "phrases": [
            {"index": 1, "phrase": "Nobody outruns the gravy", "start": 20.0, "end": 30.0, "speaker": "Harley",
             "origin": "original", "source": None, "why": "Funny with no context", "ideaId": None, "flags": []},
            {"index": 2, "phrase": "I'd buy that for a dollar", "start": 30.0, "end": 40.0, "speaker": "Drop",
             "origin": "quote", "source": "RoboCop", "why": "Funny with no context", "ideaId": None,
             "flags": [{"kind": "quote", "text": "Quote from RoboCop: someone else's line"}]},
            {"index": 3, "phrase": "Certified Slater", "start": 40.0, "end": 50.0, "speaker": "Fonso",
             "origin": "unsure", "source": None, "why": "Funny with no context", "ideaId": None,
             "flags": [{"kind": "unsure", "text": "Origin not checked: it may be a quote"},
                       {"kind": "person", "text": "Names a real person: Slater"}]},
        ]}])

    def test_episodes_are_newest_first(self):
        dashboard_fixture.write(self.root / "output/cowork/20260105.shirts.json",
                                dashboard_fixture.shirts("20260105"))
        dashboard_fixture.write(self.root / "output/cowork/20260119.shirts.json",
                                dashboard_fixture.shirts("20260119", dashboard_fixture.shirt("Free parking", 30)))
        listed = shirt_ideas.episode_phrases(self.config) or []
        self.assertEqual([(row["stem"], len(row["phrases"])) for row in listed],
                         [("20260119", 1), ("20260112", 3), ("20260105", 0)])

    def test_an_episode_phrase_keeps_cowork_origin_source_and_where_it_was_said(self):
        idea = shirt_ideas.add_from_episode(self.config, "20260112", 2)
        self.assertEqual(idea, {
            "id": 1, "phrase": "I'd buy that for a dollar", "printText": "I'd buy that for a dollar",
            "origin": "quote", "source": "RoboCop", "status": "shortlisted", "notes": "",
            "addedAt": T1, "updatedAt": T1,
            "from": {"kind": "episode", "stem": "20260112", "start": 30.0, "end": 40.0, "speaker": "Drop",
                     "why": "Funny with no context"},
        })
        (episode,) = shirt_ideas.episode_phrases(self.config) or [{}]
        self.assertEqual([row["ideaId"] for row in episode.get("phrases", [])], [None, 1, None])

    def test_tony_can_overrule_cowork_when_promoting(self):
        idea = shirt_ideas.add_from_episode(self.config, "20260112", 3, origin="original", print_text="CERTIFIED SLATER")
        self.assertEqual((idea.get("origin"), idea.get("source"), idea.get("printText")),
                         ("original", None, "CERTIFIED SLATER"))
        overruled = shirt_ideas.add_from_episode(self.config, "20260112", 2, origin="unsure")
        self.assertEqual((overruled.get("origin"), overruled.get("source")), ("unsure", None))

    def test_a_missing_file_or_number_is_refused(self):
        self.refused("no shirts file for 20260105", shirt_ideas.add_from_episode, "20260105", 1)
        self.refused("no shirts file for ../state", shirt_ideas.add_from_episode, "../state", 1)
        self.refused("phrase 4 does not exist (1-3)", shirt_ideas.add_from_episode, "20260112", 4)
        self.refused("phrase 0 does not exist (1-3)", shirt_ideas.add_from_episode, "20260112", 0)
        self.assertFalse(self.path.exists())

    def test_a_file_the_validator_rejects_is_listed_with_its_problems_and_offers_nothing(self):
        bad = dashboard_fixture.shirts("20260119", dashboard_fixture.shirt("Free parking", 30, origin="borrowed"))
        dashboard_fixture.write(self.root / "output/cowork/20260119.shirts.json", bad)
        dashboard_fixture.write(self.root / "output/cowork/20260105.shirts.json", data=b"{not json")
        listed = {row["stem"]: row for row in shirt_ideas.episode_phrases(self.config) or []}
        self.assertEqual(listed["20260119"]["phrases"], [])
        self.assertEqual(listed["20260119"]["problems"],
                         ["phrases[0] has unknown origin 'borrowed' (use original, quote, unsure)"])
        self.assertEqual((listed["20260105"]["phrases"], len(listed["20260105"]["problems"])), ([], 1))
        self.refused("20260119.shirts.json is not valid", shirt_ideas.add_from_episode, "20260119", 1)


class NotesTests(ShirtIdeasTestCase):
    def test_each_line_of_ideas_txt_is_offered_under_its_heading(self):
        self.assertEqual(shirt_ideas.notes(self.config), [
            {"number": 2, "heading": "mt rushmores", "line": "- 20260112 - Horror Icons", "stem": "20260112",
             "text": "Horror Icons", "ideaId": None, "flags": []},
            {"number": 3, "heading": "mt rushmores", "line": "- 20260105 -", "stem": "20260105", "text": "",
             "ideaId": None, "flags": []},
            {"number": 6, "heading": "Ratings as words", "line": "Goldblum", "stem": None, "text": "Goldblum",
             "ideaId": None, "flags": [{"kind": "person", "text": "Names a real person: Goldblum"}]},
            {"number": 7, "heading": "Ratings as words", "line": "Dollar", "stem": None, "text": "Dollar",
             "ideaId": None, "flags": []},
        ])

    def test_no_notes_file_offers_nothing(self):
        (self.root / "output/tshirt/ideas.txt").unlink()
        self.assertEqual(shirt_ideas.notes(self.config), [])

    def test_a_line_becomes_an_idea_and_the_notes_file_is_left_alone(self):
        notes_file = self.root / "output/tshirt/ideas.txt"
        before = (notes_file.read_bytes(), notes_file.stat().st_mtime_ns)
        idea = shirt_ideas.add_from_notes(self.config, 6)
        self.assertEqual(idea, {
            "id": 1, "phrase": "Goldblum", "printText": "Goldblum", "origin": "unsure", "source": None,
            "status": "idea", "notes": "", "addedAt": T1, "updatedAt": T1,
            "from": {"kind": "notes", "heading": "Ratings as words", "line": "Goldblum"},
        })
        self.assertEqual((notes_file.read_bytes(), notes_file.stat().st_mtime_ns), before)
        self.assertEqual([row["ideaId"] for row in shirt_ideas.notes(self.config) or []], [None, None, 1, None])

    def test_a_line_can_be_reworded_and_keeps_the_episode_it_names(self):
        idea = shirt_ideas.add_from_notes(self.config, 3, phrase="Draculas", notes="Mt. Rushmore list")
        self.assertEqual((idea.get("phrase"), idea.get("notes"), idea.get("from")), (
            "Draculas", "Mt. Rushmore list",
            {"kind": "notes", "heading": "mt rushmores", "line": "- 20260105 -", "stem": "20260105"}))
        # Still matched to its line, though the phrase is no longer the line's words.
        self.assertEqual([row["ideaId"] for row in shirt_ideas.notes(self.config) or []], [None, 1, None, None])

    def test_a_line_with_no_words_needs_a_phrase_and_a_heading_is_not_a_line(self):
        self.refused("line 3 of ideas.txt has no phrase; give one", shirt_ideas.add_from_notes, 3)
        self.refused("line 1 of ideas.txt is not an idea", shirt_ideas.add_from_notes, 1)
        self.refused("line 99 of ideas.txt is not an idea", shirt_ideas.add_from_notes, 99)
        self.assertFalse(self.path.exists())


class SectionTests(unittest.TestCase):
    """lib.phrase_scan.sections: one definition of the report's lists, for the markdown and the board."""

    def setUp(self):
        self.result = {"version": 1, "scannedAt": "2026-01-20T08:22:00+00:00", "transcripts": 4,
                       "firstStem": "20100101", "lastStem": "20260119",
                       "phrases": dashboard_fixture.SCAN_PHRASES, "passages": dashboard_fixture.SCAN_PASSAGES}

    def test_the_sections_and_their_order(self):
        self.assertEqual(phrase_scan.SECTIONS, (
            ("catchphrases", "Catchphrases"), ("gags", "Running gags"), ("passages", "Drops and rituals"),
            ("staples", "Staples"), ("titles", "Titles and names")))
        sections = phrase_scan.sections(self.result)
        self.assertEqual(list(sections), [key for key, _ in phrase_scan.SECTIONS])
        self.assertEqual({key: [row.get("phrase", row.get("text")) for row in rows] for key, rows in sections.items()}, {
            "catchphrases": ["pain train", "give it a slater"],
            "gags": ["big booty", "give it a slater"],
            "passages": [DOLLAR, "one two three in the place to be"],
            "staples": ["first time"],
            "titles": ["thomas crown"],
        })

    def test_the_markdown_report_lists_each_section_in_the_same_order(self):
        report = phrase_scan.render_markdown(self.result)
        headings = {"catchphrases": "## Catchphrases (most episodes)", "gags": "## Running gags (bursts)",
                    "passages": "## Recurring passages (drops and rituals)", "staples": "## Staples (review once)",
                    "titles": "## Likely titles and names"}
        for key, rows in phrase_scan.sections(self.result).items() or [(k, []) for k in headings]:
            with self.subTest(key):
                body = report.split(headings[key])[1].split("\n## ")[0]
                listed = [line for line in body.splitlines() if line.startswith("- ")]
                self.assertEqual(len(listed), len(rows))
                for line, row in zip(listed, rows):
                    self.assertIn(row.get("phrase", row.get("text")), line)
        self.assertEqual(len(phrase_scan.sections(self.result)), 5)

    def test_a_report_with_nothing_in_it_has_five_empty_sections(self):
        self.assertEqual(phrase_scan.sections({}), {key: [] for key in
                                                    ("catchphrases", "gags", "passages", "staples", "titles")})


class ScriptTests(ShirtIdeasTestCase):
    """scripts/shirt_ideas.py: everything the board does, from a terminal and without the venv."""

    def setUp(self):
        super().setUp()
        self.config_path = self.root / "config.json"
        self.config_path.write_text(json.dumps({
            "paths": {"episodes_dir": "./episodes", "output_dir": "./output", "transcripts_dir": "./transcripts"},
            "settings": {"cowork_outputs_dir": "./output/cowork"},
        }))

    def run_script(self, *args, data=None):
        env = dict(os.environ, **{data_dir.ENV_VAR: str(data or self.root)})
        # -S: no site-packages, so the script must need nothing but the standard library.
        return subprocess.run(
            [sys.executable, "-S", str(ROOT / "scripts" / "shirt_ideas.py"), "--config", str(self.config_path), *args],
            capture_output=True, text=True, env=env, cwd=self.root)

    def ok(self, *args):
        result = self.run_script(*args)
        self.assertEqual((result.returncode, result.stderr), (0, ""))
        return result.stdout

    def test_add_list_set_and_remove(self):
        self.assertEqual(self.ok("list"), "No shirt ideas yet.\n")
        self.assertEqual(self.ok("add", "Pain train", "--print", "PAIN TRAIN", "--notes", "Train art?"),
                         "#1 idea: PAIN TRAIN\n")
        self.assertEqual(self.ok("add", "I'd buy that for a dollar", "--origin", "quote", "--source", "RoboCop",
                                 "--status", "shortlisted"), "#2 shortlisted: I'd buy that for a dollar\n")
        self.assertEqual(self.ok("set", "1", "--status", "designing", "--origin", "original"),
                         "#1 designing: PAIN TRAIN\n")
        listing = self.ok("list")
        self.assertEqual(listing, (
            "#1  designing    original  PAIN TRAIN\n"
            "      said: Pain train\n"
            "      from: typed in\n"
            "      notes: Train art?\n"
            "#2  shortlisted  quote     I'd buy that for a dollar\n"
            "      from: typed in\n"
            "      ! Quote from RoboCop: someone else's line\n"
        ))
        self.ok("set", "2", "--origin", "unsure")
        self.assertIn("      ! Origin not checked: it may be a quote\n"
                      "      ! Known quote: RoboCop (docs/show-format.md)\n", self.ok("list"))
        self.ok("set", "2", "--origin", "quote", "--source", "RoboCop")
        self.assertEqual(self.ok("list", "--status", "designing").count("\n#"), 0)
        self.assertIn("#1  designing", self.ok("list", "--status", "designing"))
        self.assertEqual(self.ok("remove", "2"), "removed #2: I'd buy that for a dollar\n")
        self.assertEqual([idea["id"] for idea in self.saved().get("ideas", [])], [1])

    def test_the_scan_can_be_browsed_and_a_phrase_promoted(self):
        self.assertEqual(self.ok("scan"), (
            "catchphrases  Catchphrases        2\n"
            "gags          Running gags        2\n"
            "passages      Drops and rituals   2\n"
            "staples       Staples             1\n"
            "titles        Titles and names    1\n"
        ))
        self.assertEqual(self.ok("scan", "catchphrases"), (
            "Catchphrases: 2\n"
            "   40 eps  20100101-20260105  pain train  (ignored)\n"
            "   30 eps  20110416-20260105  give it a slater\n"
            "             ! Names a real person: Slater\n"
        ))
        self.assertEqual(self.ok("scan", "passages", "--find", "place", "--top", "5"), (
            "Drops and rituals: 1 matching 'place'\n"
            "   50 eps  20100101-20130707  one two three in the place to be\n"
        ))
        self.assertEqual(self.ok("add-scan", "pain train", "--print", "PAIN TRAIN"), "#1 shortlisted: PAIN TRAIN\n")
        self.assertIn("   40 eps  20100101-20260105  pain train  [#1]  (ignored)\n", self.ok("scan", "catchphrases"))
        self.assertIn("      from: phrase scan, Catchphrases, 40 episodes 20100101-20260105\n", self.ok("list"))

    def test_an_episodes_phrases_can_be_listed_and_promoted(self):
        self.assertEqual(self.ok("episode", "20260112"), (
            "20260112: 3 phrases\n"
            "  1  original  Harley   Nobody outruns the gravy\n"
            "  2  quote     Drop     I'd buy that for a dollar\n"
            "       ! Quote from RoboCop: someone else's line\n"
            "  3  unsure    Fonso    Certified Slater\n"
            "       ! Origin not checked: it may be a quote\n"
            "       ! Names a real person: Slater\n"
        ))
        self.assertEqual(self.ok("add-episode", "20260112", "1"), "#1 shortlisted: Nobody outruns the gravy\n")
        self.assertIn("  1  original  Harley   Nobody outruns the gravy  [#1]\n", self.ok("episode", "20260112"))
        self.assertIn("      from: episode 20260112 at 0:00:20, Harley\n", self.ok("list"))
        self.assertEqual(self.ok("episode"), "20260112: 3 phrases\n")

    def test_notes_can_be_listed_and_added(self):
        self.assertEqual(self.ok("notes"), (
            "mt rushmores\n"
            "   2  Horror Icons  (20260112)\n"
            "   3  (no phrase)  (20260105)\n"
            "Ratings as words\n"
            "   6  Goldblum\n"
            "        ! Names a real person: Goldblum\n"
            "   7  Dollar\n"
        ))
        self.assertEqual(self.ok("add-note", "6"), "#1 idea: Goldblum\n")
        self.assertEqual(self.ok("add-note", "3", "--phrase", "Draculas"), "#2 idea: Draculas\n")
        self.assertIn("   6  Goldblum  [#1]\n", self.ok("notes"))
        self.assertIn("      from: ideas.txt, mt rushmores (20260105)\n", self.ok("list"))

    def test_a_mistake_is_exit_2_with_the_reason_and_nothing_written(self):
        for args, reason in (
            (("add", "We ride together", "--origin", "quote"), "error: a quote needs its source"),
            (("set", "9", "--status", "done"), "error: no idea #9"),
            (("add-scan", "gravy boat"), "error: 'gravy boat' is not in the phrase report"),
            (("add-episode", "20260105", "1"), "error: no shirts file for 20260105"),
            (("add-note", "1"), "error: line 1 of ideas.txt is not an idea"),
            (("scan", "bangers"), "error: no section 'bangers'"),
            (("ignore", "gravy boat"), "error: 'gravy boat' is not in the phrase report"),
            (("ignore", "Pain Train"), "error: 'pain train' is already in ignore.txt"),
        ):
            with self.subTest(args):
                result = self.run_script(*args)
                self.assertEqual((result.returncode, result.stdout), (2, ""))
                self.assertIn(reason, result.stderr)
        self.assertFalse(self.path.exists())

    def test_it_stops_when_the_data_directory_is_missing(self):
        result = self.run_script("list", data=self.root / "nowhere")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Pipeline data directory not found", result.stderr)


class IgnoreTests(ShirtIdeasTestCase):
    """Ignoring a phrase of the report adds it to output/phrases/ignore.txt, which the next scan skips."""

    def setUp(self):
        super().setUp()
        self.ignore = self.root / "output" / "phrases" / "ignore.txt"

    def ignored_rows(self):
        return {row["text"]: row.get("ignored") for section, _ in phrase_scan.SECTIONS
                for row in shirt_ideas.scan_rows(self.config, section, limit=200)["rows"]}

    def test_a_report_phrase_becomes_its_own_line_and_tonys_lines_stay(self):
        self.ignore.write_text("# ordinary English\npain train", encoding="utf-8")  # no newline at the end
        self.assertEqual(shirt_ideas.ignore_from_scan(self.config, "Big Booty!"), {"phrase": "big booty"})
        self.assertEqual(shirt_ideas.ignore_from_scan(self.config, "A dollar, I'd buy that for a dollar"),
                         {"phrase": "a dollar. I'd buy that for a dollar"})
        self.assertEqual(self.ignore.read_text(encoding="utf-8"),
                         "# ordinary English\npain train\nbig booty\na dollar. I'd buy that for a dollar\n")
        # The scan reads each line as it compares phrases.
        self.assertEqual(phrase_scan.ignored_phrases(self.ignore.parent),
                         {"pain train", "big booty", "a dollar i'd buy that for a dollar"})
        rows = self.ignored_rows()
        self.assertEqual({text for text, ignored in rows.items() if ignored},
                         {"pain train", "big booty", "a dollar. I'd buy that for a dollar"})
        self.assertFalse(rows["give it a slater"])

    def test_with_no_ignore_file_one_is_started(self):
        self.ignore.unlink()
        self.assertEqual(phrase_scan.ignored_phrases(self.ignore.parent), set())
        shirt_ideas.ignore_from_scan(self.config, "big booty")
        self.assertEqual(self.ignore.read_text(encoding="utf-8"), "big booty\n")

    def test_what_is_not_in_the_report_or_already_ignored_is_refused_and_nothing_written(self):
        before = snapshot(self.root)
        self.refused("'gravy boat' is not in the phrase report", shirt_ideas.ignore_from_scan, "gravy boat")
        self.refused("'pain train' is already in ignore.txt", shirt_ideas.ignore_from_scan, "Pain, train.")
        self.refused("phrase must be text", shirt_ideas.ignore_from_scan, None)
        self.assertEqual(snapshot(self.root), before)


class ReadOnlyTests(ShirtIdeasTestCase):
    def test_browsing_never_writes(self):
        before = snapshot(self.root)
        shirt_ideas.load(self.config)
        shirt_ideas.scan_sections(self.config)
        for section in ("catchphrases", "gags", "passages", "staples", "titles"):
            shirt_ideas.scan_rows(self.config, section)
        shirt_ideas.episode_phrases(self.config)
        shirt_ideas.notes(self.config)
        self.assertEqual(snapshot(self.root), before)

    def test_a_change_touches_only_ideas_json(self):
        before = snapshot(self.root)
        shirt_ideas.add(self.config, "Pain train")
        shirt_ideas.add_from_scan(self.config, "big booty")
        shirt_ideas.add_from_episode(self.config, "20260112", 1)
        shirt_ideas.add_from_notes(self.config, 6)
        shirt_ideas.update(self.config, 1, status="rejected")
        shirt_ideas.remove(self.config, 2)
        changed = sorted({row[0] for row in set(snapshot(self.root)) ^ set(before)})
        self.assertEqual(changed, ["output/tshirt", "output/tshirt/.ideas.json.lock", "output/tshirt/ideas.json"])
        self.assertEqual(len(self.ideas()), 3)


class LockTests(ShirtIdeasTestCase):
    """The dashboard and scripts/shirt_ideas.py can both change the list; one waits for the other."""

    def hold_lock(self):
        lock = self.path.with_name(".ideas.json.lock")
        lock.parent.mkdir(parents=True, exist_ok=True)
        held = open(lock, "a")
        fcntl.flock(held, fcntl.LOCK_EX)
        return held

    def test_each_change_waits_while_another_writer_holds_the_list(self):
        shirt_ideas.add(self.config, "Pain train")
        changes = {
            "add": lambda: shirt_ideas.add(self.config, "Big booty"),
            "update": lambda: shirt_ideas.update(self.config, 1, status="rejected"),
            "remove": lambda: shirt_ideas.remove(self.config, 1),
        }
        for name, change in changes.items():
            with self.subTest(name):
                before = self.path.read_bytes()
                held = self.hold_lock()
                worker = threading.Thread(target=change)
                worker.start()
                worker.join(0.3)
                waited = worker.is_alive()
                unchanged = self.path.read_bytes() == before
                held.close()  # releases the lock
                worker.join(5)
                self.assertTrue(waited and unchanged, f"{name} did not wait for the lock")
                self.assertNotEqual(self.path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
