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
        overrides = set()

        record = BUILD.build_records(source, targets, overrides)["a:alene"]

        self.assertEqual(record[:5], [["alene"]] * 5)
        self.assertEqual(record[5:], [[], [], []])
        self.assertEqual(overrides, {"a:alene"})

    def test_missing_compound_inherits_same_gender_head_paradigm(self):
        records = {
            "n:foto:et": [["fotoet"], ["foto", "fotoer"], ["fotoa", "fotoene"]]
        }
        targets = {
            "noun": {"foto", "luftfoto", "feilfoto"},
            "adjective": set(),
            "verb": set(),
        }
        genders = {
            "foto": {"et"},
            "luftfoto": {"et"},
            "feilfoto": {"en"},
        }

        derived, dictionary_only = BUILD.add_dictionary_fallback_records(
            records, targets, genders, {"luft", "foto", "feilfoto"}
        )

        self.assertEqual(derived, {"n:luftfoto:et": "n:foto:et"})
        self.assertEqual(
            records["n:luftfoto:et"],
            [
                ["luftfotoet"],
                ["luftfoto", "luftfotoer"],
                ["luftfotoa", "luftfotoene"],
            ],
        )
        self.assertEqual(records["n:feilfoto:en"], [[], [], []])
        self.assertEqual(dictionary_only, {"n:feilfoto:en"})

    def test_noun_homographs_are_kept_separate_by_dictionary_gender(self):
        source = [
            ["far", 1, "NOUN", "NOUN_regular", ["762"], [["faren", "fedre", "fedrene"]]],
            [
                "far",
                2,
                "NOUN",
                "NOUN_regular",
                ["800", "810"],
                [["faret", "far", "fara"], ["faret", "far", "farene"]],
            ],
        ]
        targets = {"noun": {"far"}, "adjective": set(), "verb": set()}
        genders = {"far": {"en", "et"}}

        records = BUILD.build_records(source, targets, noun_genders=genders)

        self.assertEqual(
            records["n:far:en"],
            [["faren"], ["fedre"], ["fedrene"]],
        )
        self.assertEqual(
            records["n:far:et"],
            [["faret"], ["far"], ["fara", "farene"]],
        )

    def test_compound_boundaries_beat_accidental_longer_suffixes(self):
        records = {
            "n:dag:en": [["dagen"], ["dager"], ["dagene"]],
            "n:onsdag:en": [["onsdagen"], ["onsdager"], ["onsdagene"]],
            "n:venn:en": [["vennen"], ["venner"], ["vennene"]],
            "n:svenn:en": [["svennen"], ["svenner"], ["svennene"]],
            "n:anger:en": [["angeren"], ["angere"], ["angerne"]],
        }
        targets = {
            "noun": {"aksjonsdag", "fedrelandsvenn", "gamechanger"},
            "adjective": set(),
            "verb": set(),
        }
        genders = {
            "aksjonsdag": {"en"},
            "fedrelandsvenn": {"en"},
            "gamechanger": {"en"},
        }
        dictionary_lemmas = {
            "aksjon",
            "dag",
            "onsdag",
            "fedreland",
            "venn",
            "svenn",
            "gamechanger",
        }

        derived, dictionary_only = BUILD.add_dictionary_fallback_records(
            records, targets, genders, dictionary_lemmas
        )

        self.assertEqual(derived["n:aksjonsdag:en"], "n:dag:en")
        self.assertEqual(derived["n:fedrelandsvenn:en"], "n:venn:en")
        self.assertNotIn("n:gamechanger:en", derived)
        self.assertIn("n:gamechanger:en", dictionary_only)


if __name__ == "__main__":
    unittest.main()
