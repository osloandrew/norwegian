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
SPEC.loader.exec_module(build_vocabulary_frequency)


class VocabularyFrequencyBuildTests(unittest.TestCase):
    def test_build_uses_lowercase_exact_dictionary_spellings_only(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            dictionary = directory / "words.csv"
            source = directory / "clarino.tsv"

            with dictionary.open("w", encoding="utf-8", newline="") as target:
                writer = csv.DictWriter(target, fieldnames=["ord"])
                writer.writeheader()
                writer.writerows(
                    [{"ord": "foto"}, {"ord": "hus"}, {"ord": "gå, ganga"}]
                )

            source.write_text(
                "# generated test data\n"
                "100000\tFoto\n"
                "90000\tVG\n"
                "1000\thus\n"
                "500\tfoto\n"
                "400\tganga\n"
                "300\thusene\n"
                "200\t12.000\n"
                "100\t.\n",
                encoding="utf-8",
            )

            payload = build_vocabulary_frequency.build_payload(dictionary, source)

            self.assertEqual(payload["method"], "exact-lowercase-dictionary-spelling-rank")
            self.assertEqual(payload["sourceLexicalForms"], 4)
            self.assertEqual(payload["matchedDictionarySpellings"], 3)
            self.assertEqual(payload["ranks"], {"foto": 2, "ganga": 3, "hus": 1})


if __name__ == "__main__":
    unittest.main()
