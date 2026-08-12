#!/usr/bin/env python3
"""
Generate a complete, deduplicated sitemap for the Norwegian learning app.

- Reads norwegianWords.csv and norwegianStories.csv
- Adds the site's primary feature pages
- Builds canonical word and story URLs
- Removes duplicate URLs while preserving their original order
- Validates the finished XML before replacing sitemap.xml
"""

import csv
import re
import urllib.parse
import xml.etree.ElementTree as ET
from pathlib import Path

SITE = "https://osloandrew.github.io/norwegian"

WORDS_CSV = Path("norwegianWords.csv")
STORIES_CSV = Path("norwegianStories.csv")
OUTPUT_FILE = Path("sitemap.xml")

SITEMAP_NAMESPACE = "http://www.sitemaps.org/schemas/sitemap/0.9"
MAX_SITEMAP_URLS = 50_000
MAX_SITEMAP_BYTES = 50 * 1024 * 1024

CORE_URLS = [
    f"{SITE}/",
    f"{SITE}/?type=word-list",
    f"{SITE}/?type=sentences",
    f"{SITE}/?type=stories",
    f"{SITE}/?type=word-game",
    f"{SITE}/?type=pronunciation",
]


def require_file(path: Path) -> None:
    """Stop instead of accidentally producing an incomplete sitemap."""
    if not path.is_file():
        raise FileNotFoundError(f"Required file is missing: {path}")


def build_query_url(parameters: dict[str, str]) -> str:
    """Build a consistently encoded URL using normal query parameters."""
    query = urllib.parse.urlencode(
        parameters,
        quote_via=urllib.parse.quote,
        safe="",
    )

    return f"{SITE}/?{query}"


def normalize_pos(value: str) -> str:
    """Mirror the part-of-speech normalization used by scripts.js."""
    normalized = value.strip().lower()

    return re.sub(r"^noun\s*-\s*", "", normalized)


def build_word_urls(csv_path: Path) -> list[str]:
    """Build one canonical definition URL for each CSV entry."""
    require_file(csv_path)

    urls = []

    with csv_path.open(newline="", encoding="utf-8") as file:
        reader = csv.DictReader(file)

        for row in reader:
            word = (row.get("ord") or "").split(",")[0].strip()
            pos = normalize_pos(row.get("gender") or "")

            if not word:
                continue

            parameters = {"type": "words"}

            if pos:
                parameters["pos"] = pos

            parameters["word"] = word

            urls.append(build_query_url(parameters))

    return urls


def build_story_urls(csv_path: Path) -> list[str]:
    """Build one canonical URL for each Norwegian story."""
    require_file(csv_path)

    urls = []

    with csv_path.open(newline="", encoding="utf-8") as file:
        reader = csv.DictReader(file)

        for row in reader:
            title = (row.get("titleNorwegian") or "").strip()

            if not title:
                continue

            urls.append(
                build_query_url(
                    {
                        "type": "story",
                        "story": title,
                    }
                )
            )

    return urls


def deduplicate_urls(urls: list[str]) -> list[str]:
    """Remove duplicate URLs without changing their original order."""
    return list(dict.fromkeys(urls))


def write_sitemap(urls: list[str], output_file: Path) -> None:
    """Create and validate the XML before replacing the existing sitemap."""
    if len(urls) > MAX_SITEMAP_URLS:
        raise ValueError(
            f"Sitemap contains {len(urls)} URLs; "
            f"the maximum is {MAX_SITEMAP_URLS}."
        )

    ET.register_namespace("", SITEMAP_NAMESPACE)

    urlset = ET.Element(f"{{{SITEMAP_NAMESPACE}}}urlset")

    for page_url in urls:
        url_element = ET.SubElement(
            urlset,
            f"{{{SITEMAP_NAMESPACE}}}url",
        )

        location_element = ET.SubElement(
            url_element,
            f"{{{SITEMAP_NAMESPACE}}}loc",
        )

        location_element.text = page_url

    tree = ET.ElementTree(urlset)
    ET.indent(tree, space="  ")

    temporary_file = output_file.with_suffix(".xml.tmp")

    tree.write(
        temporary_file,
        encoding="utf-8",
        xml_declaration=True,
    )

    sitemap_size = temporary_file.stat().st_size

    if sitemap_size > MAX_SITEMAP_BYTES:
        temporary_file.unlink(missing_ok=True)

        raise ValueError(
            f"Sitemap is {sitemap_size} bytes; "
            f"the maximum is {MAX_SITEMAP_BYTES} bytes."
        )

    # This raises an error if the generated XML is invalid.
    ET.parse(temporary_file)

    temporary_file.replace(output_file)


def main() -> None:
    raw_urls = []

    raw_urls.extend(CORE_URLS)
    raw_urls.extend(build_word_urls(WORDS_CSV))
    raw_urls.extend(build_story_urls(STORIES_CSV))

    unique_urls = deduplicate_urls(raw_urls)
    duplicates_removed = len(raw_urls) - len(unique_urls)

    write_sitemap(unique_urls, OUTPUT_FILE)

    print(f"Wrote {OUTPUT_FILE} with {len(unique_urls)} unique URLs.")
    print(f"Removed {duplicates_removed} duplicate URLs.")


if __name__ == "__main__":
    main()