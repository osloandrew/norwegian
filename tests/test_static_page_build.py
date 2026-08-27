from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parent.parent
MODULE_PATH = ROOT / "scripts" / "build-static-pages.py"
sys.path.insert(0, str(MODULE_PATH.parent))
SPEC = importlib.util.spec_from_file_location("build_static_pages", MODULE_PATH)
assert SPEC and SPEC.loader
build_static_pages = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = build_static_pages
SPEC.loader.exec_module(build_static_pages)


class StaticPageBuildTests(unittest.TestCase):
    def csv_dataset(self, fieldnames: tuple[str, ...], rows: list[tuple[str, ...]]):
        return build_static_pages.CsvDataset(
            fieldnames,
            tuple(dict(zip(fieldnames, row, strict=True)) for row in rows),
        )

    def test_generated_page_bases_resolve_at_both_hosting_positions(self) -> None:
        cases = [
            ("https://example.test/norwegian/word/forgjeves/", "../../", "https://example.test/norwegian/"),
            ("http://127.0.0.1:3000/word/forgjeves/", "../../", "http://127.0.0.1:3000/"),
            ("https://example.test/norwegian/story/bakeriet/", "../../", "https://example.test/norwegian/"),
            ("http://127.0.0.1:3000/story/bakeriet/", "../../", "http://127.0.0.1:3000/"),
            ("https://example.test/norwegian/stories/", "../", "https://example.test/norwegian/"),
            ("http://127.0.0.1:3000/stories/", "../", "http://127.0.0.1:3000/"),
            ("https://example.test/norwegian/sentences/", "../", "https://example.test/norwegian/"),
            ("http://127.0.0.1:3000/word-game/", "../", "http://127.0.0.1:3000/"),
            ("https://example.test/norwegian/pronunciation/", "../", "https://example.test/norwegian/"),
            ("https://example.test/norwegian/updates/", "../", "https://example.test/norwegian/"),
        ]
        for page_url, base_href, expected_root in cases:
            with self.subTest(page_url=page_url):
                self.assertEqual(urllib.parse.urljoin(page_url, base_href), expected_root)

    def test_generated_page_ignores_do_not_hide_source_audio(self) -> None:
        for audio_path in (
            "Resources/Words/example.m4a",
            "Resources/Sentences/example.m4a",
            "Resources/Audio/example.m4a",
        ):
            with self.subTest(audio_path=audio_path):
                result = subprocess.run(
                    ["git", "check-ignore", "--no-index", "--quiet", audio_path],
                    cwd=ROOT,
                    check=False,
                )
                self.assertEqual(
                    result.returncode,
                    1,
                    f"source audio must not be ignored: {audio_path}",
                )

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

    def test_incremental_word_diff_propagates_through_alternative_spellings(self) -> None:
        fields = ("ord", "gender", "definisjon")
        old_words = self.csv_dataset(
            fields,
            [
                ("andre, annen", "pronoun", "old shared definition"),
                ("annen", "pronoun", "primary definition"),
                ("urørt", "adjective", "unchanged"),
            ],
        )
        new_words = self.csv_dataset(
            fields,
            [
                ("andre, annen", "pronoun", "updated shared definition"),
                ("annen", "pronoun", "primary definition"),
                ("urørt", "adjective", "unchanged"),
                ("ny", "adjective", "new word"),
            ],
        )
        empty_stories = self.csv_dataset(("titleNorwegian",), [])

        plan = build_static_pages.plan_incremental_build(
            old_words,
            new_words,
            (empty_stories,),
            (empty_stories,),
            {},
            {},
        )

        self.assertEqual(set(plan.words), {"andre", "annen", "ny"})
        self.assertTrue(plan.words_changed)
        self.assertTrue(plan.rebuild_features)
        self.assertFalse(plan.stories_changed)

    def test_story_and_question_diffs_select_only_dependent_story_pages(self) -> None:
        empty_words = self.csv_dataset(("ord",), [])
        fields = ("titleNorwegian", "norwegian", "english")
        old_stories = self.csv_dataset(
            fields,
            [
                ("Endret historie", "Gammel tekst.", "Old text."),
                ("Nye spørsmål", "Samme tekst.", "Same text."),
                ("Fjernet spørsmål", "Samme tekst.", "Same text."),
                ("Urørt historie", "Samme tekst.", "Same text."),
            ],
        )
        new_stories = self.csv_dataset(
            fields,
            [
                ("Endret historie", "Ny tekst.", "New text."),
                ("Nye spørsmål", "Samme tekst.", "Same text."),
                ("Fjernet spørsmål", "Samme tekst.", "Same text."),
                ("Urørt historie", "Samme tekst.", "Same text."),
                ("Ny historie", "Helt ny.", "Brand new."),
            ],
        )
        old_questions = {
            "Nye spørsmål": {"questions": [{"prompt": "Gammel?"}]},
            "Fjernet spørsmål": {"questions": [{"prompt": "Borte?"}]},
        }
        new_questions = {
            "Nye spørsmål": {"questions": [{"prompt": "Ny?"}]},
        }

        plan = build_static_pages.plan_incremental_build(
            empty_words,
            empty_words,
            (old_stories,),
            (new_stories,),
            old_questions,
            new_questions,
        )

        self.assertEqual(
            set(plan.stories),
            {"Endret historie", "Nye spørsmål", "Fjernet spørsmål", "Ny historie"},
        )
        self.assertNotIn("Urørt historie", plan.stories)
        self.assertTrue(plan.stories_changed)
        self.assertTrue(plan.questions_changed)
        self.assertTrue(plan.rebuild_story_index)
        self.assertFalse(plan.rebuild_features)

    def test_story_csv_files_are_diffed_independently_by_own_columns(self) -> None:
        """Two story CSVs with different schemas (e.g. the authentic catalog's
        extra source/license columns) must each be compared against their own
        prior revision, not merged into one column set — see the
        independent-diffing note on plan_incremental_build."""
        empty_words = self.csv_dataset(("ord",), [])
        original_fields = ("titleNorwegian", "norwegian", "english")
        old_original = self.csv_dataset(
            original_fields,
            [
                ("Delt tittel", "Gammel norsk.", "Old English."),
                ("Kun original", "Uendret.", "Unchanged."),
            ],
        )
        new_original = self.csv_dataset(
            original_fields,
            [
                ("Delt tittel", "Ny norsk.", "New English."),
                ("Kun original", "Uendret.", "Unchanged."),
            ],
        )
        authentic_fields = ("titleNorwegian", "norwegian", "english", "source", "license")
        old_authentic = self.csv_dataset(
            authentic_fields,
            [("Kun autentisk", "Autentisk tekst.", "Authentic text.", "vg.no", "CC-BY")],
        )
        new_authentic = self.csv_dataset(
            authentic_fields,
            # Only the license column changes; norwegian/english text is
            # identical. This would be invisible if rows were compared using
            # only the original catalog's columns.
            [("Kun autentisk", "Autentisk tekst.", "Authentic text.", "vg.no", "CC-BY-SA")],
        )

        plan = build_static_pages.plan_incremental_build(
            empty_words,
            empty_words,
            (old_original, old_authentic),
            (new_original, new_authentic),
            {},
            {},
        )

        self.assertEqual(set(plan.stories), {"Delt tittel", "Kun autentisk"})
        self.assertNotIn("Kun original", plan.stories)
        self.assertTrue(plan.stories_changed)

    def test_question_only_change_does_not_rebuild_story_index(self) -> None:
        empty_words = self.csv_dataset(("ord",), [])
        stories = self.csv_dataset(
            ("titleNorwegian", "norwegian"),
            [("Historien", "Tekst.")],
        )
        plan = build_static_pages.plan_incremental_build(
            empty_words,
            empty_words,
            (stories,),
            (stories,),
            {"Historien": {"questions": []}},
            {"Historien": {"questions": [{"prompt": "Hva?"}]}},
        )

        self.assertEqual(plan.stories, ("Historien",))
        self.assertTrue(plan.questions_changed)
        self.assertFalse(plan.stories_changed)
        self.assertFalse(plan.rebuild_story_index)

    def test_selective_capture_falls_back_for_an_excessive_change_set(self) -> None:
        values = tuple(
            f"word-{index}"
            for index in range(build_static_pages.MAX_SELECTIVE_PAGES + 1)
        )
        with mock.patch.object(build_static_pages, "run") as run:
            build_static_pages.capture_selected(
                "scripts/capture-word-pages.py", "--words", values, ROOT
            )
        command = run.call_args.args[0]
        self.assertIn("--all", command)
        self.assertNotIn("--words", command)

    def test_cache_completeness_is_checked_before_current_deletions_are_pruned(self) -> None:
        events: list[str] = []
        with tempfile.TemporaryDirectory() as directory:
            site_root = Path(directory)
            snapshot_dir = site_root / ".pages-cache"
            with (
                mock.patch.object(
                    build_static_pages,
                    "source_slugs",
                    side_effect=[
                        {"word"},
                        *({"story"} for _ in build_static_pages.existing_story_csv_paths(ROOT)),
                    ],
                ),
                mock.patch.object(
                    build_static_pages, "snapshot_is_available", return_value=True
                ),
                mock.patch.object(
                    build_static_pages,
                    "cached_site_is_complete",
                    side_effect=lambda *_: events.append("cache-check") or True,
                ),
                mock.patch.object(
                    build_static_pages,
                    "prune_stale_pages",
                    side_effect=lambda *_: events.append("prune") or [],
                ),
                mock.patch.object(
                    build_static_pages, "incremental_capture"
                ) as incremental_capture,
                mock.patch.object(build_static_pages, "full_capture") as full_capture,
                mock.patch.object(build_static_pages, "run"),
                mock.patch.object(build_static_pages, "write_snapshot"),
            ):
                build_static_pages.build(
                    site_root,
                    stamp_assets=False,
                    incremental=True,
                    snapshot_dir=snapshot_dir,
                )

        self.assertEqual(events[0], "cache-check")
        self.assertIn("prune", events[1:])
        incremental_capture.assert_called_once_with(
            site_root.resolve(), snapshot_dir.resolve()
        )
        full_capture.assert_not_called()

    def test_incomplete_cached_page_inventory_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            site_root = Path(directory)
            snapshot_dir = site_root / ".pages-cache"
            snapshot_dir.mkdir()
            (snapshot_dir / "metadata.json").write_text(
                json.dumps({"version": build_static_pages.SNAPSHOT_VERSION}),
                encoding="utf-8",
            )
            (snapshot_dir / "norwegianWords.csv").write_text(
                "ord\nhus\n", encoding="utf-8"
            )
            (snapshot_dir / "norwegianStories.csv").write_text(
                "titleNorwegian\nHistorien\n", encoding="utf-8"
            )
            (snapshot_dir / "norwegianAuthenticStories.csv").write_text(
                "", encoding="utf-8"
            )
            (snapshot_dir / "storyQuestions.json").write_text(
                "{}", encoding="utf-8"
            )

            for path in (
                site_root / "word" / "hus" / "index.html",
                site_root / "story" / "historien" / "index.html",
                site_root / "stories" / "index.html",
                site_root / "sentences" / "index.html",
                site_root / "word-game" / "index.html",
                site_root / "pronunciation" / "index.html",
                site_root / "updates" / "index.html",
                site_root / "sitemap.xml",
                site_root / "page-manifest.json",
            ):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("fixture", encoding="utf-8")

            self.assertTrue(build_static_pages.snapshot_is_available(snapshot_dir))
            self.assertTrue(
                build_static_pages.cached_site_is_complete(site_root, snapshot_dir)
            )

            (site_root / "word" / "hus" / "index.html").unlink()
            self.assertFalse(
                build_static_pages.cached_site_is_complete(site_root, snapshot_dir)
            )

    def test_workflow_cache_separates_renderer_and_data_fingerprints(self) -> None:
        workflow = (ROOT / ".github" / "workflows" / "pages.yml").read_text(
            encoding="utf-8"
        )
        key_line = next(line for line in workflow.splitlines() if "key: pages-v" in line)
        renderer_fingerprint, data_fingerprint = key_line.split(" }}-${{ hashFiles(", 1)

        for renderer_input in (
            "index.html",
            "*.js",
            "vendor/**",
            "styles/**/*.css",
            "scripts/**/*.py",
        ):
            self.assertIn(renderer_input, renderer_fingerprint)
        for incrementally_diffed_input in build_static_pages.SNAPSHOT_FILENAMES:
            self.assertNotIn(incrementally_diffed_input, renderer_fingerprint)
            self.assertIn(incrementally_diffed_input, data_fingerprint)
        self.assertIn("restore-keys:", workflow)
        self.assertIn("cancel-in-progress: true", workflow)
        self.assertIn("build-static-pages.py --incremental", workflow)


if __name__ == "__main__":
    unittest.main()
