#!/usr/bin/env python3
"""Build every crawlable page by capturing the real rendered application.

This is the canonical production build. It deliberately delegates rendering
to the same JavaScript functions visitors use; the generated documents are
not a second, simplified implementation of the UI.
"""

from __future__ import annotations

import argparse
import csv
import re
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


class BuildError(RuntimeError):
    pass


def slugify(value: str) -> str:
    value = (value or "").strip().lower().replace("’", "'")
    value = re.sub(r"[\s/]+", "-", value)
    value = "".join(character for character in value if character.isalnum() or character == "-")
    return re.sub(r"-{2,}", "-", value).strip("-")


def source_slugs(csv_path: Path, column: str, *, primary_word: bool = False) -> set[str]:
    slugs: dict[str, str] = {}
    with csv_path.open(encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            value = (row.get(column) or "").strip()
            if primary_word:
                value = value.split(",", 1)[0].strip()
            if not value:
                continue
            current_slug = slugify(value)
            if not current_slug:
                raise BuildError(f"{csv_path.name}: {value!r} produces an empty slug")
            previous = slugs.get(current_slug)
            if previous is not None and previous.casefold() != value.casefold():
                raise BuildError(
                    f"{csv_path.name}: {previous!r} and {value!r} both produce /{current_slug}/"
                )
            slugs[current_slug] = value
    return set(slugs)


def prune_stale_pages(directory: Path, expected_slugs: set[str]) -> list[Path]:
    """Remove only generated slug directories absent from current source data."""
    removed: list[Path] = []
    if not directory.exists():
        return removed
    if directory.is_symlink() or not directory.is_dir():
        raise BuildError(f"Refusing to prune non-directory target: {directory}")
    for child in directory.iterdir():
        if child.name.startswith("."):
            continue
        if not child.is_dir() or child.is_symlink():
            raise BuildError(f"Unexpected item in generated page directory: {child}")
        if child.name not in expected_slugs:
            shutil.rmtree(child)
            removed.append(child)
    return removed


def run(command: list[str], *, cwd: Path = ROOT) -> None:
    print("+", " ".join(command), flush=True)
    subprocess.run(command, cwd=cwd, check=True)


def build(site_root: Path, *, prune: bool = True, stamp_assets: bool = True) -> None:
    site_root = site_root.resolve()
    if stamp_assets:
        run([sys.executable, "scripts/stamp-asset-versions.py"])

    word_slugs = source_slugs(ROOT / "norwegianWords.csv", "ord", primary_word=True)
    story_slugs = source_slugs(ROOT / "norwegianStories.csv", "titleNorwegian")
    if prune:
        removed_words = prune_stale_pages(site_root / "word", word_slugs)
        removed_stories = prune_stale_pages(site_root / "story", story_slugs)
        print(f"Pruned {len(removed_words)} stale word page(s) and {len(removed_stories)} stale story page(s).")

    run([sys.executable, "scripts/capture-word-pages.py", "--all", "--output-root", str(site_root)])
    run([sys.executable, "scripts/capture-story-pages.py", "--all", "--output-root", str(site_root)])

    # The list capture converts its links to pretty paths only when the
    # manifest confirms those pages exist, so generate the manifest first.
    run([sys.executable, "make-sitemap.py", "--site-root", str(site_root)])
    run([sys.executable, "scripts/build-stories-index.py", "--output-root", str(site_root)])
    # Regenerate once more after every page family is complete. This is
    # intentionally cheap and makes the final output self-consistent.
    run([sys.executable, "make-sitemap.py", "--site-root", str(site_root)])
    run(
        [
            sys.executable,
            "scripts/validate-static-pages.py",
            "--site-root",
            str(site_root),
        ]
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--site-root",
        type=Path,
        default=ROOT,
        help="Deployment checkout into which exact captured pages are written.",
    )
    parser.add_argument("--no-prune", action="store_true", help="Keep stale generated slug directories")
    parser.add_argument("--no-stamp", action="store_true", help="Do not refresh shared asset hashes first")
    args = parser.parse_args()
    try:
        build(args.site_root, prune=not args.no_prune, stamp_assets=not args.no_stamp)
    except (BuildError, OSError, subprocess.CalledProcessError) as error:
        print(f"Static page build failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
