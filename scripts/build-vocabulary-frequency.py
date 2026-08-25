#!/usr/bin/env python3
"""Build entry-level CLARINO usefulness evidence for the Word Game.

Counts are joined to dictionary entries by exact spelling first, then through
unambiguous authoritative Norsk Ordbank paradigms from ``inflections-data.json``.
Ambiguous forms are left unassigned rather than copied to every homograph. The
dictionary CSV is never modified.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import unicodedata
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path


SOURCE_URL = (
    "https://repo.clarino.uib.no/xmlui/bitstream/handle/11509/157/"
    "frekvensordliste-aviskorpus-nob.tsv?isAllowed=y&sequence=1"
)
SOURCE_PAGE = "https://repo.clarino.uib.no/xmlui/handle/11509/157"
DEFAULT_DEEP_SOURCE = Path(
    "data/clarino-aviskorpus-bokmal-top-100000.tsv"
)
LEXICAL_FORM_RE = re.compile(r"[^\W\d_]+(?:[-'’][^\W\d_]+)*", re.UNICODE)
NOUN_GENDERS = {"en", "ei", "et"}
CLASS_PREFIX = {
    "adjective": "a",
    "adverb": "d",
    "determiner": "t",
    "numeral": "m",
    "possessive": "p",
    "verb": "v",
}
DATA_VERSION = 2


@dataclass(frozen=True)
class DictionaryEntry:
    key: str
    primary: str
    gender: str
    spellings: tuple[str, ...]
    inflection_prefix: str | None


def normalize(value: str) -> str:
    return unicodedata.normalize("NFC", value.strip()).casefold()


def canonical_gender(value: str) -> str:
    return normalize(value)


def entry_key(primary: str, gender: str) -> str:
    return f"{normalize(primary)}|{canonical_gender(gender)}"


def inflection_prefix(gender: str) -> str | None:
    normalized = canonical_gender(gender)
    if set(normalized.split("-")) & NOUN_GENDERS:
        return "n"
    return CLASS_PREFIX.get(normalized)


def read_dictionary_entries(dictionary_path: Path) -> dict[str, DictionaryEntry]:
    entries: dict[str, DictionaryEntry] = {}
    with dictionary_path.open(encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            spellings = tuple(
                spelling
                for spelling in (
                    normalize(raw_spelling)
                    for raw_spelling in row.get("ord", "").split(",")
                )
                if spelling
            )
            if not spellings:
                continue
            gender = canonical_gender(row.get("gender", ""))
            key = entry_key(spellings[0], gender)
            entries.setdefault(
                key,
                DictionaryEntry(
                    key=key,
                    primary=spellings[0],
                    gender=gender,
                    spellings=spellings,
                    inflection_prefix=inflection_prefix(gender),
                ),
            )
    return entries


def read_source_bytes(source_path: Path | None) -> bytes:
    if source_path:
        return source_path.read_bytes()
    if DEFAULT_DEEP_SOURCE.is_file():
        return DEFAULT_DEEP_SOURCE.read_bytes()
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
        if form and source_form == form and LEXICAL_FORM_RE.fullmatch(form):
            # Uppercase tokens include a disproportionate number of newspaper
            # mastheads, names, and photo credits. Lowercase occurrences keep
            # lexical evidence without promoting those artifacts.
            frequencies[form] += frequency

    return dict(frequencies)


def decode_inflection_record(encoded: object) -> list[list[str]]:
    if isinstance(encoded, list):
        return [
            [normalize(str(value)) for value in values if value]
            for values in encoded
            if isinstance(values, list)
        ]
    if not isinstance(encoded, str):
        return []
    return [
        [normalize(value) for value in field.split("/") if value]
        for field in encoded.split("|")
    ]


def parse_inflection_key(key: str) -> tuple[str, str, str]:
    parts = key.split(":")
    prefix = parts[0]
    lemma = normalize(parts[1]) if len(parts) > 1 else ""
    gender = canonical_gender(parts[2]) if prefix == "n" and len(parts) > 2 else ""
    return prefix, lemma, gender


def noun_genders_compatible(entry_gender: str, paradigm_gender: str) -> bool:
    entry_articles = set(entry_gender.split("-")) & NOUN_GENDERS
    paradigm_articles = set(paradigm_gender.split("-")) & NOUN_GENDERS
    if "ei" in entry_articles:
        entry_articles.add("en")
    if "ei" in paradigm_articles:
        paradigm_articles.add("en")
    return bool(entry_articles & paradigm_articles)


def build_candidate_maps(
    entries: dict[str, DictionaryEntry],
    inflections_path: Path,
) -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    exact_candidates: dict[str, set[str]] = defaultdict(set)
    for entry in entries.values():
        for spelling in entry.spellings:
            exact_candidates[spelling].add(entry.key)

    snapshot = json.loads(inflections_path.read_text(encoding="utf-8"))
    excluded_keys = {
        *snapshot.get("dictionaryOnly", []),
        *snapshot.get("dictionaryClassOverrides", []),
        *snapshot.get("derivedFrom", {}).keys(),
    }
    entries_by_lemma_and_prefix: dict[tuple[str, str], list[DictionaryEntry]] = (
        defaultdict(list)
    )
    for entry in entries.values():
        if entry.inflection_prefix:
            for spelling in entry.spellings:
                entries_by_lemma_and_prefix[(spelling, entry.inflection_prefix)].append(
                    entry
                )

    inflection_candidates: dict[str, set[str]] = defaultdict(set)
    for key, encoded in snapshot.get("forms", {}).items():
        if key in excluded_keys:
            continue
        prefix, lemma, paradigm_gender = parse_inflection_key(key)
        candidates = entries_by_lemma_and_prefix.get((lemma, prefix), [])
        if prefix == "n":
            candidates = [
                entry
                for entry in candidates
                if noun_genders_compatible(entry.gender, paradigm_gender)
            ]
        if not candidates:
            continue

        forms = {lemma}
        forms.update(
            form
            for field in decode_inflection_record(encoded)
            for form in field
            if form
        )
        for form in forms:
            for entry in candidates:
                inflection_candidates[form].add(entry.key)

    return dict(exact_candidates), dict(inflection_candidates)


def aggregate_entry_frequencies(
    frequencies: dict[str, int],
    exact_candidates: dict[str, set[str]],
    inflection_candidates: dict[str, set[str]],
) -> tuple[dict[str, dict[str, object]], dict[str, int]]:
    evidence: dict[str, dict[str, int]] = defaultdict(
        lambda: {"exact": 0, "inflected": 0}
    )
    stats = {
        "matchedSourceForms": 0,
        "exactSourceForms": 0,
        "uniqueInflectionSourceForms": 0,
        "ambiguousSourceForms": 0,
    }

    for form, count in frequencies.items():
        exact = exact_candidates.get(form, set())
        if len(exact) == 1:
            evidence[next(iter(exact))]["exact"] += count
            stats["matchedSourceForms"] += 1
            stats["exactSourceForms"] += 1
            continue
        if len(exact) > 1:
            stats["ambiguousSourceForms"] += 1
            continue

        inflected = inflection_candidates.get(form, set())
        if len(inflected) == 1:
            evidence[next(iter(inflected))]["inflected"] += count
            stats["matchedSourceForms"] += 1
            stats["uniqueInflectionSourceForms"] += 1
        elif len(inflected) > 1:
            stats["ambiguousSourceForms"] += 1

    ranked_keys = sorted(
        evidence,
        key=lambda key: (
            -(evidence[key]["exact"] + evidence[key]["inflected"]),
            key,
        ),
    )
    records: dict[str, dict[str, object]] = {}
    for rank, key in enumerate(ranked_keys, start=1):
        exact_count = evidence[key]["exact"]
        inflected_count = evidence[key]["inflected"]
        if exact_count and inflected_count:
            coverage = "exact-and-inflected"
        elif exact_count:
            coverage = "exact-lemma"
        else:
            coverage = "unique-inflection"
        records[key] = {
            "rank": rank,
            "count": exact_count + inflected_count,
            "coverage": coverage,
            "confidence": 1 if exact_count else 0.9,
        }
    return dict(sorted(records.items())), stats


def build_payload(
    dictionary_path: Path,
    source_path: Path | None,
    inflections_path: Path = Path("inflections-data.json"),
) -> dict[str, object]:
    entries = read_dictionary_entries(dictionary_path)
    frequencies = parse_frequencies(read_source_bytes(source_path))
    exact_candidates, inflection_candidates = build_candidate_maps(
        entries, inflections_path
    )
    records, stats = aggregate_entry_frequencies(
        frequencies, exact_candidates, inflection_candidates
    )
    source_file = (
        source_path.name
        if source_path
        else DEFAULT_DEEP_SOURCE.name
        if DEFAULT_DEEP_SOURCE.is_file()
        else "frekvensordliste-aviskorpus-nob.tsv"
    )

    return {
        "version": DATA_VERSION,
        "source": SOURCE_PAGE,
        "sourceFile": source_file,
        "sourceCorpus": "Norsk aviskorpus (Bokmål)",
        "sourcePeriod": "live Corpuscle snapshot",
        "license": "CC BY-NC 4.0" if "top-100000" in source_file else "CC BY 3.0",
        "inflectionSource": "Norsk Ordbank, CC BY 4.0",
        "method": "entry-counts-exact-then-unique-official-inflection",
        "sourceLexicalForms": len(frequencies),
        "sourceTokenCount": sum(frequencies.values()),
        "dictionaryEntries": len(entries),
        "matchedDictionaryEntries": len(records),
        **stats,
        "entries": records,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dictionary", type=Path, default=Path("norwegianWords.csv"))
    parser.add_argument(
        "--source",
        type=Path,
        help="Use an explicit CLARINO TSV instead of the stored deep export.",
    )
    parser.add_argument(
        "--inflections", type=Path, default=Path("inflections-data.json")
    )
    parser.add_argument(
        "--output", type=Path, default=Path("vocabulary-frequency.json")
    )
    args = parser.parse_args()

    payload = build_payload(args.dictionary, args.source, args.inflections)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {payload['matchedDictionaryEntries']:,} entry frequency records "
        f"from {payload['sourceLexicalForms']:,} lexical source forms to {args.output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
