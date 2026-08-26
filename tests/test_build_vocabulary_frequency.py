import csv
import importlib.util
import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location(
    "build_vocabulary_frequency",
    ROOT / "scripts" / "build-vocabulary-frequency.py",
)
build_vocabulary_frequency = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
import sys
sys.modules[SPEC.name] = build_vocabulary_frequency
SPEC.loader.exec_module(build_vocabulary_frequency)


def write_dictionary(path: Path) -> None:
    with path.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=["ord", "gender"])
        writer.writeheader()
        writer.writerows(
            [
                {"ord": "foto", "gender": "en"},
                {"ord": "hus", "gender": "et"},
                {"ord": "gå, ganga", "gender": "verb"},
                {"ord": "fisk", "gender": "en"},
                {"ord": "fiske", "gender": "verb"},
            ]
        )


def write_inflections(path: Path) -> None:
    path.write_text(
        json.dumps(
            {
                "forms": {
                    "n:hus:et": "huset|hus|husene",
                    "v:gå": "gå|går|gikk|gått",
                    # fisker is ambiguous between these two official
                    # paradigms and must not be credited to either.
                    "n:fisk:en": "fisken|fisker|fiskene",
                    "v:fiske": "fiske|fisker|fisket|fisket",
                },
                "dictionaryOnly": [],
                "dictionaryClassOverrides": [],
                "derivedFrom": {},
            }
        ),
        encoding="utf-8",
    )


class VocabularyFrequencyBuildTests(unittest.TestCase):
    def test_build_blends_three_sources_by_normalized_weight(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            dictionary = directory / "words.csv"
            clarino_source = directory / "clarino.tsv"
            opensubtitles_source = directory / "opensubtitles.tsv"
            nb_ngram_source = directory / "nb-ngram.tsv"
            inflections = directory / "inflections.json"

            write_dictionary(dictionary)
            write_inflections(inflections)

            clarino_source.write_text(
                "# generated test data\n"
                "100000\tFoto\n"
                "1000\thus\n"
                "900\thusene\n"
                "800\tgikk\n"
                "700\tganga\n"
                "600\tfisker\n"
                "500\tfoto\n",
                encoding="utf-8",
            )
            # A second source with different absolute counts (much larger
            # corpus) — blending must not let its raw scale dominate.
            opensubtitles_source.write_text(
                "2000000\thus\n50000\tfoto\n",
                encoding="utf-8",
            )
            nb_ngram_source.write_text(
                "300\tganga\n",
                encoding="utf-8",
            )

            payload = build_vocabulary_frequency.build_payload(
                dictionary,
                clarino_source,
                opensubtitles_source,
                nb_ngram_source,
                inflections,
            )

            self.assertEqual(payload["version"], 4)
            self.assertEqual(
                payload["method"],
                "entry-counts-exact-then-unique-official-inflection",
            )
            self.assertEqual(set(payload["sources"].keys()), {"clarino", "opensubtitles", "nbDigibok"})
            self.assertEqual(payload["sources"]["clarino"]["sourceLexicalForms"], 6)
            self.assertEqual(payload["sources"]["clarino"]["ambiguousSourceForms"], 1)
            self.assertEqual(payload["sources"]["clarino"]["uniqueInflectionSourceForms"], 2)
            self.assertEqual(payload["sources"]["clarino"]["license"], "CC BY 3.0")
            self.assertEqual(payload["sources"]["opensubtitles"]["license"], "CC BY-SA-4.0")
            self.assertEqual(payload["sources"]["nbDigibok"]["license"], "CC0")

            hus_record = payload["entries"]["hus|et"]
            self.assertEqual(hus_record["sources"]["clarino"]["count"], 1900)
            self.assertEqual(hus_record["sources"]["clarino"]["coverage"], "exact-and-inflected")
            self.assertEqual(hus_record["sources"]["opensubtitles"]["count"], 2000000)
            self.assertNotIn("nbDigibok", hus_record["sources"])

            ga_record = payload["entries"]["gå|verb"]
            self.assertEqual(ga_record["sources"]["clarino"]["count"], 1500)
            self.assertEqual(ga_record["sources"]["nbDigibok"]["count"], 300)

            self.assertNotIn("fisk|en", payload["entries"])
            self.assertNotIn("fiske|verb", payload["entries"])
            # Uppercase Foto is rejected; only the lowercase lexical use is
            # retained, so it ranks below the aggregated lemmas.
            self.assertEqual(payload["entries"]["foto|en"]["sources"]["clarino"]["count"], 500)

            # Every entry's blended weight is a plain 0-1 mean of its
            # per-source normalized (log1p, min-max) scores.
            for key, record in payload["entries"].items():
                self.assertGreaterEqual(record["weight"], 0.0)
                self.assertLessEqual(record["weight"], 1.0)
            ranks = [record["rank"] for record in payload["entries"].values()]
            self.assertEqual(sorted(ranks), list(range(1, len(ranks) + 1)))

    def test_exact_spelling_colliding_with_an_unrelated_entrys_inflection_is_ambiguous(self):
        # Regression case: "allé" lists "alle" as an alternate spelling, but
        # "alle" is ALSO the official plural inflection of the unrelated,
        # far more common quantifier "all" — checking exact candidates alone
        # let "allé" silently absorb all of "alle"'s frequency. Similarly,
        # "bør" is a noun in its own right, but is also the present tense of
        # the unrelated, more common verb "burde" — same collision shape.
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            dictionary = directory / "words.csv"
            clarino_source = directory / "clarino.tsv"
            inflections = directory / "inflections.json"

            dictionary.write_text(
                "ord,gender\n"
                '"allé, alle",en\n'
                "all,numeral\n"
                "bør,ei\n"
                "burde,verb\n",
                encoding="utf-8",
            )
            inflections.write_text(
                json.dumps(
                    {
                        "forms": {
                            "m:all": "all|all|alt||alle",
                            "v:burde": "burde|bør|burde|burdet",
                        },
                        "dictionaryOnly": [],
                        "dictionaryClassOverrides": [],
                        "derivedFrom": {},
                    }
                ),
                encoding="utf-8",
            )
            clarino_source.write_text(
                "5000\talle\n"
                "100\tall\n"
                "9000\tbør\n"
                "200\tburde\n",
                encoding="utf-8",
            )

            with mock.patch.object(
                build_vocabulary_frequency,
                "DEFAULT_OPENSUBTITLES_SOURCE",
                directory / "missing-opensubtitles.tsv",
            ), mock.patch.object(
                build_vocabulary_frequency,
                "DEFAULT_NB_NGRAM_SOURCE",
                directory / "missing-nb-ngram.tsv",
            ):
                payload = build_vocabulary_frequency.build_payload(
                    dictionary, clarino_source, None, None, inflections
                )

            entries = payload["entries"]
            # "allé" gets none of "alle"'s huge count — it has no other
            # evidence in this fixture, so it doesn't appear at all.
            self.assertNotIn("allé|en", entries)
            # "all" also doesn't gain "alle" (same as before this fix — the
            # collision is excluded from both, not reassigned), but keeps
            # its own unambiguous "all" evidence.
            self.assertEqual(entries["all|numeral"]["sources"]["clarino"]["count"], 100)

            # "bør" gets none of the modal verb's evidence — no other
            # evidence in this fixture, so it doesn't appear at all.
            self.assertNotIn("bør|ei", entries)
            # "burde" keeps its own unambiguous "burde" evidence.
            self.assertEqual(entries["burde|verb"]["sources"]["clarino"]["count"], 200)

    def test_dictionary_only_and_derived_paradigms_are_not_frequency_evidence(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            dictionary = directory / "words.csv"
            clarino_source = directory / "clarino.tsv"
            inflections = directory / "inflections.json"
            dictionary.write_text(
                "ord,gender\noppdiktet,adjective\navledet,adjective\n",
                encoding="utf-8",
            )
            clarino_source.write_text(
                "50\toppdiktede\n40\tavledede\n", encoding="utf-8"
            )
            inflections.write_text(
                json.dumps(
                    {
                        "forms": {
                            "a:oppdiktet": "oppdiktet|oppdiktet|oppdiktede",
                            "a:avledet": "avledet|avledet|avledede",
                        },
                        "dictionaryOnly": ["a:oppdiktet"],
                        "dictionaryClassOverrides": [],
                        "derivedFrom": {"a:avledet": "a:lede"},
                    }
                ),
                encoding="utf-8",
            )

            with mock.patch.object(
                build_vocabulary_frequency,
                "DEFAULT_OPENSUBTITLES_SOURCE",
                directory / "missing-opensubtitles.tsv",
            ), mock.patch.object(
                build_vocabulary_frequency,
                "DEFAULT_NB_NGRAM_SOURCE",
                directory / "missing-nb-ngram.tsv",
            ):
                payload = build_vocabulary_frequency.build_payload(
                    dictionary, clarino_source, None, None, inflections
                )
            self.assertEqual(payload["matchedDictionaryEntries"], 0)

    def test_missing_optional_sources_are_skipped_not_fatal(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            dictionary = directory / "words.csv"
            clarino_source = directory / "clarino.tsv"
            inflections = directory / "inflections.json"

            write_dictionary(dictionary)
            write_inflections(inflections)
            clarino_source.write_text("1000\thus\n", encoding="utf-8")

            # Neither override is passed and the default stored-snapshot
            # paths (patched here to guaranteed-absent files, regardless of
            # whether the real repo has these snapshots committed) don't
            # exist — both optional sources must be skipped, not fatal.
            with mock.patch.object(
                build_vocabulary_frequency,
                "DEFAULT_OPENSUBTITLES_SOURCE",
                directory / "missing-opensubtitles.tsv",
            ), mock.patch.object(
                build_vocabulary_frequency,
                "DEFAULT_NB_NGRAM_SOURCE",
                directory / "missing-nb-ngram.tsv",
            ):
                payload = build_vocabulary_frequency.build_payload(
                    dictionary, clarino_source, None, None, inflections
                )

            self.assertEqual(set(payload["sources"].keys()), {"clarino"})
            self.assertEqual(payload["entries"]["hus|et"]["weight"], 1.0)

    def test_band_percentile_normalizes_within_each_cefr_band_independently(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            dictionary = directory / "words.csv"
            clarino_source = directory / "clarino.tsv"
            inflections = directory / "inflections.json"

            with dictionary.open("w", encoding="utf-8", newline="") as target:
                writer = csv.DictWriter(target, fieldnames=["ord", "gender", "CEFR"])
                writer.writeheader()
                writer.writerows(
                    [
                        # A1 band: eple is globally rarer than diplomati (a B2
                        # word below), but must still rank as the *easiest*
                        # (top) word within its own A1 band.
                        {"ord": "eple", "gender": "et", "CEFR": "A1"},
                        {"ord": "banan", "gender": "en", "CEFR": "a1"},  # lowercase input
                        # B2 band: katedral is globally more common than banan
                        # (an A1 word above), but must still rank as the
                        # *hardest* (bottom) word within its own B2 band.
                        {"ord": "katedral", "gender": "en", "CEFR": "B2"},
                        {"ord": "diplomati", "gender": "et", "CEFR": "B2"},
                        # A single-entry band always gets percentile 1.0.
                        {"ord": "tsunami", "gender": "en", "CEFR": "C"},
                        # No/unrecognized CEFR falls back to the same default
                        # band as the runtime's getWordCefrLabel (B1).
                        {"ord": "ukjent", "gender": "et", "CEFR": ""},
                    ]
                )
            inflections.write_text(
                json.dumps({"forms": {}, "dictionaryOnly": [], "dictionaryClassOverrides": [], "derivedFrom": {}}),
                encoding="utf-8",
            )
            clarino_source.write_text(
                "1000\teple\n"
                "10\tbanan\n"
                "5\tkatedral\n"
                "2000000\tdiplomati\n"
                "42\ttsunami\n"
                "7\tukjent\n",
                encoding="utf-8",
            )

            with mock.patch.object(
                build_vocabulary_frequency,
                "DEFAULT_OPENSUBTITLES_SOURCE",
                directory / "missing-opensubtitles.tsv",
            ), mock.patch.object(
                build_vocabulary_frequency,
                "DEFAULT_NB_NGRAM_SOURCE",
                directory / "missing-nb-ngram.tsv",
            ):
                payload = build_vocabulary_frequency.build_payload(
                    dictionary, clarino_source, None, None, inflections
                )

            entries = payload["entries"]
            # Single shared source, so `weight` is a plain min-max
            # normalization of log1p(count) across all six matched entries.
            floor = math.log1p(5)  # katedral has the lowest count
            ceiling = math.log1p(2000000)  # diplomati has the highest
            span = ceiling - floor

            def expected_weight(count: int) -> float:
                return (math.log1p(count) - floor) / span

            for word, gender, count in [
                ("eple", "et", 1000),
                ("banan", "en", 10),
                ("katedral", "en", 5),
                ("diplomati", "et", 2000000),
            ]:
                self.assertAlmostEqual(
                    entries[f"{word}|{gender}"]["weight"],
                    expected_weight(count),
                    places=5,
                )

            # Within A1: eple ranks top (1.0) despite a far lower *global*
            # weight than diplomati (a B2 word) — the percentile never looks
            # outside its own band.
            self.assertAlmostEqual(entries["eple|et"]["bandPercentile"], 1.0, places=5)
            self.assertAlmostEqual(entries["banan|en"]["bandPercentile"], 0.0, places=5)

            # Within B2: katedral ranks bottom (0.0) despite a higher global
            # weight than banan (an A1 word above).
            self.assertAlmostEqual(entries["katedral|en"]["bandPercentile"], 0.0, places=5)
            self.assertAlmostEqual(entries["diplomati|et"]["bandPercentile"], 1.0, places=5)

            # A singleton band always normalizes to 1.0 (matches
            # blend_sources's own zero-span convention).
            self.assertEqual(entries["tsunami|en"]["bandPercentile"], 1.0)

            # Blank/unrecognized CEFR falls back to B1, same as the runtime;
            # as the only B1-band entry here it's likewise a singleton.
            self.assertEqual(entries["ukjent|et"]["bandPercentile"], 1.0)


if __name__ == "__main__":
    unittest.main()
