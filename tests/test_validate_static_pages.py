from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
MODULE_PATH = ROOT / "scripts" / "validate-static-pages.py"
sys.path.insert(0, str(MODULE_PATH.parent))
SPEC = importlib.util.spec_from_file_location("validate_static_pages", MODULE_PATH)
assert SPEC and SPEC.loader
validate_static_pages = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = validate_static_pages
SPEC.loader.exec_module(validate_static_pages)


class ValidateStaticPagesTests(unittest.TestCase):
    def test_source_values_keeps_first_case_variant_for_shared_slug(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            source = Path(temporary_directory) / "words.csv"
            source.write_text(
                "ord,definition\nID,identification\nid,psychoanalytic concept\n",
                encoding="utf-8",
            )

            values = validate_static_pages.source_values(
                source, "ord", primary_word=True
            )

        self.assertEqual(values, {"id": "ID"})


if __name__ == "__main__":
    unittest.main()
