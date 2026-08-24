#!/usr/bin/env python3
"""Capture real, rendered story pages by driving the actual live app.

Same approach as scripts/capture-word-pages.py, adapted for stories:trigger
the app's own fetchAndLoadStoryData() + displayStory() and save exactly what
they render. No race condition to work around here (unlike words) — nothing
auto-triggers on a plain navigation, so data loading is fully sequenced by
this script rather than raced against the page's own init.

Usage:
    python3 scripts/capture-story-pages.py --titles "Svarte hull"
    python3 scripts/capture-story-pages.py --batch-test
    python3 scripts/capture-story-pages.py --all
"""

from __future__ import annotations

import argparse
import csv
import http.server
import json
import re
import socket
import sys
import tempfile
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STORIES_CSV = ROOT / "norwegianStories.csv"
PRODUCTION_ORIGIN = "https://osloandrew.github.io"
SITE_PATH = "/norwegian/"
# From story/<slug>/, this reaches the site root under both GitHub Pages and
# a repository-root local preview.
PAGE_BASE_HREF = "../../"

BATCH_TEST_TITLES = None  # filled in from CSV in main() — first 3 + any with special chars


def slugify(word: str) -> str:
    word = (word or "").strip().lower()
    word = word.replace("’", "'")
    word = re.sub(r"[\s/]+", "-", word)
    word = "".join(ch for ch in word if ch.isalnum() or ch == "-")
    word = re.sub(r"-{2,}", "-", word)
    return word.strip("-")


def load_all_titles(csv_path: Path) -> list[str]:
    seen = {}
    with csv_path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            title = (row.get("titleNorwegian") or "").strip()
            if title and title.lower() not in seen:
                seen[title.lower()] = title
    return list(seen.values())


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        return


def start_server(root: Path, port: int) -> http.server.ThreadingHTTPServer:
    handler = lambda *args, **kwargs: QuietHandler(
        *args, directory=str(root), **kwargs
    )
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def capture(titles: list[str], output_root: Path = ROOT) -> None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print(
            "Playwright isn't installed. Run: pip3 install playwright && "
            "python3 -m playwright install chromium",
            file=sys.stderr,
        )
        sys.exit(1)

    tmp_dir_ctx = tempfile.TemporaryDirectory(prefix="norwegian-capture-")
    tmp_dir = Path(tmp_dir_ctx.name)
    (tmp_dir / "norwegian").symlink_to(ROOT)

    port = find_free_port()
    server = start_server(tmp_dir, port)
    origin = f"http://127.0.0.1:{port}"
    base_url = f"{origin}{SITE_PATH}"
    print(f"Serving {ROOT} at {base_url}")

    written = []
    skipped = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            console_errors = []
            page.on(
                "console",
                lambda msg: console_errors.append(msg.text)
                if msg.type == "error"
                else None,
            )

            # Plain navigation — stories.js's DOMContentLoaded handler only
            # auto-triggers for type=stories/story= in the URL, neither of
            # which is present here, so nothing races us.
            page.goto(f"{base_url}?type=words", wait_until="load")
            page.wait_for_function(
                "typeof fetchAndLoadStoryData === 'function'", timeout=15000
            )
            page.evaluate("() => fetchAndLoadStoryData()")
            story_count = page.evaluate("storyResults.length")
            print(f"Story data loaded ({story_count} stories).")

            for title in titles:
                slug = slugify(title)
                if not slug:
                    print(f"  SKIP {title!r}: empty slug")
                    skipped.append(title)
                    continue

                page.evaluate("(t) => { displayStory(t); }", title)
                page.wait_for_timeout(150)

                has_content = page.evaluate(
                    "document.getElementById('story-content').children.length > 0"
                )
                if not has_content:
                    print(f"  SKIP {title!r}: no story rendered")
                    skipped.append(title)
                    continue

                # The exact object fetchAndLoadStoryData() would produce for
                # this title — embedded so stories.js can render + wire up
                # this story immediately on load instead of waiting on the
                # full stories CSV fetch (see the DOMContentLoaded handler's
                # window.__PRELOADED_STORY__ check in stories.js). Reusing
                # the live object (rather than re-deriving it from the CSV
                # in Python) guarantees identical field shape to whatever a
                # real fetch would produce.
                story_data = page.evaluate(
                    "(t) => storyResults.find((s) => s.titleNorwegian === t)",
                    title,
                )

                html = page.evaluate("document.documentElement.outerHTML")
                # </script> inside the JSON (e.g. in story text) would
                # otherwise terminate this script tag early.
                preload_json = json.dumps(story_data, ensure_ascii=False).replace(
                    "</", "<\\/"
                )
                html = html.replace(
                    "<head>",
                    f'<head>\n    <base href="{PAGE_BASE_HREF}">'
                    f'\n    <script>window.__PRELOADED_STORY__ = {preload_json};</script>',
                    1,
                )
                html = html.replace(origin, PRODUCTION_ORIGIN)

                out_dir = output_root / "story" / slug
                out_dir.mkdir(parents=True, exist_ok=True)
                (out_dir / "index.html").write_text(
                    "<!doctype html>\n" + html, encoding="utf-8"
                )
                print(f"  OK   {title!r} -> story/{slug}/index.html")
                written.append(title)

            browser.close()

            if console_errors:
                print("\nBrowser console errors seen during capture:")
                for err in console_errors[:20]:
                    print(f"  {err}")
    finally:
        server.shutdown()
        tmp_dir_ctx.cleanup()

    print(f"\nWrote {len(written)} page(s), skipped {len(skipped)}.")
    if skipped:
        print("Skipped:", ", ".join(skipped))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--batch-test", action="store_true")
    group.add_argument("--titles", nargs="+")
    group.add_argument("--all", action="store_true")
    parser.add_argument(
        "--output-root",
        type=Path,
        default=ROOT,
        help="Site root beneath which story/<slug>/index.html is written.",
    )
    args = parser.parse_args()

    all_titles = load_all_titles(STORIES_CSV)

    if args.batch_test:
        # First 2 plus anything with an apostrophe/quote or accented char —
        # same "diverse small sample first" discipline as the word capture.
        special = [
            t for t in all_titles
            if any(ch in t for ch in "'’") or any(ord(ch) > 127 for ch in t)
        ][:2]
        titles = all_titles[:2] + special
    elif args.titles:
        titles = args.titles
    else:
        titles = all_titles

    capture(titles, args.output_root.resolve())


if __name__ == "__main__":
    main()
