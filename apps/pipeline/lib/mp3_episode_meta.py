"""Read episode number and title from audio file tags (ID3 / common easy tags)."""

from __future__ import annotations

import re
from pathlib import Path


class EpisodeMetadataError(ValueError):
    """Raised when required episode metadata cannot be read from the file."""


def _parse_int_from_tag(text: str | None) -> int | None:
    if not text:
        return None
    text = str(text).strip()
    if not text:
        return None
    # "5", "5/12", "Episode 12"
    m = re.search(r"\d+", text)
    if not m:
        return None
    return int(m.group(0))


# Hyphen-minus, en dash, em dash (common in Finder / Music title fields)
_TITLE_EPISODE_PREFIX = re.compile(
    r"^\s*(\d+)\s*(?:-|–|—)\s*(.+)$",
    re.UNICODE,
)


def _parse_episode_from_title_prefix(raw_title: str) -> tuple[int, str] | None:
    """
    Parse leading episode number from title, e.g. '24 - Parrot Radio' -> (24, 'Parrot Radio').
    Returns None if the pattern does not match or the remainder is empty.
    """
    m = _TITLE_EPISODE_PREFIX.match(raw_title.strip())
    if not m:
        return None
    rest = m.group(2).strip()
    if not rest:
        return None
    return int(m.group(1)), rest


def _strip_redundant_title_prefix(title: str, episode_number: int) -> str:
    """If title is '24 - Foo' and episode_number is 24, return 'Foo'."""
    parsed = _parse_episode_from_title_prefix(title)
    if parsed is not None and parsed[0] == episode_number:
        return parsed[1]
    return title


def read_episode_metadata_from_audio(path: Path) -> tuple[int, str]:
    """
    Return (episode_number, title) from embedded tags.

    Episode number: TXXX (episode / episodenumber / …), else TRCK / tracknumber (easy),
    else a leading 'N - Title' or 'N – Title' pattern in the title field (TIT2 / title).
    Title: TIT2; redundant 'N -' prefix is dropped when it matches the episode number.
    """
    from mutagen import File as MutagenFile
    from mutagen.id3 import TXXX
    from mutagen.mp3 import MP3

    path = Path(path)
    if not path.is_file():
        raise EpisodeMetadataError(f"Audio file not found: {path}")

    suffix = path.suffix.lower()
    episode_number: int | None = None
    title: str | None = None

    if suffix == ".mp3":
        audio = MP3(path)
        tags = audio.tags
        if tags is not None:
            tit2 = tags.get("TIT2")
            if tit2 and getattr(tit2, "text", None):
                title = str(tit2.text[0]).strip() or None

            trck = tags.get("TRCK")
            if trck and getattr(trck, "text", None):
                episode_number = _parse_int_from_tag(str(trck.text[0]))

            for frame in tags.values():
                if isinstance(frame, TXXX) and frame.text:
                    desc = (frame.desc or "").strip().lower()
                    if desc in ("episode", "episodenumber", "episode number", "epnum", "ep"):
                        n = _parse_int_from_tag(str(frame.text[0]))
                        if n is not None:
                            episode_number = n
                            break
    else:
        audio = MutagenFile(path, easy=True)
        if audio is not None:
            tn = audio.get("tracknumber")
            if tn:
                episode_number = _parse_int_from_tag(tn[0] if isinstance(tn, list) else tn)
            tit = audio.get("title")
            if tit:
                title = (tit[0] if isinstance(tit, list) else tit).strip() or None

    if episode_number is None and title:
        parsed = _parse_episode_from_title_prefix(title)
        if parsed is not None:
            episode_number, title = parsed

    if episode_number is None:
        raise EpisodeMetadataError(
            f"No episode number in tags for {path.name}. "
            "Set TRCK, TXXX:episode, or a title like '42 - Episode Title'."
        )

    if not title:
        title = path.stem
    else:
        title = _strip_redundant_title_prefix(title, episode_number)

    return episode_number, title
