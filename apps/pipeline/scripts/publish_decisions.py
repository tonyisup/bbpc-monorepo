#!/usr/bin/env python3
"""Record what happened to each rendered clip: published as a Short, or skipped.

Standard library only. Decisions are saved to output/publish-decisions.json in
the pipeline data directory.

    python3 scripts/publish_decisions.py list 20261005
        rendered clips (by NN- file number) and Cowork's candidates, with decisions

    python3 scripts/publish_decisions.py publish 20261005 2 https://youtube.com/shorts/ID
    python3 scripts/publish_decisions.py skip 20261005 1 --reason "payoff too slow"
    python3 scripts/publish_decisions.py skip 20261005 rest
        clip numbers are the NN- prefix of the rendered file; "rest" means every
        rendered clip of that episode that has no decision yet

    python3 scripts/publish_decisions.py publish 20261005 c7 https://youtu.be/ID
        a candidate that was not rendered (c + its position in candidateClips)

    python3 scripts/publish_decisions.py untracked 20260405 "Bingo Card" https://youtu.be/ID
        a Short whose clip is no longer in the pipeline's output

    python3 scripts/publish_decisions.py report
        per-episode counts for every episode with rendered clips or decisions
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib import publish_log  # noqa: E402
from lib.data_dir import require_data_dir, resolve_data_paths  # noqa: E402


def _load_config(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return resolve_data_paths(json.load(f))


def _decision_index(config: dict, stem: str) -> dict:
    return {publish_log.decision_key(d): d for d in publish_log.load(config)["decisions"] if d["stem"] == stem}


def _describe(decision: dict | None) -> str:
    if not decision:
        return "-"
    text = decision["decision"]
    if decision.get("youtubeId"):
        text += f" https://youtube.com/shorts/{decision['youtubeId']}"
    if decision.get("reason"):
        text += f" ({decision['reason']})"
    return text


def _list(config: dict, stem: str) -> int:
    decided = _decision_index(config, stem)
    rendered = publish_log.rendered_clips(config, stem)
    if not rendered:
        print(f"No rendered clips for {stem} (no output/seo/{stem}.seo.json or no picks).")
    else:
        print(f"Rendered clips for {stem}:")
    for r in rendered:
        row = publish_log.clip_row(stem, r["clip"], "pick", "skipped", None, None)
        missing = "" if r["fileExists"] else "  [file missing]"
        print(f"  {r['index']}  {r['file']}{missing}\n     {_describe(decided.get(publish_log.decision_key(row)))}")
    candidates = publish_log.candidate_clips(config, stem)
    if candidates:
        print("Candidates (c#):")
    for i, clip in enumerate(candidates):
        row = publish_log.clip_row(stem, clip, "candidate", "skipped", None, None)
        length = float(clip["end"]) - float(clip["start"])
        status = _describe(decided.get(publish_log.decision_key(row)))
        print(f"  c{i:<2} {float(clip['start']):8.1f}s {length:4.0f}s  {clip.get('headline', '')}"
              + ("" if status == "-" else f"  -> {status}"))
    for d in decided.values():
        if d["source"] == "untracked":
            print(f"  untracked: {d['headline']} -> {_describe(d)}")
    return 0


def _decide(config: dict, args: argparse.Namespace, decision: str) -> int:
    youtube = getattr(args, "youtube", None)
    if decision == "published" and not youtube:
        raise ValueError("publish needs the Short's YouTube URL or ID")
    if args.clip == "rest":
        rows = publish_log.mark_rest(config, args.stem, decision, reason=args.reason)
    elif args.clip.lower().startswith("c"):
        rows = [publish_log.mark_candidate(config, args.stem, int(args.clip[1:]), decision, youtube, args.reason)]
    else:
        rows = [publish_log.mark_rendered(config, args.stem, int(args.clip), decision, youtube, args.reason)]
    for row in rows:
        print(f"{row['stem']} {row['decision']}: {row['headline']}")
    if not rows:
        print("Nothing to do: every rendered clip already has a decision.")
    return 0


def _report(config: dict) -> int:
    print(json.dumps(publish_log.report(config, publish_log.tracked_stems(config)), indent=2))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=str(ROOT / "config.json"))
    sub = ap.add_subparsers(dest="command", required=True)

    p = sub.add_parser("list", help="show rendered clips, candidates, and decisions")
    p.add_argument("stem")

    for name in ("publish", "skip"):
        p = sub.add_parser(name, help=f"mark a clip {name}{'ed' if name == 'publish' else 'ped'}")
        p.add_argument("stem")
        p.add_argument("clip", help="rendered clip number (NN- prefix), c<candidate#>, or 'rest'")
        if name == "publish":
            p.add_argument("youtube", help="the Short's YouTube URL or video ID")
        p.add_argument("--reason")

    p = sub.add_parser("untracked", help="record a published Short whose clip is gone")
    p.add_argument("stem")
    p.add_argument("label", help="the bit's name, e.g. 'Bingo Card'")
    p.add_argument("youtube")
    p.add_argument("--note")

    sub.add_parser("report", help="per-episode counts")

    args = ap.parse_args()
    config = _load_config(Path(args.config))
    require_data_dir()
    try:
        if args.command == "list":
            return _list(config, args.stem)
        if args.command == "publish":
            return _decide(config, args, "published")
        if args.command == "skip":
            return _decide(config, args, "skipped")
        if args.command == "untracked":
            row = publish_log.mark_untracked(config, args.stem, args.label, args.youtube, args.note)
            print(f"{row['stem']} published (untracked): {row['headline']}")
            return 0
        return _report(config)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
