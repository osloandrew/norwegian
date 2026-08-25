#!/usr/bin/env python3
"""Build the Word Game's compact CLARINO usefulness-rank snapshot.

The source is the 2025 Bokmål frequency list from Norsk aviskorpus. It is an
observed-word-form list, so this first version deliberately keeps only exact,
case-folded matches to spellings already present in ``norwegianWords.csv``.
It does not guess lemmas from ambiguous inflections and never edits the CSV.

See VOCABULARY_FREQUENCY_DATA.md for source details and attribution.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import unicodedata
import urllib.request
from collections import defaultdict
from pathlib import Path


SOURCE_URL = (
    "https://repo.clarino.uib.no/xmlui/bitstream/handle/11509/157/"
    "frekvensordliste-aviskorpus-nob.tsv?isAllowed=y&sequence=1"
)
SOURCE_PAGE = "https://repo.clarino.uib.no/xmlui/handle/11509/157"
LEXICAL_FORM_RE = re.compile(r"[^\W\d_]+(?:[-'’][^\W\d_]+)*", re.UNICODE)
DATA_VERSION = 1


def normalize(value: str) -> str:
    return unicodedata.normalize("NFC", value.strip()).casefold()


def read_dictionary_spellings(dictionary_path: Path) -> set[str]:
    spellings: set[str] = set()
    with dictionary_path.open(encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            for raw_spelling in row.get("ord", "").split(","):
                spelling = normalize(raw_spelling)
                if spelling:
                    spellings.add(spelling)
    return spellings


def read_source_bytes(source_path: Path | None) -> bytes:
    if source_path:
        return source_path.read_bytes()
    with urllib.request.urlopen(SOURCE_URL) as response:
        return response.read()


def parse_frequencies(source_bytes: bytes) -> dict[str, int]:
    frequencies: dict[str, int] = defaultdict(int)
    text = source_bytes.decode("utf-8-sig")

    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line or line.startswith("#"):
            continue
        try:
            raw_frequency, raw_form = line.split("\t", 1)
            frequency = int(raw_frequency)
        except ValueError as error:
            raise ValueError(f"Malformed CLARINO row {line_number}: {line!r}") from error

        source_form = unicodedata.normalize("NFC", raw_form.strip())
        form = normalize(source_form)
        if (
            form
            and source_form == form
            and LEXICAL_FORM_RE.fullmatch(form)
        ):
            # Use lowercase occurrences only. This retains ordinary lexical
            # uses while sharply reducing newspaper-specific proper names,
            # mastheads, and credit labels (the source documentation itself
            # calls out uppercase ``Foto`` and ``VG`` as artifacts).
            frequencies[form] += frequency

    return dict(frequencies)


def build_payload(
    dictionary_path: Path,
    source_path: Path | None,
) -> dict[str, object]:
    dictionary_spellings = read_dictionary_spellings(dictionary_path)
    frequencies = parse_frequencies(read_source_bytes(source_path))
    ranked_forms = sorted(frequencies, key=lambda form: (-frequencies[form], form))
    source_rank = {form: rank for rank, form in enumerate(ranked_forms, start=1)}
    matched_ranks = {
        form: source_rank[form]
        for form in dictionary_spellings
        if form in source_rank
    }

    return {
        "version": DATA_VERSION,
        "source": SOURCE_PAGE,
        "sourceFile": "frekvensordliste-aviskorpus-nob.tsv",
        "sourceGenerated": "2025-08-25",
        "license": "CC BY 3.0",
        "method": "exact-lowercase-dictionary-spelling-rank",
        "sourceLexicalForms": len(ranked_forms),
        "matchedDictionarySpellings": len(matched_ranks),
        "ranks": dict(sorted(matched_ranks.items())),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dictionary",
        type=Path,
        default=Path("norwegianWords.csv"),
    )
    parser.add_argument(
        "--source",
        type=Path,
        help="Use an already-downloaded CLARINO TSV instead of downloading it.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("vocabulary-frequency.json"),
    )
    args = parser.parse_args()

    payload = build_payload(args.dictionary, args.source)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {payload['matchedDictionarySpellings']:,} dictionary frequency "
        f"ranks from {payload['sourceLexicalForms']:,} lexical source forms to "
        f"{args.output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
