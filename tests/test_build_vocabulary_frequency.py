import csv
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


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


class VocabularyFrequencyBuildTests(unittest.TestCase):
    def test_build_aggregates_unique_official_inflections_by_entry(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            dictionary = directory / "words.csv"
            source = directory / "clarino.tsv"
            inflections = directory / "inflections.json"

            with dictionary.open("w", encoding="utf-8", newline="") as target:
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

            source.write_text(
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
            inflections.write_text(
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

            payload = build_vocabulary_frequency.build_payload(
                dictionary, source, inflections
            )

            self.assertEqual(payload["version"], 2)
            self.assertEqual(
                payload["method"],
                "entry-counts-exact-then-unique-official-inflection",
            )
            self.assertEqual(payload["sourceLexicalForms"], 6)
            self.assertEqual(payload["matchedDictionaryEntries"], 3)
            self.assertEqual(payload["ambiguousSourceForms"], 1)
            self.assertEqual(payload["uniqueInflectionSourceForms"], 2)
            self.assertEqual(payload["entries"]["hus|et"]["count"], 1900)
            self.assertEqual(
                payload["entries"]["hus|et"]["coverage"],
                "exact-and-inflected",
            )
            self.assertEqual(payload["entries"]["gå|verb"]["count"], 1500)
            self.assertNotIn("fisk|en", payload["entries"])
            self.assertNotIn("fiske|verb", payload["entries"])
            # Uppercase Foto is rejected; only the lowercase lexical use is
            # retained, so it ranks below the aggregated lemmas.
            self.assertEqual(payload["entries"]["foto|en"]["count"], 500)

    def test_dictionary_only_and_derived_paradigms_are_not_frequency_evidence(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            dictionary = directory / "words.csv"
            source = directory / "clarino.tsv"
            inflections = directory / "inflections.json"
            dictionary.write_text(
                "ord,gender\noppdiktet,adjective\navledet,adjective\n",
                encoding="utf-8",
            )
            source.write_text("50\toppdiktede\n40\tavledede\n", encoding="utf-8")
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

            payload = build_vocabulary_frequency.build_payload(
                dictionary, source, inflections
            )
            self.assertEqual(payload["matchedDictionaryEntries"], 0)


if __name__ == "__main__":
    unittest.main()
