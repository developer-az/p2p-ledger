#!/usr/bin/env python3
"""Remove AI tool commit trailers from a message file or stdin.

The commit-msg hook uses this in agent-only mode (Cursor / Claude / Made-with).
History rewrites use scripts/strip-commit-trailers.py (broader).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

_AGENT_TRAILER = re.compile(
    r"^\s*("
    r"claude-session:"
    r"|made-with:\s*cursor\s*"
    r"|co-authored-by:\s*cursor\b"
    r"|co-authored-by:.*@anthropic\.com"
    r")",
    re.IGNORECASE,
)


def clean_agent_trailers(raw: str) -> str:
    kept: list[str] = []
    for line in raw.splitlines():
        if _AGENT_TRAILER.match(line):
            continue
        kept.append(line)
    while kept and kept[-1] == "":
        kept.pop()
    if not kept:
        return ""
    return "\n".join(kept) + "\n"


def main() -> None:
    if len(sys.argv) >= 2:
        path = Path(sys.argv[1])
        text = path.read_text(encoding="utf-8")
        path.write_text(clean_agent_trailers(text), encoding="utf-8", newline="\n")
        return
    sys.stdout.write(clean_agent_trailers(sys.stdin.read()))


if __name__ == "__main__":
    main()
