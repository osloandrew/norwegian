from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parent.parent
MODULE_PATH = ROOT / "scripts" / "build-updates-page.py"
SPEC = importlib.util.spec_from_file_location("build_updates_page", MODULE_PATH)
assert SPEC and SPEC.loader
build_updates_page = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = build_updates_page
SPEC.loader.exec_module(build_updates_page)


class UpdatesPageBuildTests(unittest.TestCase):
    def test_only_prefixed_commits_become_public_updates(self) -> None:
        git_output = (
            "2026-08-25T14:30:00+02:00\x1f[update] Better daily practice"
            "\x1fLearners now get a more focused practice set.\n\n"
            "Co-authored-by: Example <example@example.test>\x1e"
            "2026-08-25T13:00:00+02:00\x1fInternal refactor\x1fDo not publish.\x1e"
        )
        completed = subprocess.CompletedProcess([], 0, stdout=git_output, stderr="")
        with mock.patch.object(build_updates_page.subprocess, "run", return_value=completed):
            updates = build_updates_page.commit_updates(ROOT)

        self.assertEqual(len(updates), 1)
        self.assertEqual(updates[0].title, "Better daily practice")
        self.assertEqual(
            updates[0].summary,
            "Learners now get a more focused practice set.",
        )

    def test_empty_public_title_is_rejected(self) -> None:
        completed = subprocess.CompletedProcess(
            [], 0, stdout="2026-08-25T14:30:00+02:00\x1f[update]\x1f\x1e", stderr=""
        )
        with (
            mock.patch.object(build_updates_page.subprocess, "run", return_value=completed),
            self.assertRaises(build_updates_page.UpdateBuildError),
        ):
            build_updates_page.commit_updates(ROOT)

    def test_curated_sample_renders_as_crawlable_content(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary_root = Path(directory)
            curated = temporary_root / "updates.json"
            curated.write_text(
                json.dumps(
                    [
                        {
                            "publishedAt": "2026-08-25T12:00:00+02:00",
                            "title": "Sample improvement",
                            "summary": "A useful, user-facing explanation.",
                        }
                    ]
                ),
                encoding="utf-8",
            )
            updates = build_updates_page.curated_updates(curated)
            rendered = build_updates_page.render_entries(updates)

        self.assertIn("Sample improvement", rendered)
        self.assertIn("A useful, user-facing explanation.", rendered)
        self.assertIn('datetime="2026-08-25T12:00:00+02:00"', rendered)
        self.assertIn("25 August 2026", rendered)
        self.assertIn("12:00 Oslo Time", rendered)

    def test_timestamp_is_converted_to_oslo_local_time(self) -> None:
        timestamp = build_updates_page.parse_datetime("2026-08-25T11:15:00Z")
        self.assertEqual(
            build_updates_page.human_timestamp(timestamp),
            ("25 August 2026", "13:15 Oslo Time"),
        )

    def test_updates_are_wired_into_the_complete_deployment(self) -> None:
        workflow = (ROOT / ".github" / "workflows" / "pages.yml").read_text(
            encoding="utf-8"
        )
        sitemap_builder = (ROOT / "make-sitemap.py").read_text(encoding="utf-8")
        page_builder = (ROOT / "scripts" / "build-static-pages.py").read_text(
            encoding="utf-8"
        )

        self.assertIn("fetch-depth: 0", workflow)
        self.assertIn('f"{SITE}/updates/"', sitemap_builder)
        self.assertIn('"scripts/build-updates-page.py"', page_builder)

    def test_first_real_update_replaces_sample_and_later_updates_remain(self) -> None:
        sample = build_updates_page.parse_update(
            "2026-08-25T12:00:00+02:00", "Sample update"
        )
        first = build_updates_page.parse_update(
            "2026-08-25T13:00:00+02:00", "First real update"
        )
        second = build_updates_page.parse_update(
            "2026-08-25T14:00:00+02:00", "Second real update"
        )
        with (
            mock.patch.object(build_updates_page, "curated_updates", return_value=[sample]),
            mock.patch.object(build_updates_page, "commit_updates", return_value=[]),
        ):
            self.assertEqual(
                build_updates_page.combined_updates(ROOT, ROOT / "updates.json"),
                [sample],
            )
        with (
            mock.patch.object(build_updates_page, "curated_updates", return_value=[sample]),
            mock.patch.object(build_updates_page, "commit_updates", return_value=[first, second]),
        ):
            visible = build_updates_page.combined_updates(ROOT, ROOT / "updates.json")

        self.assertEqual([update.title for update in visible], ["Second real update", "First real update"])
        self.assertNotIn(sample, visible)


if __name__ == "__main__":
    unittest.main()
