#!/usr/bin/env python3
"""Build the browser's compact Bokmål inflection snapshot.

The source is the public ``lemma_expanded.json`` export from Norsk Ordbank.
Only lemmas and word classes that occur in ``norwegianWords.csv`` are kept,
and all accepted alternatives are merged into one deterministic JSON record.

Norsk Ordbank is maintained by the University of Bergen and Språkrådet and
is distributed under CC BY 4.0. See INFLECTIONS_DATA.md for attribution.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import unicodedata
import urllib.request
from collections import defaultdict
from pathlib import Path


SOURCE_URL = "https://ord.uib.no/bm/fil/lemma_expanded.json"
NOUN_GENDERS = {"en", "et", "ei"}
CLASS_PREFIX = {"noun": "n", "adjective": "a", "verb": "v"}
FIELD_SEPARATOR = "|"
ALTERNATIVE_SEPARATOR = "/"
DATA_VERSION = 3


def normalize(value: str) -> str:
    return unicodedata.normalize("NFC", value.strip()).casefold()


def word_class(gender: str) -> str | None:
    normalized = gender.strip().lower()
    tokens = set(normalized.split("-"))
    if tokens & NOUN_GENDERS:
        return "noun"
    if normalized in {"adjective", "verb"}:
        return normalized
    return None


def read_targets(dictionary_path: Path) -> dict[str, set[str]]:
    targets: dict[str, set[str]] = defaultdict(set)
    with dictionary_path.open(encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            current_class = word_class(row.get("gender", ""))
            if not current_class:
                continue

            # Keep every listed spelling variant. The current UI displays the
            # first one, while retaining the rest makes the snapshot ready for
            # a later variant-aware lookup without another data migration.
            for raw_lemma in row.get("ord", "").split(","):
                lemma = normalize(raw_lemma)
                if lemma and " " not in lemma:
                    targets[current_class].add(lemma)
    return targets


def download_source() -> list[list[object]]:
    request = urllib.request.Request(
        SOURCE_URL,
        headers={"User-Agent": "norwegian-dictionary-inflection-builder/1.0"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def read_source(source_path: Path | None) -> list[list[object]]:
    if source_path:
        return json.loads(source_path.read_text(encoding="utf-8"))
    return download_source()


def add(record: list[set[str]], index: int, *values: str) -> None:
    for value in values:
        value = unicodedata.normalize("NFC", value.strip())
        if value:
            record[index].add(value)


def build_records(
    source_entries: list[list[object]], targets: dict[str, set[str]]
) -> dict[str, list[list[str]]]:
    records: dict[str, list[set[str]]] = {}
    adverbial_adjective_fallbacks: dict[str, list[set[str]]] = {}

    for entry in source_entries:
        if not isinstance(entry, list) or len(entry) < 6:
            continue
        raw_lemma, _, source_class, inflection_group, _, paradigms = entry[:6]
        lemma = normalize(str(raw_lemma))
        if not isinstance(paradigms, list):
            continue

        # The project's dictionary is authoritative about word class. When it
        # labels a lemma as an adjective but Norsk Ordbank stores that usage as
        # an adverb, retain the dictionary's adjective classification and use
        # an invariant positive paradigm. ADV_adj still contributes its
        # documented comparative and superlative (for example ille/verre/verst).
        if lemma in targets["adjective"] and source_class == "ADV":
            fallback = adverbial_adjective_fallbacks.setdefault(
                lemma, [set() for _ in range(8)]
            )
            for index in range(5):
                add(fallback, index, str(raw_lemma))
            if inflection_group == "ADV_adj":
                for paradigm in paradigms:
                    if isinstance(paradigm, list) and len(paradigm) == 2:
                        add(fallback, 5, str(paradigm[0]))
                        add(fallback, 6, str(paradigm[1]))

        # The structured export identifies the grammatical class explicitly.
        # This matters for homographs: a column-count heuristic over boys.csv
        # can otherwise merge, for example, determiner forms into an adjective.
        if (
            source_class == "NOUN"
            and inflection_group in {"NOUN_regular", "NOUN_reg_fem"}
            and lemma in targets["noun"]
        ):
            key = f"n:{lemma}"
            record = records.setdefault(key, [set() for _ in range(3)])
            for paradigm in paradigms:
                if isinstance(paradigm, list) and len(paradigm) == 3:
                    add(record, 0, str(paradigm[0]))
                    add(record, 1, str(paradigm[1]))
                    add(record, 2, str(paradigm[2]))

        # ADJ_regular stores the positive masculine/feminine as the lemma;
        # each paradigm then contains plural, definite singular, neuter,
        # comparative, indefinite superlative, and definite superlative.
        elif (
            source_class == "ADJ"
            and inflection_group == "ADJ_regular"
            and lemma in targets["adjective"]
        ):
            key = f"a:{lemma}"
            record = records.setdefault(key, [set() for _ in range(8)])
            add(record, 0, str(raw_lemma))
            add(record, 1, str(raw_lemma))
            for paradigm in paradigms:
                if not isinstance(paradigm, list) or len(paradigm) != 6:
                    continue
                add(record, 2, str(paradigm[2]))
                add(record, 3, str(paradigm[1]))
                add(record, 4, str(paradigm[0]))
                add(record, 5, str(paradigm[3]))
                add(record, 6, str(paradigm[4]))
                add(record, 7, str(paradigm[5]))

        # Gender-distinguishing adjective groups store the masculine or
        # masculine/feminine positive as the lemma, followed by feminine,
        # neuter, definite, plural, comparative, and both superlatives.
        elif (
            source_class == "ADJ"
            and inflection_group in {"ADJ_masc/fem_fem", "ADJ_masc_fem"}
            and lemma in targets["adjective"]
        ):
            key = f"a:{lemma}"
            record = records.setdefault(key, [set() for _ in range(8)])
            add(record, 0, str(raw_lemma))
            for paradigm in paradigms:
                if not isinstance(paradigm, list) or len(paradigm) != 7:
                    continue
                for index, value in enumerate(paradigm, start=1):
                    add(record, index, str(value))

        # VERB_regular paradigms include present, passive forms, past,
        # participles, and imperative alternatives after an unused alternate-
        # infinitive slot. Keep the five learner-facing forms only.
        elif (
            source_class == "VERB"
            and inflection_group == "VERB_regular"
            and lemma in targets["verb"]
        ):
            key = f"v:{lemma}"
            record = records.setdefault(key, [set() for _ in range(5)])
            add(record, 0, str(raw_lemma))
            for paradigm in paradigms:
                if not isinstance(paradigm, list) or len(paradigm) != 15:
                    continue
                add(record, 0, str(paradigm[0]))
                add(record, 1, str(paradigm[1]))
                add(record, 2, str(paradigm[4]))
                add(record, 3, str(paradigm[5]))
                add(
                    record,
                    4,
                    str(paradigm[12]),
                    str(paradigm[13]),
                    str(paradigm[14]),
                )

        # VERB_sPass covers verbs such as finnes/fins. The last field can be a
        # theoretical imperative; the public dictionary's learner-facing
        # table omits that form for this class.
        elif (
            source_class == "VERB"
            and inflection_group == "VERB_sPass"
            and lemma in targets["verb"]
        ):
            key = f"v:{lemma}"
            record = records.setdefault(key, [set() for _ in range(5)])
            add(record, 0, str(raw_lemma))
            for paradigm in paradigms:
                if not isinstance(paradigm, list) or len(paradigm) != 4:
                    continue
                add(record, 1, str(paradigm[0]))
                add(record, 2, str(paradigm[1]))
                add(record, 3, str(paradigm[2]))

    for lemma, fallback in adverbial_adjective_fallbacks.items():
        records.setdefault(f"a:{lemma}", fallback)

    return {
        key: [sorted(values) for values in record]
        for key, record in sorted(records.items())
    }


def encode_records(records: dict[str, list[list[str]]]) -> dict[str, str]:
    """Flatten arrays to reduce browser parse time and retained heap.

    A selected record is expanded back to its tiny array shape at lookup time.
    Norsk Ordbank forms do not use either separator; fail loudly if that ever
    changes rather than producing ambiguous learner-facing output.
    """
    encoded: dict[str, str] = {}
    for key, record in records.items():
        for values in record:
            for value in values:
                if FIELD_SEPARATOR in value or ALTERNATIVE_SEPARATOR in value:
                    raise ValueError(f"Unsupported separator in inflection: {value!r}")
        encoded[key] = FIELD_SEPARATOR.join(
            ALTERNATIVE_SEPARATOR.join(values) for values in record
        )
    return encoded


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dictionary",
        type=Path,
        default=Path("norwegianWords.csv"),
        help="Path to norwegianWords.csv",
    )
    parser.add_argument(
        "--source",
        type=Path,
        help="Use an already-downloaded lemma_expanded.json instead of downloading it",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("inflections-data.json"),
    )
    args = parser.parse_args()

    targets = read_targets(args.dictionary)
    source_entries = read_source(args.source)
    records = build_records(source_entries, targets)
    payload = {
        "version": DATA_VERSION,
        "source": SOURCE_URL,
        "license": "CC BY 4.0",
        "forms": encode_records(records),
    }
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )

    target_count = sum(len(values) for values in targets.values())
    print(
        f"Wrote {len(records):,} authoritative records for "
        f"{target_count:,} inflectable dictionary spellings to {args.output}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
