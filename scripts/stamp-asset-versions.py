#!/usr/bin/env python3
"""Stamp index.html's ``?v=`` cache-busting query strings from file content.

Every local <script src="…?v=XXXX"> and <link href="…?v=XXXX"> in index.html
used to share one hand-typed version string that had to be bumped by hand on
every deploy. Miss a line, or forget to bump it at all, and a returning
visitor's browser silently keeps serving a stale cached copy of that file.

This script replaces that by deriving each asset's version from its own
content: a short SHA-256 hash of the file's current bytes. Nothing to
remember — an unchanged file keeps its existing query string (so browser
caches for OTHER files aren't invalidated for no reason), and a changed file
gets a new one automatically. Run it before every deploy:

    python3 scripts/stamp-asset-versions.py
"""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX_HTML = ROOT / "index.html"
HASH_LENGTH = 10

# Matches src="foo.js?v=XXXX" or href="foo.css?v=XXXX" for a local file
# (no scheme/host — leaves CDN URLs like Google Fonts alone).
ASSET_REF_PATTERN = re.compile(
    r'((?:src|href)=")([^":?]+\.(?:js|css))\?v=[^"]*(")'
)


def content_hash(path: Path) -> str:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return digest[:HASH_LENGTH]


def stamp(html: str, *, check_only: bool) -> tuple[str, list[str]]:
    changes: list[str] = []
    missing: list[str] = []

    def replace(match: re.Match) -> str:
        prefix, rel_path, suffix = match.groups()
        asset_path = ROOT / rel_path
        if not asset_path.is_file():
            missing.append(rel_path)
            return match.group(0)

        new_version = content_hash(asset_path)
        old_ref = match.group(0)
        new_ref = f"{prefix}{rel_path}?v={new_version}{suffix}"
        if old_ref != new_ref:
            changes.append(f"{rel_path}: {old_ref.split('v=')[-1][:-1]} -> {new_version}")
        return new_ref

    new_html = ASSET_REF_PATTERN.sub(replace, html)

    if missing:
        for rel_path in missing:
            print(f"warning: referenced asset not found on disk: {rel_path}", file=sys.stderr)

    return new_html, changes


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit non-zero if index.html isn't already up to date, without writing.",
    )
    args = parser.parse_args()

    # newline="" disables universal-newline translation on both ends, so
    # index.html's existing CRLF line endings round-trip unchanged instead
    # of silently turning into LF and rewriting every line in the diff.
    with open(INDEX_HTML, encoding="utf-8", newline="") as f:
        html = f.read()
    new_html, changes = stamp(html, check_only=args.check)

    if not changes:
        print("All asset versions already up to date.")
        return 0

    if args.check:
        print("Out of date — the following assets need re-stamping:")
        for change in changes:
            print(f"  {change}")
        return 1

    with open(INDEX_HTML, "w", encoding="utf-8", newline="") as f:
        f.write(new_html)
    print(f"Updated {len(changes)} asset version(s) in index.html:")
    for change in changes:
        print(f"  {change}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
