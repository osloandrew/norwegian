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
        writer = csv.DictWriter(target, fieldnames=["ord", "gender", "CEFR"])
        writer.writeheader()
        writer.writerows(
            [
                {"ord": "foto", "gender": "en", "CEFR": "B1"},
                {"ord": "hus", "gender": "et", "CEFR": "A1"},
                {"ord": "gå, ganga", "gender": "verb", "CEFR": "A1"},
                {"ord": "fisk", "gender": "en", "CEFR": "B1"},
                {"ord": "fiske", "gender": "verb", "CEFR": "B1"},
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

            self.assertEqual(payload["version"], 5)
            self.assertEqual(
                payload["method"],
                "reliable-entry-counts-plus-lowest-cefr-exposure-proxies",
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

            for key in ("fisk|en", "fiske|verb"):
                self.assertNotIn("rank", payload["entries"][key])
                self.assertEqual(
                    payload["entries"][key]["exposureProxy"]["eligibleBands"],
                    ["B1"],
                )
            # Uppercase Foto is rejected; only the lowercase lexical use is
            # retained, so it ranks below the aggregated lemmas.
            self.assertEqual(payload["entries"]["foto|en"]["sources"]["clarino"]["count"], 500)

            # Every entry's blended weight is a plain 0-1 mean of its
            # per-source normalized (log1p, min-max) scores.
            for key, record in payload["entries"].items():
                if "weight" not in record:
                    continue
                self.assertGreaterEqual(record["weight"], 0.0)
                self.assertLessEqual(record["weight"], 1.0)
            ranks = [
                record["rank"]
                for record in payload["entries"].values()
                if "rank" in record
            ]
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
                "ord,gender,CEFR\n"
                '"allé, alle",en,B1\n'
                "all,numeral,A1\n"
                "bør,ei,B1\n"
                "burde,verb,A2\n",
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
            self.assertEqual(
                entries["all|numeral"]["exposureProxy"]["eligibleBands"], ["A1"]
            )

            # "bør" gets none of the modal verb's evidence — no other
            # evidence in this fixture, so it doesn't appear at all.
            self.assertNotIn("bør|ei", entries)
            # "burde" keeps its own unambiguous "burde" evidence.
            self.assertEqual(entries["burde|verb"]["sources"]["clarino"]["count"], 200)
            self.assertEqual(
                entries["burde|verb"]["exposureProxy"]["eligibleBands"], ["A2"]
            )

    def test_closed_class_word_wins_a_same_cefr_ambiguity_tie(self):
        # Regression case: the dictionary's own "i" (preposition, A1) and
        # "i" (the letter name, noun, A1) tie on CEFR, so the plain
        # lowest-CEFR rule alone can't tell them apart. Real corpora are
        # dominated by closed-class words regardless of curriculum level,
        # so the preposition should get the shared ambiguous volume and
        # the noun should not — though the noun can still earn its own,
        # much smaller, independent rank from a form the preposition could
        # never produce ("ier").
        #
        # A tie between two closed-class senses ("for" as conjunction vs.
        # preposition, both A1) has no such signal and must stay split
        # across both, exactly as before this tiebreak existed.
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            dictionary = directory / "words.csv"
            clarino_source = directory / "clarino.tsv"
            inflections = directory / "inflections.json"

            dictionary.write_text(
                "ord,gender,CEFR\n"
                "i,preposition,A1\n"
                "i,en,A1\n"
                "for,conjunction,A1\n"
                "for,preposition,A1\n",
                encoding="utf-8",
            )
            inflections.write_text(
                json.dumps(
                    {
                        "forms": {"n:i:en": "ien|ier|iene"},
                        "dictionaryOnly": [],
                        "dictionaryClassOverrides": [],
                        "derivedFrom": {},
                    }
                ),
                encoding="utf-8",
            )
            clarino_source.write_text(
                "5000\ti\n30\tier\n700\tfor\n",
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

            self.assertEqual(
                entries["i|preposition"]["exposureProxy"],
                {
                    "rank": 1,
                    "weight": 1.0,
                    "eligibleBands": ["A1"],
                    "basis": "lowest-cefr-closed-class",
                },
            )
            self.assertNotIn("sources", entries["i|preposition"])

            self.assertNotIn("exposureProxy", entries["i|en"])
            self.assertEqual(entries["i|en"]["sources"]["clarino"]["count"], 30)

            # "for" ties two closed classes against each other — no signal
            # to prefer one, so both keep the shared exposure proxy.
            for key in ("for|conjunction", "for|preposition"):
                self.assertEqual(
                    entries[key]["exposureProxy"]["basis"], "lowest-cefr"
                )
                self.assertNotIn("sources", entries[key])

    def test_dictionary_only_and_derived_paradigms_are_not_frequency_evidence(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            dictionary = directory / "words.csv"
            clarino_source = directory / "clarino.tsv"
            inflections = directory / "inflections.json"
            dictionary.write_text(
                "ord,gender,CEFR\n"
                "oppdiktet,adjective,B2\n"
                "avledet,adjective,B2\n",
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
                        {"ord": "ukjent", "gender": "et", "CEFR": "B1"},
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
            self.assertAlmostEqual(entries["eple|et"]["bandPercentiles"]["A1"], 1.0, places=5)
            self.assertAlmostEqual(entries["banan|en"]["bandPercentiles"]["A1"], 0.0, places=5)

            # Within B2: katedral ranks bottom (0.0) despite a higher global
            # weight than banan (an A1 word above).
            self.assertAlmostEqual(entries["katedral|en"]["bandPercentiles"]["B2"], 0.0, places=5)
            self.assertAlmostEqual(entries["diplomati|et"]["bandPercentiles"]["B2"], 1.0, places=5)

            # A singleton band always normalizes to 1.0 (matches
            # blend_sources's own zero-span convention).
            self.assertEqual(entries["tsunami|en"]["bandPercentiles"]["C"], 1.0)

            self.assertEqual(entries["ukjent|et"]["bandPercentiles"]["B1"], 1.0)

    def test_same_headword_and_class_preserves_every_sense_band(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            dictionary = directory / "words.csv"
            source = directory / "clarino.tsv"
            inflections = directory / "inflections.json"
            dictionary.write_text(
                "ord,gender,CEFR,engelsk\n"
                "bank,en,A2,financial institution\n"
                "bank,en,B1,thump\n"
                "eple,et,A2,apple\n"
                "dom,en,B1,judgment\n",
                encoding="utf-8",
            )
            source.write_text("50\tbank\n100\teple\n10\tdom\n", encoding="utf-8")
            inflections.write_text(
                json.dumps(
                    {
                        "forms": {},
                        "dictionaryOnly": [],
                        "dictionaryClassOverrides": [],
                        "derivedFrom": {},
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
                    dictionary, source, None, None, inflections
                )

            bank = payload["entries"]["bank|en"]
            self.assertEqual(payload["dictionaryRows"], 4)
            self.assertEqual(payload["multiCefrEntryGroups"], 1)
            self.assertEqual(set(bank["bandPercentiles"]), {"A2", "B1"})
            self.assertEqual(bank["bandPercentiles"]["A2"], 0.0)
            self.assertEqual(bank["bandPercentiles"]["B1"], 1.0)

    def test_invalid_cefr_fails_the_generated_data_build(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            dictionary = Path(temp_dir) / "words.csv"
            dictionary.write_text(
                "ord,gender,CEFR\nhus,et,\n", encoding="utf-8"
            )
            with self.assertRaisesRegex(ValueError, "dictionary row 2"):
                build_vocabulary_frequency.read_dictionary_entries(dictionary)


if __name__ == "__main__":
    unittest.main()
