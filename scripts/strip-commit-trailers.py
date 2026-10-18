#!/usr/bin/env python3
"""Strip Claude (and similar) git commit trailers from stdin; write cleaned message to stdout.

Used with: git filter-branch --msg-filter "python scripts/strip-commit-trailers.py"
Or install git-filter-repo and use in --commit-callback.
"""
from __future__ import annotations

import re
import sys

_TRAILER_LINE = re.compile(r"^\s*(co-authored-by|claude-session):", re.IGNORECASE)


def clean_message(raw: str) -> str:
    kept: list[str] = []
    for line in raw.splitlines():
        if _TRAILER_LINE.match(line):
            continue
        kept.append(line)
    while kept and kept[-1] == "":
        kept.pop()
    if not kept:
        return ""
    return "\n".join(kept) + "\n"


def main() -> None:
    text = sys.stdin.read()
    sys.stdout.write(clean_message(text))


if __name__ == "__main__":
    main()
