import csv
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAIR_PATH = ROOT / "data" / "synonym-pairs.json"
DICTIONARY_PATH = ROOT / "norwegianWords.csv"
NOUN_GENDERS = {"en", "ei", "et", "en-et", "en-ei", "ei-et", "en-ei-et"}


def primary(value):
    return value.split(",", 1)[0].strip().lower()


def word_class(value):
    value = value.strip().lower()
    return "noun" if value in NOUN_GENDERS else value


class SynonymPairDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.snapshot = json.loads(PAIR_PATH.read_text(encoding="utf-8"))
        with DICTIONARY_PATH.open(encoding="utf-8-sig", newline="") as source:
            cls.entries = {
                (primary(row["ord"]), word_class(row["gender"]))
                for row in csv.DictReader(source)
            }

    def test_snapshot_has_attributable_reciprocal_pairs(self):
        self.assertEqual(self.snapshot["version"], 1)
        self.assertEqual(self.snapshot["source"]["license"], "CC BY 4.0")
        self.assertIn("reciprocal definition-confirmed", self.snapshot["selection"])
        self.assertGreaterEqual(len(self.snapshot["pairs"]), 400)

    def test_every_pair_resolves_to_the_same_part_of_speech(self):
        for target_key, answers in self.snapshot["pairs"].items():
            target, part_of_speech = target_key.rsplit("|", 1)
            self.assertIn((target, part_of_speech), self.entries)
            self.assertIsInstance(answers, list)
            self.assertGreater(len(answers), 0)
            for answer in answers:
                self.assertNotEqual(answer, target)
                self.assertIn((answer, part_of_speech), self.entries)
                self.assertIn(
                    target,
                    self.snapshot["pairs"].get(f"{answer}|{part_of_speech}", []),
                )
