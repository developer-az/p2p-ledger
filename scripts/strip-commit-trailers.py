#!/usr/bin/env python3
"""Strip Claude (and similar) git commit trailers from stdin; write cleaned message to stdout.

Used with: git filter-branch --msg-filter "python scripts/strip-commit-trailers.py"
Or install git-filter-repo and use in --commit-callback.
"""
from __future__ import annotations

import sys

DROP_PREFIXES = (
    "Co-Authored-By:",
    "Claude-Session:",
)


def clean_message(raw: str) -> str:
    lines = raw.splitlines()
    kept: list[str] = []
    for line in lines:
        if any(line.startswith(p) for p in DROP_PREFIXES):
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
