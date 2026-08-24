from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
import urllib.parse
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
MODULE_PATH = ROOT / "scripts" / "build-static-pages.py"
SPEC = importlib.util.spec_from_file_location("build_static_pages", MODULE_PATH)
assert SPEC and SPEC.loader
build_static_pages = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = build_static_pages
SPEC.loader.exec_module(build_static_pages)


class StaticPageBuildTests(unittest.TestCase):
    def test_generated_page_bases_resolve_at_both_hosting_positions(self) -> None:
        cases = [
            ("https://example.test/norwegian/word/forgjeves/", "../../", "https://example.test/norwegian/"),
            ("http://127.0.0.1:3000/word/forgjeves/", "../../", "http://127.0.0.1:3000/"),
            ("https://example.test/norwegian/story/bakeriet/", "../../", "https://example.test/norwegian/"),
            ("http://127.0.0.1:3000/story/bakeriet/", "../../", "http://127.0.0.1:3000/"),
            ("https://example.test/norwegian/stories/", "../", "https://example.test/norwegian/"),
            ("http://127.0.0.1:3000/stories/", "../", "http://127.0.0.1:3000/"),
        ]
        for page_url, base_href, expected_root in cases:
            with self.subTest(page_url=page_url):
                self.assertEqual(urllib.parse.urljoin(page_url, base_href), expected_root)

    def test_source_slugs_match_current_page_counts(self) -> None:
        words = build_static_pages.source_slugs(ROOT / "norwegianWords.csv", "ord", primary_word=True)
        stories = build_static_pages.source_slugs(ROOT / "norwegianStories.csv", "titleNorwegian")
        self.assertGreater(len(words), 29_000)
        self.assertGreater(len(stories), 300)
        self.assertIn("forgjeves", words)
        self.assertIn("svarte-hull", stories)

    def test_source_slug_collisions_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "words.csv"
            path.write_text("ord\na/b\na b\n", encoding="utf-8")
            with self.assertRaises(build_static_pages.BuildError):
                build_static_pages.source_slugs(path, "ord", primary_word=True)

    def test_prune_removes_only_stale_slug_directories(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            pages = Path(directory) / "word"
            (pages / "keep").mkdir(parents=True)
            (pages / "stale").mkdir()
            (pages / "keep" / "index.html").write_text("keep", encoding="utf-8")
            removed = build_static_pages.prune_stale_pages(pages, {"keep"})
            self.assertEqual(removed, [pages / "stale"])
            self.assertTrue((pages / "keep" / "index.html").is_file())
            self.assertFalse((pages / "stale").exists())

    def test_prune_fails_closed_on_unexpected_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            pages = Path(directory) / "word"
            pages.mkdir()
            (pages / "README.txt").write_text("unexpected", encoding="utf-8")
            with self.assertRaises(build_static_pages.BuildError):
                build_static_pages.prune_stale_pages(pages, set())


if __name__ == "__main__":
    unittest.main()
