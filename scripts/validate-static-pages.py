#!/usr/bin/env python3
"""Validate exact captured-page completeness and shared-app integrity."""

from __future__ import annotations

import argparse
import csv
import html
import json
import re
import sys
import urllib.parse
import xml.etree.ElementTree as ET
from pathlib import Path

from story_sources import existing_story_csv_paths

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://osloandrew.github.io/norwegian"
FEATURE_PAGES = {
    "sentences": "Results for",
    "word-game": "Preparing Word Game",
    "pronunciation": "sentence-box-practice",
}
LOCAL_ASSET_RE = re.compile(r'(?:src|href)="([^":?#]+\.(?:js|css)(?:\?v=[^"]*)?)"')
CANONICAL_RE = re.compile(r'<link rel="canonical" href="([^"]+)">')


class ValidationError(RuntimeError):
    pass


def slugify(value: str) -> str:
    value = (value or "").strip().lower().replace("’", "'")
    value = re.sub(r"[\s/]+", "-", value)
    value = "".join(character for character in value if character.isalnum() or character == "-")
    return re.sub(r"-{2,}", "-", value).strip("-")


def source_values(path: Path, column: str, *, primary_word: bool = False) -> dict[str, str]:
    values: dict[str, str] = {}
    with path.open(encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            value = (row.get(column) or "").strip()
            if primary_word:
                value = value.split(",", 1)[0].strip()
            if value:
                values[slugify(value)] = value
    return values


def page_slugs(site_root: Path, folder: str) -> set[str]:
    directory = site_root / folder
    if not directory.is_dir():
        raise ValidationError(f"Missing {folder}/ directory")
    items = [item for item in directory.iterdir() if not item.name.startswith(".")]
    unexpected = [item for item in items if not item.is_dir() or not (item / "index.html").is_file()]
    if unexpected:
        raise ValidationError(f"Unexpected generated-page entries: {unexpected[:3]}")
    return {item.name for item in items}


def local_assets(html_source: str) -> set[str]:
    return set(LOCAL_ASSET_RE.findall(html_source))


def validate_page(
    path: Path,
    canonical: str,
    shared_assets: set[str],
    required_text: str,
    expected_base_href: str,
) -> None:
    source = path.read_text(encoding="utf-8")
    canonical_match = CANONICAL_RE.search(source)
    if not canonical_match or urllib.parse.unquote(canonical_match.group(1)) != canonical:
        raise ValidationError(f"Wrong canonical URL in {path}")
    if f'<base href="{expected_base_href}">' not in source:
        raise ValidationError(f"Wrong directory-relative site base in {path}")
    if not shared_assets.issubset(local_assets(source)):
        missing = sorted(shared_assets - local_assets(source))
        raise ValidationError(f"{path} is missing shared app assets: {missing[:5]}")
    if html.escape(required_text, quote=False) not in source:
        raise ValidationError(f"{path} does not contain its rendered source content")
    for required_id in ('id="search-container"', 'id="results-container"'):
        if required_id not in source:
            raise ValidationError(f"{path} is missing the application shell element {required_id}")


def validate(source_root: Path, site_root: Path) -> tuple[int, int, int]:
    words = source_values(source_root / "norwegianWords.csv", "ord", primary_word=True)
    stories: dict[str, str] = {}
    for story_csv_path in existing_story_csv_paths(source_root):
        stories.update(source_values(story_csv_path, "titleNorwegian"))
    generated_words = page_slugs(site_root, "word")
    generated_stories = page_slugs(site_root, "story")
    if generated_words != set(words):
        raise ValidationError(
            f"Word pages differ from source (missing {len(set(words) - generated_words)}, stale {len(generated_words - set(words))})"
        )
    if generated_stories != set(stories):
        raise ValidationError(
            f"Story pages differ from source (missing {len(set(stories) - generated_stories)}, stale {len(generated_stories - set(stories))})"
        )

    manifest = json.loads((site_root / "page-manifest.json").read_text(encoding="utf-8"))
    if manifest.get("words") != sorted(generated_words) or manifest.get("stories") != sorted(generated_stories):
        raise ValidationError("Page manifest does not exactly match captured pages")

    locations = [node.text for node in ET.parse(site_root / "sitemap.xml").getroot().findall("{*}url/{*}loc")]
    if len(locations) != len(set(locations)):
        raise ValidationError("Sitemap contains duplicate URLs")
    expected_urls = {
        *(f"{SITE}/word/{slug}/" for slug in words),
        *(f"{SITE}/story/{slug}/" for slug in stories),
        f"{SITE}/stories/",
        f"{SITE}/updates/",
        *(f"{SITE}/{feature}/" for feature in FEATURE_PAGES),
    }
    if not expected_urls.issubset(set(locations)):
        raise ValidationError("Sitemap is missing captured-page URLs")
    if any("?type=" in location for location in locations):
        raise ValidationError("Sitemap still contains a query-string feature URL")

    updates_page = site_root / "updates" / "index.html"
    if not updates_page.is_file():
        raise ValidationError("Missing generated Updates page")
    updates_source = updates_page.read_text(encoding="utf-8")
    if f'<link rel="canonical" href="{SITE}/updates/">' not in updates_source:
        raise ValidationError("Updates page has the wrong canonical URL")
    if '<base href="../">' not in updates_source or "What's New" not in updates_source:
        raise ValidationError("Updates page is missing its crawlable content or site base")

    index_source = (source_root / "index.html").read_text(encoding="utf-8")
    shared_assets = local_assets(index_source)
    # Every page is captured from this shell. Checking all 29k documents is
    # intentional: a partial or interrupted build must never deploy.
    for slug, word in words.items():
        page = site_root / "word" / slug / "index.html"
        validate_page(
            page,
            f"{SITE}/word/{slug}/",
            shared_assets,
            word,
            "../../",
        )
        page_source = page.read_text(encoding="utf-8")
        if '<h1 class="word-gender' not in page_source or page_source.count("<h1") != 1:
            raise ValidationError(f"Word content heading is not the page H1 in {page}")
    for slug, title in stories.items():
        page = site_root / "story" / slug / "index.html"
        validate_page(page, f"{SITE}/story/{slug}/", shared_assets, title, "../../")
        page_source = page.read_text(encoding="utf-8")
        if "window.__PRELOADED_STORY__" not in page_source:
            raise ValidationError(f"Story preload is missing from {page}")
        if (
            '<h1 lang="nb" class="sticky-title-japanese">' not in page_source
            or page_source.count("<h1") != 1
        ):
            raise ValidationError(f"Story content heading is not the page H1 in {page}")

    stories_index = site_root / "stories" / "index.html"
    validate_page(
        stories_index,
        f"{SITE}/stories/",
        shared_assets,
        next(iter(stories.values())),
        "../",
    )
    for feature, required_text in FEATURE_PAGES.items():
        validate_page(
            site_root / feature / "index.html",
            f"{SITE}/{feature}/",
            shared_assets,
            required_text,
            "../",
        )
    return len(words), len(stories), len(locations)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=ROOT)
    parser.add_argument("--site-root", type=Path, default=ROOT)
    args = parser.parse_args()
    try:
        word_count, story_count, url_count = validate(args.source_root.resolve(), args.site_root.resolve())
    except (ValidationError, OSError, json.JSONDecodeError, ET.ParseError) as error:
        print(f"Static page validation failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
    print(f"Validated {word_count} exact word pages, {story_count} exact story pages, and {url_count} sitemap URLs.")


if __name__ == "__main__":
    main()
