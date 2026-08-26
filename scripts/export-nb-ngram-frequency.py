#!/usr/bin/env python3
"""Export a reproducible Bokmål frequency list from the National Library's
NB N-gram digibok (book) corpus.

Streams the ~1GB multi-language, multi-century unigram CSV from
Nasjonalbiblioteket/Språkbanken, filters to the `nob` (Bokmål) language
column, keeps the top N forms by aggregated frequency, and writes this
project's shared `count\tword` stored-snapshot shape (CC0-licensed content),
so build-vocabulary-frequency.py can parse it with the same generic TSV
parser used for every other source. This is a maintenance command; the
stored TSV is what ordinary builds consume.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import ssl
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


SOURCE_URL = "https://www.nb.no/sbfil/ngram/ngram_2021/ngram-2021-digibok-unigram.csv.gz"
SOURCE_PAGE = "https://www.nb.no/sprakbanken/en/resource-catalogue/oai-nb-no-sbr-70/"
DEFAULT_OUTPUT = Path("data/nb-ngram-digibok-bokmal-top-100000.tsv")
TARGET_LANGUAGE = "nob"


def stream_language_frequencies(byte_stream, language: str) -> list[tuple[int, str]]:
    text_stream = io.TextIOWrapper(byte_stream, encoding="utf-8", newline="")
    reader = csv.DictReader(text_stream)
    rows: list[tuple[int, str]] = []
    for row in reader:
        if row.get("lang") != language:
            continue
        word = (row.get("first") or "").strip()
        try:
            freq = int(row.get("freq") or 0)
        except ValueError:
            continue
        if not word or freq <= 0:
            continue
        rows.append((freq, word))
    return rows


def export_frequency_list(output: Path, limit: int, url: str = SOURCE_URL) -> None:
    default_paths = ssl.get_default_verify_paths()
    system_ca = Path("/etc/ssl/cert.pem")
    ssl_context = (
        ssl.create_default_context(cafile=str(system_ca))
        if not default_paths.cafile and system_ca.is_file()
        else None
    )
    with urllib.request.urlopen(url, timeout=600, context=ssl_context) as response:
        with gzip.GzipFile(fileobj=response) as byte_stream:
            rows = stream_language_frequencies(byte_stream, TARGET_LANGUAGE)

    if not rows:
        raise RuntimeError(
            f"NB N-gram source returned no rows for language {TARGET_LANGUAGE!r}"
        )

    rows.sort(key=lambda row: (-row[0], row[1]))
    rows = rows[:limit]

    output.parent.mkdir(parents=True, exist_ok=True)
    generated = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    with output.open("w", encoding="utf-8", newline="") as target:
        target.write("# NB N-gram digibok frequency export (Nasjonalbiblioteket)\n")
        target.write(f"# source: {SOURCE_PAGE}\n")
        target.write(f"# language: {TARGET_LANGUAGE}\n")
        target.write(f"# exported-at: {generated}\n")
        target.write("# license: CC0\n")
        for count, word in rows:
            target.write(f"{count}\t{word}\n")
    print(f"Wrote {len(rows):,} forms to {output}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--limit", type=int, default=100_000)
    parser.add_argument("--url", default=SOURCE_URL)
    args = parser.parse_args()
    if args.limit <= 0:
        parser.error("--limit must be positive")
    export_frequency_list(args.output, args.limit, args.url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
