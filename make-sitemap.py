#!/usr/bin/env python3
"""
Generate a sitemap.xml for the Norwegian learning app.

- Reads norwegianWords.csv and norwegianStories.csv
- Builds URLs for words and stories
- Outputs a valid XML sitemap (UTF-8 encoded)
"""

import csv
import urllib.parse
import html
from pathlib import Path

# --- CONFIGURATION ---
SITE = "https://osloandrew.github.io/norwegian"
WORDS_CSV = Path("norwegianWords.csv")
STORIES_CSV = Path("norwegianStories.csv")
OUTPUT_FILE = Path("sitemap.xml")


def build_word_urls(csv_path: Path) -> list[str]:
    """Parse words CSV and return a list of word URLs."""
    urls = []
    if not csv_path.exists():
        print(f"⚠️ Missing {csv_path}, skipping words.")
        return urls

    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            word = (row.get("ord") or "").split(",")[0].strip()
            pos = (row.get("gender") or "").strip()  # 'verb', 'en', 'expression', etc.

            if not word:
                continue

            if pos:
                url = (
                    f"{SITE}/?type=words"
                    f"&pos={urllib.parse.quote(pos)}"
                    f"&word={urllib.parse.quote(word)}"
                )
            else:
                url = f"{SITE}/?type=words&word={urllib.parse.quote(word)}"

            urls.append(url)
    return urls


def build_story_urls(csv_path: Path) -> list[str]:
    """Parse stories CSV and return a list of story URLs."""
    urls = []
    if not csv_path.exists():
        print(f"⚠️ Missing {csv_path}, skipping stories.")
        return urls

    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            title = (row.get("titleNorwegian") or "").strip()
            if not title:
                continue

            url = f"{SITE}/?type=story&story={urllib.parse.quote(title)}"
            urls.append(url)
    return urls


def write_sitemap(urls: list[str], output_file: Path) -> None:
    """Write URLs into sitemap.xml with proper escaping."""
    with output_file.open("w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        f.write('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')

        for u in urls:
            safe_url = html.escape(u, quote=True)
            f.write(f"  <url>\n    <loc>{safe_url}</loc>\n  </url>\n")

        f.write("</urlset>\n")

    print(f"✅ Wrote sitemap.xml with {len(urls)} URLs")


def main():
    urls = []
    urls.extend(build_word_urls(WORDS_CSV))
    urls.extend(build_story_urls(STORIES_CSV))

    if not urls:
        print("⚠️ No URLs generated — check your CSVs.")
        return

    write_sitemap(urls, OUTPUT_FILE)


if __name__ == "__main__":
    main()