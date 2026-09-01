#!/usr/bin/env python3
"""Build entry-level frequency evidence for the Word Game, blended across
three registers: CLARINO's Norsk aviskorpus (newspaper), OpenSubtitles2018
(conversational/spoken), and the National Library's NB N-gram digibok corpus
(books). Blending registers keeps any one corpus's quirks (e.g. newspaper
over-representing politics/journalism vocabulary) from dominating the signal.

Counts are joined to dictionary entries by exact spelling first, then through
unambiguous authoritative Norsk Ordbank paradigms from ``inflections-data.json``.
Ambiguous forms are left unassigned rather than copied to every homograph. The
dictionary CSV is never modified.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import unicodedata
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path


CLARINO_SOURCE_URL = (
    "https://repo.clarino.uib.no/xmlui/bitstream/handle/11509/157/"
    "frekvensordliste-aviskorpus-nob.tsv?isAllowed=y&sequence=1"
)
CLARINO_SOURCE_PAGE = "https://repo.clarino.uib.no/xmlui/handle/11509/157"
DEFAULT_CLARINO_SOURCE = Path("data/clarino-aviskorpus-bokmal-top-100000.tsv")

OPENSUBTITLES_SOURCE_PAGE = "https://github.com/hermitdave/FrequencyWords"
DEFAULT_OPENSUBTITLES_SOURCE = Path("data/opensubtitles-bokmal-full.tsv")

NB_NGRAM_SOURCE_PAGE = (
    "https://www.nb.no/sprakbanken/en/resource-catalogue/oai-nb-no-sbr-70/"
)
DEFAULT_NB_NGRAM_SOURCE = Path("data/nb-ngram-digibok-bokmal-top-100000.tsv")

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
DATA_VERSION = 5
BLEND_METHOD = (
    "mean of per-source min-max-normalized log1p(count), averaged only over "
    "the sources that matched a given entry"
)


CEFR_BANDS = {"A1", "A2", "B1", "B2", "C"}
CEFR_ORDER = {"A1": 1, "A2": 2, "B1": 3, "B2": 4, "C": 5}

# Closed word classes (a fixed, small membership that rarely gains new
# lemmas) dominate raw token frequency in any corpus, regardless of CEFR
# level — the most frequent handful of words in Norwegian, as in any
# language, are almost entirely pronouns/prepositions/conjunctions/
# determiners, not content words. When an ambiguous form's lowest-CEFR
# candidates mix a closed-class word with an open-class one (e.g. the
# preposition "i" vs. the letter name "I, i", both A1), that skew is a
# far stronger prior than the CEFR tie itself, so the closed-class side
# is assumed to be the real source of most of the shared volume. Matches
# wordGame.js's A0_FUNCTION_WORD_CLASSES.
CLOSED_WORD_CLASSES = {"pronoun", "preposition", "conjunction", "determiner"}


@dataclass(frozen=True)
class DictionaryEntry:
    key: str
    primary: str
    gender: str
    spellings: tuple[str, ...]
    inflection_prefix: str | None
    cefrs: tuple[str, ...]
    row_count: int


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


def is_closed_word_class(gender: str) -> bool:
    normalized = canonical_gender(gender)
    if set(normalized.split("-")) & NOUN_GENDERS:
        return False
    return normalized in CLOSED_WORD_CLASSES


def normalize_cefr_band(value: str, row_number: int) -> str:
    """Return a validated generated-data CEFR band.

    The browser keeps its historical B1 fallback as a resilience measure for
    malformed external/runtime data. The generated sidecar is stricter: a
    missing or mistyped band would silently put frequency evidence into the
    wrong comparison group, so fail the build with the dictionary row instead.
    """
    band = value.strip().upper()
    if band not in CEFR_BANDS:
        raise ValueError(
            f"Invalid or missing CEFR value {value!r} on dictionary row {row_number}"
        )
    return band


def read_dictionary_entries(dictionary_path: Path) -> dict[str, DictionaryEntry]:
    grouped: dict[str, dict[str, object]] = {}
    with dictionary_path.open(encoding="utf-8-sig", newline="") as source:
        for row_number, row in enumerate(csv.DictReader(source), start=2):
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
            cefr = normalize_cefr_band(row.get("CEFR", ""), row_number)
            group = grouped.setdefault(
                key,
                {
                    "primary": spellings[0],
                    "gender": gender,
                    "spellings": set(),
                    "cefrs": set(),
                    "row_count": 0,
                },
            )
            group["spellings"].update(spellings)
            group["cefrs"].add(cefr)
            group["row_count"] += 1

    return {
        key: DictionaryEntry(
            key=key,
            primary=str(group["primary"]),
            gender=str(group["gender"]),
            spellings=tuple(sorted(group["spellings"])),
            inflection_prefix=inflection_prefix(str(group["gender"])),
            cefrs=tuple(sorted(group["cefrs"], key=CEFR_ORDER.__getitem__)),
            row_count=int(group["row_count"]),
        )
        for key, group in grouped.items()
    }


def read_clarino_source_bytes(source_path: Path | None) -> tuple[bytes, str]:
    """Returns (bytes, source_file_name). CLARINO keeps its historical
    fallback to the small deposited list when no deep export is stored,
    since that deposited list is itself a stable, versioned artifact rather
    than a live multi-gigabyte corpus."""
    if source_path:
        return source_path.read_bytes(), source_path.name
    if DEFAULT_CLARINO_SOURCE.is_file():
        return DEFAULT_CLARINO_SOURCE.read_bytes(), DEFAULT_CLARINO_SOURCE.name
    with urllib.request.urlopen(CLARINO_SOURCE_URL) as response:
        return response.read(), "frekvensordliste-aviskorpus-nob.tsv"


def read_optional_source_bytes(
    source_path: Path | None, default_path: Path
) -> tuple[bytes, str] | None:
    """The two newer sources have no lightweight network fallback (a live
    ~1GB corpus download or a subtitle-list fetch has no place in an
    ordinary, offline build) — if neither an explicit override nor the
    stored snapshot exists, the source is skipped rather than blocking the
    build."""
    if source_path:
        return source_path.read_bytes(), source_path.name
    if default_path.is_file():
        return default_path.read_bytes(), default_path.name
    return None


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
            raise ValueError(f"Malformed frequency row {line_number}: {line!r}") from error

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


def match_source_to_entries(
    frequencies: dict[str, int],
    exact_candidates: dict[str, set[str]],
    inflection_candidates: dict[str, set[str]],
    entries: dict[str, DictionaryEntry],
) -> tuple[
    dict[str, dict[str, int]],
    dict[str, dict[str, object]],
    dict[str, dict[str, int]],
    dict[str, int],
]:
    """Pure form-to-entry matching for one source — independent of every
    other source, and independent of ranking/blending.

    Ambiguity must be judged across BOTH candidate sources together, not
    within each separately: a form can be an exact-listed alternate spelling
    of one entry (e.g. "alle" listed on "allé, alle") while also being the
    official inflected form of a completely different, usually far more
    common, word (e.g. "alle" is the plural of the quantifier "all"; "bør"
    is a noun on its own but also the present tense of the verb "burde").
    Checking `len(exact) == 1` alone lets that exact match silently win and
    absorb the other word's frequency wholesale, with `continue` skipping
    the inflection check entirely. Taking the union first catches this: a
    form claimed by two DIFFERENT entries — whether both claims are exact,
    both are inflectional, or one of each — is ambiguous and credited to
    neither, same as any other homograph collision."""
    evidence: dict[str, dict[str, int]] = defaultdict(
        lambda: {"exact": 0, "inflected": 0}
    )
    exposure: dict[str, dict[str, object]] = defaultdict(
        lambda: {
            "count": 0,
            "forms": 0,
            "eligibleBands": set(),
            "maximumCandidateCount": 0,
            "closedClassTiebreak": False,
        }
    )
    withheld: dict[str, dict[str, int]] = defaultdict(
        lambda: {"count": 0, "forms": 0}
    )
    stats = {
        "matchedSourceForms": 0,
        "exactSourceForms": 0,
        "uniqueInflectionSourceForms": 0,
        "ambiguousSourceForms": 0,
    }

    for form, count in frequencies.items():
        exact = exact_candidates.get(form, set())
        inflected = inflection_candidates.get(form, set())
        candidates = exact | inflected
        if len(candidates) > 1:
            stats["ambiguousSourceForms"] += 1
            for key in candidates:
                withheld[key]["count"] += count
                withheld[key]["forms"] += 1

            # A surface form proves exposure to a spelling, not which sense
            # produced it. The easiest candidate(s) receive only a separate
            # curriculum proxy; no ambiguous count becomes entry frequency.
            easiest_band = min(
                (band for key in candidates for band in entries[key].cefrs),
                key=CEFR_ORDER.__getitem__,
            )
            easiest_candidates = {
                key for key in candidates if easiest_band in entries[key].cefrs
            }
            # A same-CEFR tie that mixes a closed-class word with an
            # open-class one has a further tiebreak available: closed
            # classes dominate raw frequency (see CLOSED_WORD_CLASSES),
            # so narrow credit to just the closed-class side. A tie among
            # only-closed or only-open candidates has no such signal and
            # is left split across all of them, as before.
            closed_candidates = {
                key
                for key in easiest_candidates
                if is_closed_word_class(entries[key].gender)
            }
            tiebreak_applied = bool(closed_candidates) and closed_candidates != easiest_candidates
            if tiebreak_applied:
                easiest_candidates = closed_candidates
            for key in easiest_candidates:
                exposure[key]["count"] += count
                exposure[key]["forms"] += 1
                exposure[key]["eligibleBands"].add(easiest_band)
                exposure[key]["maximumCandidateCount"] = max(
                    exposure[key]["maximumCandidateCount"], len(candidates)
                )
                if tiebreak_applied:
                    exposure[key]["closedClassTiebreak"] = True
            continue
        if not candidates:
            continue

        # A single winning entry still gets credited to exactly one bucket
        # per form (never both), matching the original priority: an exact
        # spelling registration is stronger evidence than merely matching an
        # inflectional paradigm, and some entries' own lemma is redundantly
        # included in their own paradigm's decoded forms.
        key = next(iter(candidates))
        stats["matchedSourceForms"] += 1
        if key in exact:
            evidence[key]["exact"] += count
            stats["exactSourceForms"] += 1
        else:
            evidence[key]["inflected"] += count
            stats["uniqueInflectionSourceForms"] += 1

    normalized_exposure = {
        key: {
            **values,
            "eligibleBands": sorted(values["eligibleBands"], key=CEFR_ORDER.__getitem__),
        }
        for key, values in exposure.items()
    }
    return dict(evidence), normalized_exposure, dict(withheld), stats


def blend_sources(
    source_evidence: dict[str, dict[str, dict[str, int]]],
) -> dict[str, dict[str, object]]:
    """Combines each source's independent matching evidence into one ranked,
    blended record per dictionary entry. Raw counts aren't comparable across
    corpora of wildly different sizes, so each source is first min-max
    normalized (over log1p of its own matched counts) before being averaged —
    only over the sources that actually matched a given entry, so a word
    unique to one register still gets in via that source alone."""
    per_source_counts: dict[str, dict[str, dict[str, object]]] = {}
    combined_weights: dict[str, list[float]] = defaultdict(list)

    for source_id, evidence in source_evidence.items():
        counts: dict[str, dict[str, object]] = {}
        for key, forms in evidence.items():
            exact_count = forms["exact"]
            inflected_count = forms["inflected"]
            total = exact_count + inflected_count
            if exact_count and inflected_count:
                coverage = "exact-and-inflected"
            elif exact_count:
                coverage = "exact-lemma"
            else:
                coverage = "unique-inflection"
            counts[key] = {"count": total, "coverage": coverage}
        per_source_counts[source_id] = counts

        if not counts:
            continue
        log_values = {key: math.log1p(value["count"]) for key, value in counts.items()}
        floor = min(log_values.values())
        ceiling = max(log_values.values())
        span = ceiling - floor
        for key, log_value in log_values.items():
            normalized = 1.0 if span <= 0 else (log_value - floor) / span
            combined_weights[key].append(normalized)

    blended_weight = {
        key: sum(values) / len(values) for key, values in combined_weights.items()
    }
    ranked_keys = sorted(blended_weight, key=lambda key: (-blended_weight[key], key))

    records: dict[str, dict[str, object]] = {}
    for rank, key in enumerate(ranked_keys, start=1):
        records[key] = {
            "rank": rank,
            "weight": round(blended_weight[key], 6),
            "sources": {
                source_id: counts[key]
                for source_id, counts in per_source_counts.items()
                if key in counts
            },
        }
    return dict(sorted(records.items()))


def blend_exposure_sources(
    source_exposure: dict[str, dict[str, dict[str, object]]],
) -> dict[str, dict[str, object]]:
    """Rank ambiguous exposure while keeping it separate from entry counts."""
    weights: dict[str, list[float]] = defaultdict(list)
    eligible_bands: dict[str, set[str]] = defaultdict(set)
    closed_class_tiebreak: dict[str, bool] = defaultdict(bool)

    for source_id, evidence in source_exposure.items():
        if not evidence:
            continue
        log_values = {
            key: math.log1p(int(value["count"])) for key, value in evidence.items()
        }
        floor = min(log_values.values())
        ceiling = max(log_values.values())
        span = ceiling - floor
        for key, value in evidence.items():
            normalized = 1.0 if span <= 0 else (log_values[key] - floor) / span
            weights[key].append(normalized)
            eligible_bands[key].update(value["eligibleBands"])
            if value.get("closedClassTiebreak"):
                closed_class_tiebreak[key] = True

    blended = {key: sum(values) / len(values) for key, values in weights.items()}
    ranked = sorted(blended, key=lambda key: (-blended[key], key))
    return {
        key: {
            "rank": rank,
            "weight": round(blended[key], 6),
            "eligibleBands": sorted(eligible_bands[key], key=CEFR_ORDER.__getitem__),
            "basis": (
                "lowest-cefr-closed-class"
                if closed_class_tiebreak[key]
                else "lowest-cefr"
            ),
        }
        for rank, key in enumerate(ranked, start=1)
    }


def add_band_percentiles(
    entries: dict[str, dict[str, object]],
    entry_cefrs: dict[str, tuple[str, ...]],
) -> None:
    """Add a separate percentile for every CEFR band a grouped key uses."""
    keys_by_band: dict[str, list[str]] = defaultdict(list)
    for key in entries:
        for band in entry_cefrs[key]:
            keys_by_band[band].append(key)

    for band, keys in keys_by_band.items():
        weights = [entries[key]["weight"] for key in keys]
        floor = min(weights)
        ceiling = max(weights)
        span = ceiling - floor
        for key in keys:
            weight = entries[key]["weight"]
            percentile = 1.0 if span <= 0 else (weight - floor) / span
            entries[key].setdefault("bandPercentiles", {})[band] = round(
                percentile, 6
            )


def build_payload(
    dictionary_path: Path,
    clarino_source: Path | None = None,
    opensubtitles_source: Path | None = None,
    nb_ngram_source: Path | None = None,
    inflections_path: Path = Path("inflections-data.json"),
) -> dict[str, object]:
    entries = read_dictionary_entries(dictionary_path)
    exact_candidates, inflection_candidates = build_candidate_maps(
        entries, inflections_path
    )

    source_evidence: dict[str, dict[str, dict[str, int]]] = {}
    source_exposure: dict[str, dict[str, dict[str, object]]] = {}
    source_withheld: dict[str, dict[str, dict[str, int]]] = {}
    source_metadata: dict[str, dict[str, object]] = {}

    clarino_bytes, clarino_file = read_clarino_source_bytes(clarino_source)
    clarino_frequencies = parse_frequencies(clarino_bytes)
    clarino_evidence, clarino_exposure, clarino_withheld, clarino_stats = (
        match_source_to_entries(
            clarino_frequencies, exact_candidates, inflection_candidates, entries
        )
    )
    source_evidence["clarino"] = clarino_evidence
    source_exposure["clarino"] = clarino_exposure
    source_withheld["clarino"] = clarino_withheld
    source_metadata["clarino"] = {
        "source": CLARINO_SOURCE_PAGE,
        "sourceFile": clarino_file,
        "sourceCorpus": "Norsk aviskorpus (Bokmål)",
        "sourcePeriod": "live Corpuscle snapshot",
        "license": "CC BY-NC 4.0" if "top-100000" in clarino_file else "CC BY 3.0",
        "sourceLexicalForms": len(clarino_frequencies),
        "sourceTokenCount": sum(clarino_frequencies.values()),
        "matchedDictionaryEntries": len(clarino_evidence),
        "exposureProxyEntries": len(clarino_exposure),
        "withheldCandidateEntries": len(clarino_withheld),
        **clarino_stats,
    }

    optional_sources = (
        (
            "opensubtitles",
            opensubtitles_source,
            DEFAULT_OPENSUBTITLES_SOURCE,
            {
                "source": OPENSUBTITLES_SOURCE_PAGE,
                "sourceCorpus": "OpenSubtitles2018 (Bokmål)",
                "sourcePeriod": "2018 snapshot",
                "license": "CC BY-SA-4.0",
            },
        ),
        (
            "nbDigibok",
            nb_ngram_source,
            DEFAULT_NB_NGRAM_SOURCE,
            {
                "source": NB_NGRAM_SOURCE_PAGE,
                "sourceCorpus": "NB N-gram digibok (Bokmål books)",
                "sourcePeriod": "2021 snapshot (multi-century book corpus)",
                "license": "CC0",
            },
        ),
    )
    for source_id, override_path, default_path, metadata in optional_sources:
        loaded = read_optional_source_bytes(override_path, default_path)
        if loaded is None:
            print(
                f"Skipping {source_id}: no stored snapshot at {default_path} "
                "and no override provided."
            )
            continue
        source_bytes, source_file = loaded
        frequencies = parse_frequencies(source_bytes)
        evidence, exposure, withheld, stats = match_source_to_entries(
            frequencies, exact_candidates, inflection_candidates, entries
        )
        source_evidence[source_id] = evidence
        source_exposure[source_id] = exposure
        source_withheld[source_id] = withheld
        source_metadata[source_id] = {
            **metadata,
            "sourceFile": source_file,
            "sourceLexicalForms": len(frequencies),
            "sourceTokenCount": sum(frequencies.values()),
            "matchedDictionaryEntries": len(evidence),
            "exposureProxyEntries": len(exposure),
            "withheldCandidateEntries": len(withheld),
            **stats,
        }

    blended_entries = blend_sources(source_evidence)
    entry_cefrs = {key: entry.cefrs for key, entry in entries.items()}
    add_band_percentiles(blended_entries, entry_cefrs)
    exposure_proxies = blend_exposure_sources(source_exposure)
    for key, proxy in exposure_proxies.items():
        blended_entries.setdefault(key, {})["exposureProxy"] = proxy

    multi_sense_groups = sum(entry.row_count > 1 for entry in entries.values())
    multi_cefr_groups = sum(len(entry.cefrs) > 1 for entry in entries.values())
    reliable_entries = sum("rank" in record for record in blended_entries.values())

    return {
        "version": DATA_VERSION,
        "sources": source_metadata,
        "blendMethod": BLEND_METHOD,
        "inflectionSource": "Norsk Ordbank, CC BY 4.0",
        "method": "reliable-entry-counts-plus-lowest-cefr-exposure-proxies",
        "dictionaryEntries": len(entries),
        "dictionaryRows": sum(entry.row_count for entry in entries.values()),
        "multiSenseEntryGroups": multi_sense_groups,
        "multiCefrEntryGroups": multi_cefr_groups,
        "matchedDictionaryEntries": reliable_entries,
        "exposureProxyEntries": len(exposure_proxies),
        "coveredDictionaryEntries": len(blended_entries),
        "entries": dict(sorted(blended_entries.items())),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dictionary", type=Path, default=Path("norwegianWords.csv"))
    parser.add_argument(
        "--clarino-source",
        type=Path,
        help="Use an explicit CLARINO TSV instead of the stored deep export.",
    )
    parser.add_argument(
        "--opensubtitles-source",
        type=Path,
        help="Use an explicit OpenSubtitles TSV instead of the stored snapshot.",
    )
    parser.add_argument(
        "--nb-ngram-source",
        type=Path,
        help="Use an explicit NB N-gram TSV instead of the stored snapshot.",
    )
    parser.add_argument(
        "--inflections", type=Path, default=Path("inflections-data.json")
    )
    parser.add_argument(
        "--output", type=Path, default=Path("vocabulary-frequency.json")
    )
    args = parser.parse_args()

    payload = build_payload(
        args.dictionary,
        args.clarino_source,
        args.opensubtitles_source,
        args.nb_ngram_source,
        args.inflections,
    )
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {payload['matchedDictionaryEntries']:,} entry frequency records "
        f"blended from {len(payload['sources'])} source(s) to {args.output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
