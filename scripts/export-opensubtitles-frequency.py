#!/usr/bin/env python3
"""Export a reproducible Bokmål frequency list from OpenSubtitles2018.

Downloads hermitdave/FrequencyWords' Norwegian list (`word count` per line,
content licensed CC BY-SA-4.0) and reformats it to this project's shared
`count\tword` stored-snapshot shape, so build-vocabulary-frequency.py can
parse it with the same generic TSV parser used for every other source. This
is a maintenance command; the stored TSV is what ordinary builds consume.
"""

from __future__ import annotations

import argparse
import ssl
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


SOURCE_URL = (
    "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/"
    "content/2018/no/no_full.txt"
)
SOURCE_PAGE = "https://github.com/hermitdave/FrequencyWords"
DEFAULT_OUTPUT = Path("data/opensubtitles-bokmal-full.tsv")


def parse_word_count_lines(data: str) -> list[tuple[int, str]]:
    rows: list[tuple[int, str]] = []
    for line in data.splitlines():
        if not line or line.startswith("#"):
            continue
        word, _, count = line.rpartition(" ")
        if not word or not count.isdigit():
            continue
        rows.append((int(count), word))
    return rows


def export_frequency_list(output: Path, url: str = SOURCE_URL) -> None:
    default_paths = ssl.get_default_verify_paths()
    system_ca = Path("/etc/ssl/cert.pem")
    ssl_context = (
        ssl.create_default_context(cafile=str(system_ca))
        if not default_paths.cafile and system_ca.is_file()
        else None
    )
    with urllib.request.urlopen(url, timeout=120, context=ssl_context) as response:
        data = response.read().decode("utf-8")

    rows = parse_word_count_lines(data)
    if not rows:
        raise RuntimeError("OpenSubtitles source returned an empty or unsupported list")

    output.parent.mkdir(parents=True, exist_ok=True)
    generated = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    with output.open("w", encoding="utf-8", newline="") as target:
        target.write("# OpenSubtitles2018 frequency export (hermitdave/FrequencyWords)\n")
        target.write(f"# source: {SOURCE_PAGE}\n")
        target.write(f"# exported-at: {generated}\n")
        target.write("# license: CC BY-SA-4.0\n")
        for count, word in rows:
            target.write(f"{count}\t{word}\n")
    print(f"Wrote {len(rows):,} forms to {output}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--url", default=SOURCE_URL)
    args = parser.parse_args()
    export_frequency_list(args.output, args.url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
