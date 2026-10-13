#!/usr/bin/env python3
"""Keep the T-shirt shortlist: phrases Tony is considering, and what he decided.

Standard library only. The list is saved to output/tshirt/ideas.json in the
pipeline data directory; ideas.txt beside it is read and never changed.

    python3 scripts/shirt_ideas.py list
    python3 scripts/shirt_ideas.py list --status shortlisted
        every idea with its number, status, origin, where it came from, and
        any licensing flag (lines starting with !)

    python3 scripts/shirt_ideas.py add "Pain train" --print "PAIN TRAIN"
    python3 scripts/shirt_ideas.py add "I'd buy that for a dollar" --origin quote --source RoboCop
        type an idea in; --print is the text for the shirt when it differs

    python3 scripts/shirt_ideas.py scan
    python3 scripts/shirt_ideas.py scan catchphrases --find train --top 40
    python3 scripts/shirt_ideas.py add-scan "pain train"
        browse the recurring-phrase report by its lists, and shortlist a phrase
        (rescan with scripts/scan_phrases.py)

    python3 scripts/shirt_ideas.py episode 20261012
    python3 scripts/shirt_ideas.py add-episode 20261012 3
        Cowork's picks for an episode (output/cowork/<stem>.shirts.json), and
        shortlist one by its number

    python3 scripts/shirt_ideas.py notes
    python3 scripts/shirt_ideas.py add-note 6
    python3 scripts/shirt_ideas.py add-note 3 --phrase "Draculas"
        the lines of ideas.txt by line number, and add one

    python3 scripts/shirt_ideas.py set 4 --status designing --notes "train art"
    python3 scripts/shirt_ideas.py set 4 --origin quote --source "Bad Boys II"
    python3 scripts/shirt_ideas.py remove 4
        statuses: idea, shortlisted, designing, done, rejected
        origins: original, quote (needs --source), unsure
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib import phrase_scan, shirt_ideas  # noqa: E402
from lib.data_dir import require_data_dir, resolve_data_paths  # noqa: E402

FIELDS = (("print", "print_text"), ("origin", "origin"), ("source", "source"), ("notes", "notes"), ("status", "status"))


def _load_config(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return resolve_data_paths(json.load(f))


def _one_line(text: str) -> str:
    return " / ".join(text.splitlines())


def _mark(idea_id) -> str:
    return f"  [#{idea_id}]" if idea_id else ""


def _saved(idea: dict) -> int:
    print(f"#{idea['id']} {idea['status']}: {_one_line(idea['printText'])}")
    return 0


def _given(args: argparse.Namespace) -> dict:
    """The fields named on the command line, under the names the library uses."""
    return {name: getattr(args, option) for option, name in FIELDS if getattr(args, option, None) is not None}


def _list(config: dict, status: str | None) -> int:
    ideas = [idea for idea in shirt_ideas.load(config)["ideas"] if status in (None, idea.get("status"))]
    if not ideas:
        print(f"No shirt ideas with status {status}." if status else "No shirt ideas yet.")
    for idea in ideas:
        print(f"#{idea['id']:<3}{idea['status']:<13}{idea['origin']:<10}{_one_line(idea['printText'])}")
        if idea["printText"] != idea["phrase"]:
            print(f"      said: {idea['phrase']}")
        print(f"      from: {shirt_ideas.source_text(idea)}")
        if idea.get("notes"):
            print(f"      notes: {_one_line(idea['notes'])}")
        for flag in shirt_ideas.flags(idea):
            print(f"      ! {flag['text']}")
    return 0


def _scan(config: dict, section: str | None, find: str, top: int) -> int:
    if section is None:
        for row in shirt_ideas.scan_sections(config):
            print(f"{row['id']:<14}{row['title']:<20}{row['count']}")
        return 0
    page = shirt_ideas.scan_rows(config, section, query=find, limit=top)
    print(f"{page['title']}: {page['total']}" + (f" matching {page['query']!r}" if page["query"] else ""))
    for row in page["rows"]:
        print(f"{row['episodes']:>5} eps  {row['firstStem']}-{row['lastStem']}  {row['text']}{_mark(row['ideaId'])}")
        for flag in row["flags"]:
            print(f"             ! {flag['text']}")
    if page["total"] > len(page["rows"]):
        print(f"  ... {page['total'] - len(page['rows'])} more (--top, up to {shirt_ideas.PAGE_ROWS_MAX}, or --find)")
    return 0


def _episode(config: dict, stem: str | None) -> int:
    episodes = shirt_ideas.episode_phrases(config)
    if stem is not None:
        episodes = [episode for episode in episodes if episode["stem"] == stem]
        if not episodes:
            raise ValueError(f"no shirts file for {stem}")
    if not episodes:
        print("No episode has a shirts file yet.")
    for episode in episodes:
        if episode["problems"]:
            print(f"{episode['stem']}: not valid: {episode['problems'][0]}")
            continue
        count = len(episode["phrases"])
        print(f"{episode['stem']}: {count} phrase{'' if count == 1 else 's'}")
        for row in episode["phrases"] if stem is not None else []:
            print(f"{row['index']:>3}  {row['origin']:<10}{row['speaker']:<9}{row['phrase']}{_mark(row['ideaId'])}")
            for flag in row["flags"]:
                print(f"       ! {flag['text']}")
    return 0


def _notes(config: dict) -> int:
    rows = shirt_ideas.notes(config)
    if not rows:
        print(f"No ideas in {shirt_ideas.notes_path(config)}.")
    heading = None
    for row in rows:
        if row["heading"] != heading and row["heading"]:
            print(row["heading"])
        heading = row["heading"]
        stem = f"  ({row['stem']})" if row["stem"] else ""
        print(f"{row['number']:>4}  {row['text'] or '(no phrase)'}{stem}{_mark(row['ideaId'])}")
        for flag in row["flags"]:
            print(f"        ! {flag['text']}")
    return 0


def _add_fields(parser: argparse.ArgumentParser, status: str) -> None:
    parser.add_argument("--print", help="the text to print, when it differs from the phrase as spoken")
    parser.add_argument("--origin", help=f"{', '.join(shirt_ideas.ORIGINS)} (default: unsure, or Cowork's for an episode phrase)")
    parser.add_argument("--source", help="the film, show or song a quote is from")
    parser.add_argument("--notes")
    parser.add_argument("--status", help=f"{', '.join(shirt_ideas.STATUSES)} (default: {status})")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=str(ROOT / "config.json"))
    sub = ap.add_subparsers(dest="command", required=True)

    p = sub.add_parser("list", help="show the ideas")
    p.add_argument("--status")

    p = sub.add_parser("add", help="type an idea in")
    p.add_argument("phrase", help="the phrase as spoken")
    _add_fields(p, "idea")

    p = sub.add_parser("scan", help="browse the recurring-phrase report")
    p.add_argument("section", nargs="?", help=", ".join(key for key, _ in phrase_scan.SECTIONS))
    p.add_argument("--find", default="", help="only phrases containing this")
    p.add_argument("--top", type=int, default=20, help="how many to list (default 20)")

    p = sub.add_parser("add-scan", help="shortlist a phrase from the report")
    p.add_argument("phrase")
    _add_fields(p, "shortlisted")

    p = sub.add_parser("episode", help="Cowork's phrases for an episode, or the episodes that have any")
    p.add_argument("stem", nargs="?")

    p = sub.add_parser("add-episode", help="shortlist one of an episode's phrases")
    p.add_argument("stem")
    p.add_argument("number", type=int, help="the phrase's number in 'episode <stem>'")
    _add_fields(p, "shortlisted")

    sub.add_parser("notes", help="the lines of ideas.txt")

    p = sub.add_parser("add-note", help="add a line of ideas.txt")
    p.add_argument("line", type=int, help="the line's number in 'notes'")
    p.add_argument("--phrase", help="reword the line, or give the phrase a line lacks")
    _add_fields(p, "idea")

    p = sub.add_parser("set", help="change an idea")
    p.add_argument("id", type=int)
    _add_fields(p, "unchanged")

    p = sub.add_parser("remove", help="take an idea off the list for good")
    p.add_argument("id", type=int)

    args = ap.parse_args()
    config = _load_config(Path(args.config))
    require_data_dir()
    try:
        if args.command == "list":
            return _list(config, args.status)
        if args.command == "add":
            return _saved(shirt_ideas.add(config, args.phrase, **_given(args)))
        if args.command == "scan":
            return _scan(config, args.section, args.find, args.top)
        if args.command == "add-scan":
            return _saved(shirt_ideas.add_from_scan(config, args.phrase, **_given(args)))
        if args.command == "episode":
            return _episode(config, args.stem)
        if args.command == "add-episode":
            return _saved(shirt_ideas.add_from_episode(config, args.stem, args.number, **_given(args)))
        if args.command == "notes":
            return _notes(config)
        if args.command == "add-note":
            fields = _given(args) | ({} if args.phrase is None else {"phrase": args.phrase})
            return _saved(shirt_ideas.add_from_notes(config, args.line, **fields))
        if args.command == "set":
            changes = _given(args)
            if "print_text" in changes:
                changes["printText"] = changes.pop("print_text")
            return _saved(shirt_ideas.update(config, args.id, **changes))
        idea = shirt_ideas.remove(config, args.id)
        print(f"removed #{idea['id']}: {_one_line(idea['printText'])}")
        return 0
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
