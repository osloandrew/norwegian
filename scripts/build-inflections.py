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
DATA_VERSION = 6
NOUN_GENDER_ORDER = ("en", "ei", "et")


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
                elif lemma and current_class == "verb":
                    # Multiword verb entries (for example "rydde ut") need
                    # the first verb's official paradigm in the cloze game.
                    # It is kept as lookup-only data; the table still belongs
                    # to the complete dictionary entry and is not fabricated.
                    first_part = lemma.split()[0].split("/")[0]
                    if first_part:
                        targets[current_class].add(first_part)
    return targets


def canonical_noun_gender(gender: str) -> str:
    tokens = set(gender.strip().lower().split("-")) & NOUN_GENDERS
    return "-".join(article for article in NOUN_GENDER_ORDER if article in tokens)


def noun_record_key(lemma: str, gender: str) -> str:
    return f"n:{lemma}:{canonical_noun_gender(gender)}"


def noun_gender_articles(gender: str) -> set[str]:
    articles = set(canonical_noun_gender(gender).split("-")) & NOUN_GENDERS
    # In Bokmål, a dictionary entry presented with ``ei`` may also use the
    # common-gender ``en`` paradigm. Keep that accepted option within the same
    # sense, without leaking neuter or unrelated homograph paradigms into it.
    if "ei" in articles:
        articles.add("en")
    return articles


def noun_paradigm_article(paradigm: list[object]) -> str:
    if len(paradigm) != 3:
        return ""
    definite_singular = normalize(str(paradigm[0]))
    if definite_singular.endswith("a"):
        return "ei"
    if definite_singular.endswith("t"):
        return "et"
    if definite_singular.endswith("n"):
        return "en"
    return ""


def read_noun_articles(dictionary_path: Path) -> dict[str, set[str]]:
    """Return every distinct dictionary noun-gender signature per lemma."""
    genders: dict[str, set[str]] = defaultdict(set)
    with dictionary_path.open(encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            gender = canonical_noun_gender(row.get("gender", ""))
            if not gender:
                continue
            for raw_lemma in row.get("ord", "").split(","):
                lemma = normalize(raw_lemma)
                if lemma and " " not in lemma:
                    genders[lemma].add(gender)
    return genders


def read_dictionary_lemmas(dictionary_path: Path) -> set[str]:
    lemmas: set[str] = set()
    with dictionary_path.open(encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            for raw_lemma in row.get("ord", "").split(","):
                lemma = normalize(raw_lemma)
                if lemma and " " not in lemma:
                    lemmas.add(lemma)
    return lemmas


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
    source_entries: list[list[object]],
    targets: dict[str, set[str]],
    dictionary_class_overrides: set[str] | None = None,
    noun_genders: dict[str, set[str]] | None = None,
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
            for paradigm in paradigms:
                if not isinstance(paradigm, list):
                    continue
                article = noun_paradigm_article(paradigm)
                for gender in (noun_genders or {}).get(lemma, {""}):
                    if gender and article not in noun_gender_articles(gender):
                        continue
                    key = noun_record_key(lemma, gender) if gender else f"n:{lemma}"
                    record = records.setdefault(key, [set() for _ in range(3)])
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
        # infinitive slot. The first five compact fields remain the forms shown
        # in the learner-facing table. The remaining seven fields retain the
        # official passive and participial slots for exact sentence matching
        # and same-slot Word Game distractors.
        elif (
            source_class == "VERB"
            and inflection_group == "VERB_regular"
            and lemma in targets["verb"]
        ):
            key = f"v:{lemma}"
            record = records.setdefault(key, [set() for _ in range(12)])
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
                add(record, 5, str(paradigm[2]), str(paradigm[3]))
                add(record, 6, str(paradigm[6]))
                add(record, 7, str(paradigm[7]))
                add(record, 8, str(paradigm[8]))
                add(record, 9, str(paradigm[9]))
                add(record, 10, str(paradigm[10]))
                add(record, 11, str(paradigm[11]))

        # VERB_sPass covers verbs such as finnes/fins. The last field can be a
        # theoretical imperative; the public dictionary's learner-facing
        # table omits that form for this class.
        elif (
            source_class == "VERB"
            and inflection_group == "VERB_sPass"
            and lemma in targets["verb"]
        ):
            key = f"v:{lemma}"
            record = records.setdefault(key, [set() for _ in range(12)])
            add(record, 0, str(raw_lemma))
            for paradigm in paradigms:
                if not isinstance(paradigm, list) or len(paradigm) != 4:
                    continue
                add(record, 1, str(paradigm[0]))
                add(record, 2, str(paradigm[1]))
                add(record, 3, str(paradigm[2]))

    for lemma, fallback in adverbial_adjective_fallbacks.items():
        key = f"a:{lemma}"
        if key not in records:
            records[key] = fallback
            if dictionary_class_overrides is not None:
                dictionary_class_overrides.add(key)

    return {
        key: [sorted(values) for values in record]
        for key, record in sorted(records.items())
    }


def add_dictionary_fallback_records(
    records: dict[str, list[list[str]]],
    targets: dict[str, set[str]],
    noun_genders: dict[str, set[str]],
    dictionary_lemmas: set[str],
) -> tuple[dict[str, str], set[str]]:
    """Cover dictionary entries that have no exact Ordbank lemma.

    A missing entry first inherits a same-class suffix paradigm only when the
    preceding compound element is itself a dictionary lemma (allowing the
    common linking ``-s-``/``-e-``). This models right-headed compounds such as
    ``luftfoto -> foto`` while rejecting accidental suffixes. Noun heads must
    agree with the dictionary's article when both sides provide one.

    If no defensible head exists, retain a lemma-only record. That still gives
    the learner a Word Forms table without presenting guessed endings as fact.
    """
    exact_records = dict(records)
    derived_from: dict[str, str] = {}
    dictionary_only: set[str] = set()

    for current_class, prefix in CLASS_PREFIX.items():
        if current_class == "noun":
            target_entries = [
                (lemma, noun_record_key(lemma, gender), gender)
                for lemma in sorted(targets[current_class])
                for gender in sorted(noun_genders.get(lemma, set()))
            ]
            official_heads = [
                (key.split(":", 2)[1], key, key.rsplit(":", 1)[1])
                for key in exact_records
                if key.startswith("n:") and key.count(":") == 2
            ]
        else:
            target_entries = [
                (lemma, f"{prefix}:{lemma}", "")
                for lemma in sorted(targets[current_class])
            ]
            official_heads = [
                (key[2:], key, "")
                for key in exact_records
                if key.startswith(f"{prefix}:")
            ]

        for lemma, key, target_gender in target_entries:
            if key in records:
                continue

            candidate_heads: list[tuple[int, str, str]] = []
            for head, head_key, head_gender in official_heads:
                if len(head) < 3 or len(lemma) < len(head) + 2:
                    continue
                if not lemma.endswith(head):
                    continue
                if current_class == "noun" and head_gender != target_gender:
                    continue
                compound_prefix = lemma[: -len(head)]
                boundary_score = 0
                if compound_prefix in dictionary_lemmas:
                    boundary_score = 1
                if (
                    compound_prefix[-1:] in {"e", "s"}
                    and compound_prefix[:-1] in dictionary_lemmas
                ):
                    # Prefer a recognized Norwegian linking element. This
                    # avoids false longest-suffix analyses such as treating
                    # aksjonsdag as aksj + onsdag or fedrelandsvenn as
                    # fedreland + svenn.
                    boundary_score = 2
                if boundary_score == 0:
                    continue
                candidate_heads.append((boundary_score, head, head_key))

            if candidate_heads:
                _, head, head_key = max(
                    candidate_heads,
                    key=lambda value: (value[0], len(value[1]), value[1]),
                )
                compound_prefix = lemma[: -len(head)]
                records[key] = [
                    [compound_prefix + form for form in field]
                    for field in exact_records[head_key]
                ]
                derived_from[key] = head_key
                continue

            if current_class == "noun":
                records[key] = [[], [], []]
            elif current_class == "adjective":
                records[key] = [[lemma], [lemma], [], [], [], [], [], []]
            else:
                records[key] = [[lemma], *([[]] * 11)]
            dictionary_only.add(key)

    return derived_from, dictionary_only


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
    noun_genders = read_noun_articles(args.dictionary)
    dictionary_lemmas = read_dictionary_lemmas(args.dictionary)
    source_entries = read_source(args.source)
    dictionary_class_overrides: set[str] = set()
    records = build_records(
        source_entries,
        targets,
        dictionary_class_overrides,
        noun_genders,
    )
    derived_from, dictionary_only = add_dictionary_fallback_records(
        records,
        targets,
        noun_genders,
        dictionary_lemmas,
    )
    payload = {
        "version": DATA_VERSION,
        "source": SOURCE_URL,
        "license": "CC BY 4.0",
        "dictionaryClassOverrides": sorted(dictionary_class_overrides),
        "derivedFrom": dict(sorted(derived_from.items())),
        "dictionaryOnly": sorted(dictionary_only),
        "forms": encode_records(records),
    }
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )

    target_count = sum(len(values) for values in targets.values())
    print(
        f"Wrote {len(records):,} records for {target_count:,} inflectable "
        f"dictionary spellings ({len(derived_from):,} derived, "
        f"{len(dictionary_only):,} lemma-only) to {args.output}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
