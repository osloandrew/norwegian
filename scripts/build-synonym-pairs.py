#!/usr/bin/env python3
"""Build the vetted Bokmål synonym snapshot used by the Word Game.

The game intentionally does not query Norsk Ordvev at runtime.  This script
intersects its synsets with the local learner dictionary, then keeps only
pairs independently supported by the target entry's Norwegian definition.
That deliberately small Tier-A set is preferable to treating every WordNet
co-member as a learner-ready, context-free synonym.

Usage:
  python3 scripts/build-synonym-pairs.py \
    --ordvev-archive /path/to/norsk_ordvev_nob_1.1.2.zip
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import unicodedata
import zipfile
from collections import defaultdict
from itertools import combinations
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DICTIONARY = ROOT / "norwegianWords.csv"
DEFAULT_OUTPUT = ROOT / "data" / "synonym-pair-candidates.json"
SOURCE_NAME = "Norsk Ordvev Bokmål"
SOURCE_VERSION = "1.1.2"
SOURCE_LICENSE = "CC BY 4.0"
SOURCE_URL = "https://www.nb.no/sbfil/leksikalske_databaser/norsk_ordvev_nob_1.1.2.zip"


def normalize(value: str) -> str:
    return " ".join(unicodedata.normalize("NFC", value or "").lower().split())


def primary_form(value: str) -> str:
    return normalize((value or "").split(",", 1)[0])


def word_class(gender: str) -> str:
    gender = normalize(gender)
    if re.search(r"\b(en|et|ei)\b", gender):
        return "noun"
    return gender


# This keeps the eligibility rule Unicode-safe without adding a dependency.
def eligible_form(value: str) -> bool:
    # v1 intentionally avoids alternatives, slash forms, names, and
    # multiword expressions. They are useful dictionary entries, but too
    # likely to make an ostensibly simple same-meaning question ambiguous.
    return bool(value) and all(char.isalpha() or char == "-" for char in value)


def read_zip_tsv(archive: zipfile.ZipFile, name: str):
    columns_name = name.replace(".tab", ".colnames")
    with archive.open(columns_name) as raw:
        columns = next(io.TextIOWrapper(raw, encoding="utf-8-sig")).rstrip("\n").split("\t")
    with archive.open(name) as raw:
        text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
        yield from csv.DictReader(text, fieldnames=columns, delimiter="\t")


def definition_mentions(definition: str, candidate: str) -> bool:
    # Boundaries stop "rask" from matching a compound such as "raskere".
    # Hyphen is treated as part of a word to avoid matching half a compound.
    pattern = rf"(?<![\w-]){re.escape(candidate)}(?![\w-])"
    return bool(re.search(pattern, normalize(definition), flags=re.IGNORECASE))


def load_dictionary(path: Path):
    entries = {}
    with path.open(encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            form = primary_form(row.get("ord", ""))
            pos = word_class(row.get("gender", ""))
            if not eligible_form(form) or not pos:
                continue
            # Homographs with the same displayed lemma and POS cannot be
            # reliably distinguished in a no-context prompt. Exclude them.
            key = (form, pos)
            if key in entries:
                entries[key] = None
            else:
                entries[key] = row
    return {key: row for key, row in entries.items() if row is not None}


def ordvev_pos_to_local(value: str) -> str:
    return {
        "noun": "noun",
        "verb": "verb",
        "adjective": "adjective",
        "adverb": "adverb",
    }.get(normalize(value), "")


def build_pairs(dictionary, archive_path: Path):
    with zipfile.ZipFile(archive_path) as archive:
        words = {
            row["id"]: (normalize(row["form_nb"]), ordvev_pos_to_local(row["pos"]))
            for row in read_zip_tsv(archive, "dat/words.tab")
        }
        synsets = defaultdict(list)
        for row in read_zip_tsv(archive, "dat/wordsenses.tab"):
            form, pos = words.get(row["word_id"], ("", ""))
            if form and pos and eligible_form(form):
                synsets[row["synset_id"]].append((form, pos))

    pairs = defaultdict(set)
    for members in synsets.values():
        # Word senses can duplicate a lemma in a synset; collapse first.
        members = sorted(set(members))
        for (left_form, left_pos), (right_form, right_pos) in combinations(members, 2):
            if left_pos != right_pos:
                continue
            left = dictionary.get((left_form, left_pos))
            right = dictionary.get((right_form, right_pos))
            if not left or not right:
                continue
            # A directional check is enough: the browser will retain only the
            # supported direction, which keeps the question evidence honest.
            if definition_mentions(left.get("definisjon", ""), right_form):
                pairs[(left_form, left_pos)].add(right_form)
            if definition_mentions(right.get("definisjon", ""), left_form):
                pairs[(right_form, right_pos)].add(left_form)

    return {
        f"{form}|{pos}": sorted(answers)
        for (form, pos), answers in sorted(pairs.items())
        if answers
    }


def keep_reciprocal_pairs(pairs):
    """Keep only pairs whose definition confirmation runs in both directions."""
    reciprocal = {}
    for key, answers in pairs.items():
        form, part_of_speech = key.rsplit("|", 1)
        approved = [
            answer
            for answer in answers
            if form in pairs.get(f"{answer}|{part_of_speech}", [])
        ]
        if approved:
            reciprocal[key] = approved
    return reciprocal


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ordvev-archive", type=Path, required=True)
    parser.add_argument("--dictionary", type=Path, default=DEFAULT_DICTIONARY)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--reciprocal-only",
        action="store_true",
        help="retain only definition-confirmed pairs supported in both directions",
    )
    args = parser.parse_args()

    pairs = build_pairs(load_dictionary(args.dictionary), args.ordvev_archive)
    if args.reciprocal_only:
        pairs = keep_reciprocal_pairs(pairs)
    payload = {
        "version": 1,
        "source": {
            "name": SOURCE_NAME,
            "version": SOURCE_VERSION,
            "license": SOURCE_LICENSE,
            "url": SOURCE_URL,
        },
        "selection": (
            "same synset, same part of speech, local single-form entry, "
            "reciprocal definition-confirmed"
            if args.reciprocal_only
            else "same synset, same part of speech, local single-form entry, definition-confirmed"
        ),
        "pairs": pairs,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {len(pairs):,} targets with "
        f"{sum(map(len, pairs.values())):,} directional pairs to {args.output}"
    )


if __name__ == "__main__":
    main()
