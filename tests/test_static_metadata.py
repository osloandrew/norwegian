from __future__ import annotations

import importlib.util
import json
import re
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
MODULE_PATH = ROOT / "scripts" / "static_metadata.py"
SPEC = importlib.util.spec_from_file_location("static_metadata", MODULE_PATH)
assert SPEC and SPEC.loader
static_metadata = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = static_metadata
SPEC.loader.exec_module(static_metadata)


BASE_HTML = """<html><head>
<title>{title}</title>
<meta name="description" content="{description}">
<meta property="og:image" content="{image}">
</head><body></body></html>"""


def structured_payload(source: str) -> dict[str, object]:
    match = re.search(
        r'<script type="application/ld\+json" id="page-structured-data">(.*?)</script>',
        source,
    )
    assert match
    return json.loads(match.group(1))


def node(payload: dict[str, object], node_type: str) -> dict[str, object]:
    return next(item for item in payload["@graph"] if item.get("@type") == node_type)


class StaticMetadataTests(unittest.TestCase):
    def test_word_metadata_is_specific_complete_and_idempotent(self) -> None:
        source = BASE_HTML.format(
            title="lune (noun) – Norwegian-English Dictionary",
            description="Learn the Norwegian noun &quot;lune&quot;, meaning &quot;mood&quot;.",
            image="https://example.test/og.png",
        )
        canonical = "https://osloandrew.github.io/norwegian/word/lune/"
        enriched = static_metadata.enrich_word_html(
            source, word="lune", canonical=canonical
        )
        self.assertEqual(
            source.split("<body>", 1)[1], enriched.split("<body>", 1)[1]
        )
        payload = structured_payload(enriched)
        term = node(payload, "DefinedTerm")
        self.assertEqual(term["name"], "lune")
        self.assertEqual(term["url"], canonical)
        self.assertEqual(
            term["description"], 'Learn the Norwegian noun "lune", meaning "mood".'
        )
        self.assertEqual(len(node(payload, "BreadcrumbList")["itemListElement"]), 2)
        for key in (
            "og:site_name",
            "og:image:alt",
            "twitter:title",
            "twitter:description",
            "twitter:image",
            "twitter:image:alt",
        ):
            self.assertIn(f'="{key}"', enriched)
        self.assertEqual(
            static_metadata.enrich_word_html(
                enriched, word="lune", canonical=canonical
            ),
            enriched,
        )

    def test_story_metadata_describes_the_learning_resource(self) -> None:
        source = BASE_HTML.format(
            title="Bakeriet: A1 Norwegian Story",
            description="Read &quot;Bakeriet&quot;, today's free A1 Norwegian story.",
            image="https://example.test/bakeriet.jpg",
        )
        canonical = "https://osloandrew.github.io/norwegian/story/bakeriet/"
        enriched = static_metadata.enrich_story_html(
            source,
            norwegian_title="Bakeriet",
            english_title="The Bakery",
            cefr_level="A1",
            genre="dialogue",
            canonical=canonical,
        )
        payload = structured_payload(enriched)
        resource = node(payload, "LearningResource")
        self.assertEqual(resource["name"], "Bakeriet")
        self.assertEqual(
            resource["description"],
            'Read "Bakeriet", today\'s free A1 Norwegian story.',
        )
        self.assertEqual(resource["alternateName"], "The Bakery")
        self.assertEqual(resource["educationalLevel"], "A1")
        self.assertEqual(resource["genre"], "dialogue")
        self.assertEqual(resource["image"], "https://example.test/bakeriet.jpg")
        self.assertEqual(len(node(payload, "BreadcrumbList")["itemListElement"]), 3)

    def test_script_terminators_in_content_are_escaped(self) -> None:
        source = BASE_HTML.format(
            title="Safe title",
            description="Safe description",
            image="https://example.test/image.png",
        )
        enriched = static_metadata.enrich_word_html(
            source,
            word="</script><script>alert(1)</script>",
            canonical="https://example.test/word/safe/",
        )
        script = re.search(
            r'id="page-structured-data">(.*?)</script>', enriched
        ).group(1)
        self.assertNotIn("</script>", script)
        self.assertIn("<\\/script>", script)


if __name__ == "__main__":
    unittest.main()
