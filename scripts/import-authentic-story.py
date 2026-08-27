#!/usr/bin/env python3
"""Import one authentic, human-written story from a Store norske leksikon
family site (snl.no, lille.snl.no, nbl.snl.no, sml.snl.no) into
norwegianAuthenticStories.csv — a separate CSV from norwegianStories.csv,
which holds only originally-written (non-sourced) stories.

Each of these sites exposes an article as JSON at ``<slug>.json`` and marks
its own reuse status per article: `license_name` is "fri" (free, CC BY-SA
3.0) or "begrenset" (author's permission required). This importer refuses to
proceed on anything but "fri" text. Header images carry their OWN, separate
license per image (a "fri" article can still contain "Gjengitt med
tillatelse" — reproduced with permission, i.e. NOT freely reusable — images
alongside freely-licensed ones), so the image is selected independently: the
first image, in article order, whose license text matches a known-free
pattern. If none qualifies, no image is downloaded — the importer does not
guess.

This tool does not translate. Pass the reviewed English translation with
--english; the run aborts with the Norwegian text printed for translation if
it is omitted.

Usage:
    python3 scripts/import-authentic-story.py lille Plateosaurus \\
        --genre science --cefr A2 \\
        --title-english Plateosaurus \\
        --english "Plateosaurus was a plant-eating dinosaur ..."
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import re
import ssl
import sys
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

SITE_HOSTS = {
    "snl": "snl.no",
    "lille": "lille.snl.no",
    "nbl": "nbl.snl.no",
    "sml": "sml.snl.no",
}

DEFAULT_CSV = Path("norwegianAuthenticStories.csv")
IMAGES_DIR = Path("Resources/Images")

CSV_FIELDS = [
    "titleNorwegian",
    "titleEnglish",
    "genre",
    "CEFR",
    "norwegian",
    "english",
    "textSourceName",
    "textSourceUrl",
    "textSourceAuthor",
    "textSourceLicense",
    "imageSourceUrl",
    "imageLicense",
    "imageCredit",
    "notes",
]

FREE_IMAGE_LICENSE_RE = re.compile(
    r"cc\s*by|cc0|public domain|falt i det frie|creative commons",
    re.IGNORECASE,
)

BLOCK_TAGS = {"p", "h2", "h3", "h4", "li", "div", "br", "blockquote"}


class BlockTextExtractor(HTMLParser):
    """Strips tags from xhtml_body, keeping block-level tags as paragraph
    breaks internally; the caller joins paragraphs with a single space to
    match norwegianStories.csv's existing flowing-prose convention (no
    embedded line breaks in that column). Section headings (h2/h3/h4, e.g.
    "Beskrivelse", "Levevis", "Funn") are structural labels, not prose —
    their text is dropped rather than folded into the flowing body. Articles
    end with a standard back-matter section (e.g. "Les mer i Lille norske
    leksikon", a bare list of cross-reference links) introduced by one of
    these same heading tags; once one of BACK_MATTER_HEADINGS is seen,
    everything from there to the end of the document is dropped too."""

    HEADING_TAGS = {"h2", "h3", "h4"}
    BACK_MATTER_HEADINGS = {
        "les mer",
        "les mer i lille norske leksikon",
        "kilder",
        "eksterne lenker",
        "litteratur",
        "fotnoter",
        "se også",
    }

    def __init__(self) -> None:
        super().__init__()
        self.paragraphs: list[str] = [""]
        self._heading_buffer: str | None = None
        self._stopped = False

    def handle_starttag(self, tag: str, attrs) -> None:
        if self._stopped:
            return
        if tag in self.HEADING_TAGS:
            self._heading_buffer = ""
            return
        if tag in BLOCK_TAGS and self.paragraphs[-1].strip():
            self.paragraphs.append("")

    def handle_endtag(self, tag: str) -> None:
        if self._stopped:
            return
        if tag in self.HEADING_TAGS:
            heading_text = re.sub(r"\s+", " ", self._heading_buffer or "").strip()
            self._heading_buffer = None
            if heading_text.lower() in self.BACK_MATTER_HEADINGS:
                self._stopped = True
            return
        if tag in BLOCK_TAGS and self.paragraphs[-1].strip():
            self.paragraphs.append("")

    def handle_data(self, data: str) -> None:
        if self._stopped:
            return
        if self._heading_buffer is not None:
            self._heading_buffer += data
            return
        self.paragraphs[-1] += data

    def text(self) -> str:
        cleaned = [re.sub(r"\s+", " ", p).strip() for p in self.paragraphs]
        return " ".join(p for p in cleaned if p)


def http_get(url: str, timeout: int = 30) -> bytes:
    default_paths = ssl.get_default_verify_paths()
    system_ca = Path("/etc/ssl/cert.pem")
    ssl_context = (
        ssl.create_default_context(cafile=str(system_ca))
        if not default_paths.cafile and system_ca.is_file()
        else None
    )
    request = urllib.request.Request(url, headers={"User-Agent": "curl/8.0"})
    with urllib.request.urlopen(request, timeout=timeout, context=ssl_context) as response:
        return response.read()


def fetch_article(site: str, slug: str) -> dict:
    host = SITE_HOSTS[site]
    url = f"https://{host}/{slug}.json"
    payload = http_get(url)
    return json.loads(payload.decode("utf-8"))


def extract_body_text(xhtml_body: str) -> str:
    parser = BlockTextExtractor()
    parser.feed(xhtml_body or "")
    return html.unescape(parser.text())


def pick_free_image(images: list[dict]) -> dict | None:
    for image in images or []:
        license_text = str(image.get("license") or "")
        if FREE_IMAGE_LICENSE_RE.search(license_text):
            return image
    return None


def download_image(image: dict, title_english: str) -> str:
    url = image.get("full_size_url") or image.get("standard_size_url")
    if not url:
        raise ValueError("Selected image has no full_size_url or standard_size_url")

    extension = Path(urlsplit(url).path).suffix.lstrip(".").lower() or "jpg"
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    destination = IMAGES_DIR / f"{title_english}.{extension}"
    destination.write_bytes(http_get(url))
    return str(destination)


def load_existing_titles(csv_path: Path) -> set[tuple[str, str]]:
    if not csv_path.exists():
        return set()
    with csv_path.open(encoding="utf-8", newline="") as handle:
        return {
            (row["titleNorwegian"], row["titleEnglish"])
            for row in csv.DictReader(handle)
        }


def append_row(csv_path: Path, row: dict) -> None:
    is_new = not csv_path.exists()
    with csv_path.open("a", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
        if is_new:
            writer.writeheader()
        writer.writerow(row)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("site", choices=sorted(SITE_HOSTS))
    parser.add_argument("slug", help="Article slug/headword, e.g. Plateosaurus")
    parser.add_argument("--genre", required=True)
    parser.add_argument("--cefr", required=True)
    parser.add_argument("--title-norwegian", help="Defaults to the article's title field")
    parser.add_argument("--title-english", required=True)
    parser.add_argument("--english", help="Reviewed English translation of the adapted Norwegian text")
    parser.add_argument("--notes", default="")
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    parser.add_argument(
        "--skip-image",
        action="store_true",
        help="Do not attempt to download a header image even if one qualifies",
    )
    args = parser.parse_args()

    article = fetch_article(args.site, args.slug)

    license_name = article.get("license_name")
    if license_name != "fri":
        sys.exit(
            f"Refusing to import: {args.site}/{args.slug} has license_name="
            f"{license_name!r}, not \"fri\". This article requires the "
            f"author's direct permission to reuse."
        )

    title_norwegian = args.title_norwegian or article.get("title") or args.slug
    authors = ", ".join(a.get("full_name", "") for a in article.get("authors", []) if a.get("full_name"))
    source_url = article.get("url") or f"https://{SITE_HOSTS[args.site]}/{args.slug}"
    site_names = {
        "snl": "Store norske leksikon",
        "lille": "Lille norske leksikon",
        "nbl": "Norsk biografisk leksikon",
        "sml": "Store medisinske leksikon",
    }

    norwegian_text = extract_body_text(article.get("xhtml_body", ""))
    if not norwegian_text:
        sys.exit("Refusing to import: extracted Norwegian body text is empty.")

    if not args.english:
        print("No --english given. Norwegian text to translate:\n")
        print(norwegian_text)
        sys.exit(
            "\nAborting: pass --english \"<reviewed translation>\" and re-run "
            "(nothing was written)."
        )

    image_path = ""
    image_license = ""
    image_credit = ""
    if not args.skip_image:
        chosen_image = pick_free_image(article.get("images", []))
        if chosen_image:
            image_path = download_image(chosen_image, args.title_english)
            image_license = chosen_image.get("license", "")
            image_credit = chosen_image.get("copyright") or site_names[args.site]
            print(f"Saved header image: {image_path} ({image_license})")
        else:
            print("No freely-licensed image found on this article; skipping image.")

    row = {
        "titleNorwegian": title_norwegian,
        "titleEnglish": args.title_english,
        "genre": args.genre,
        "CEFR": args.cefr,
        "norwegian": norwegian_text,
        "english": args.english,
        "textSourceName": site_names[args.site],
        "textSourceUrl": source_url,
        "textSourceAuthor": authors,
        "textSourceLicense": "CC BY-SA 3.0",
        "imageSourceUrl": image_path,
        "imageLicense": image_license,
        "imageCredit": image_credit,
        "notes": args.notes,
    }

    existing = load_existing_titles(args.csv)
    if (row["titleNorwegian"], row["titleEnglish"]) in existing:
        sys.exit(
            f"Refusing to import: {args.csv} already has a row for "
            f"({row['titleNorwegian']!r}, {row['titleEnglish']!r})."
        )

    append_row(args.csv, row)
    print(f"Wrote 1 row to {args.csv}")


if __name__ == "__main__":
    main()
