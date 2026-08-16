import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location(
    "build_inflections", ROOT / "scripts" / "build-inflections.py"
)
BUILD = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(BUILD)


class BuildInflectionsTests(unittest.TestCase):
    def test_homograph_from_another_word_class_is_not_merged(self):
        source = [
            [
                "annen",
                1,
                "DET",
                "DET_adj",
                ["det"],
                [["det_fem", "det_neuter", "det_definite", "det_plural", "", "", ""]],
            ],
            [
                "annen",
                2,
                "ADJ",
                "ADJ_regular",
                ["adj"],
                [["adj_plural", "adj_definite", "adj_neuter", "adj_comparative", "adj_superlative", "adj_superlative_definite"]],
            ],
        ]
        targets = {"noun": set(), "adjective": {"annen"}, "verb": set()}

        record = BUILD.build_records(source, targets)["a:annen"]

        self.assertEqual(record[0], ["annen"])
        self.assertEqual(record[2], ["adj_neuter"])
        self.assertEqual(record[4], ["adj_plural"])
        self.assertFalse(any("det_" in form for forms in record for form in forms))

    def test_dictionary_adjective_classification_wins_over_source_adverb(self):
        source = [["alene", 1, "ADV", "ADV", ["695"], [[]]]]
        targets = {"noun": set(), "adjective": {"alene"}, "verb": set()}

        record = BUILD.build_records(source, targets)["a:alene"]

        self.assertEqual(record[:5], [["alene"]] * 5)
        self.assertEqual(record[5:], [[], [], []])


if __name__ == "__main__":
    unittest.main()
