"""Hide secret values in a process's output before it is shown or kept.

Standard library only. The values come from whoever holds them (the pipeline's
own process, which loads ``.env``); this module only replaces each one with its
name in brackets.
"""
from __future__ import annotations

import re
from typing import Dict, Iterable, Mapping, Optional, Tuple, Union

# Shorter values are settings such as a TTL of 900, not secrets, and hiding them
# would garble every log line with that number in it.
MIN_LENGTH = 8
# A line this long with no end is let out in pieces, so a live log keeps moving.
HOLD_BYTES = 4096


Secrets = Union[Mapping[str, str], Iterable[Tuple[str, str]]]  # by name, or (name, value) pairs


def _pattern(secrets: Secrets, min_length: int) -> "tuple[Optional[re.Pattern], Dict[bytes, bytes], int]":
    names: Dict[bytes, bytes] = {}
    for name, value in secrets.items() if isinstance(secrets, Mapping) else secrets:
        for line in str(value or "").splitlines():  # a value never matches across a line break
            line = line.strip()
            if len(line) >= min_length:
                names.setdefault(line.encode("utf-8"), f"[{name}]".encode("utf-8"))
    if not names:
        return None, names, 0
    ordered = sorted(names, key=len, reverse=True)  # the longer of two overlapping values wins
    return re.compile(b"|".join(re.escape(value) for value in ordered)), names, len(ordered[0])


class Redactor:
    """Redact a stream fed in pieces: a value split across two reads is still found."""

    def __init__(self, secrets: Secrets, min_length: int = MIN_LENGTH):
        self._pattern, self._names, self._longest = _pattern(secrets, min_length)
        self._held = b""

    def _sub(self, data: bytes) -> bytes:
        return self._pattern.sub(lambda match: self._names[match.group(0)], data) if self._pattern else data

    def feed(self, data: bytes) -> bytes:
        """What can be let out now: finished lines, and any part too far back to start a value."""
        held = self._held + data
        if self._pattern is None:
            self._held = b""
            return held
        cut = max(held.rfind(b"\n"), held.rfind(b"\r")) + 1
        if len(held) - cut > HOLD_BYTES:
            cut = len(held) - (self._longest - 1)
        for match in self._pattern.finditer(held):
            if match.start() < cut < match.end():
                cut = match.end()  # never let out half a value
        self._held = held[cut:]
        return self._sub(held[:cut])

    def flush(self) -> bytes:
        held, self._held = self._held, b""
        return self._sub(held)


def redact(text: str, secrets: Secrets, min_length: int = MIN_LENGTH) -> str:
    redactor = Redactor(secrets, min_length)
    return (redactor.feed(text.encode("utf-8")) + redactor.flush()).decode("utf-8")
