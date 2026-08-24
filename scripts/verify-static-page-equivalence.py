#!/usr/bin/env python3
"""Compare captured HTML visually with the same app rendered by JavaScript.

JavaScript is disabled for the captured side, proving the checked static
markup itself renders the requested content. The comparison side loads the
normal app shell and lets its production rendering functions create the same
view. Representative pages must be pixel-identical within their content area.
The captured URL is then loaded with JavaScript enabled as a behavior smoke
test, proving it upgrades into the normal interactive application.
"""

from __future__ import annotations

import argparse
import http.server
import io
import re
import socket
import tempfile
import threading
import urllib.parse
from pathlib import Path

from PIL import Image, ImageChops
from playwright.sync_api import Browser, Page, sync_playwright


ROOT = Path(__file__).resolve().parent.parent
SITE_PATH = "/norwegian/"
VIEWPORT = {"width": 1280, "height": 900}
SCREENSHOT_STYLE = (
    "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}"
    "#story-image-slot,.story-quiz-section,#waveform,#user-waveform{display:none!important}"
)
STATIC_STORY_SHUFFLE_SEED = 20260824


def use_static_story_index_seed(page: Page) -> None:
    page.add_init_script(
        f"""() => {{
            localStorage.setItem(
                'norwegian-dictionary-story-shuffle-seed-v1',
                '{STATIC_STORY_SHUFFLE_SEED}'
            );
            sessionStorage.removeItem(
                'norwegian-dictionary-session-recommendation-v1'
            );
            Math.random = () => 0;
        }}"""
    )


def slugify(value: str) -> str:
    value = value.strip().lower().replace("’", "'")
    value = re.sub(r"[\s/]+", "-", value)
    value = "".join(character for character in value if character.isalnum() or character == "-")
    return re.sub(r"-{2,}", "-", value).strip("-")


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        return


class QuietServer(http.server.ThreadingHTTPServer):
    def handle_error(self, request: object, client_address: object) -> None:
        # Browser navigation can cancel an in-flight multi-megabyte CSV
        # response after the next page is already ready. That expected
        # disconnect is not a test failure and should not dump a traceback.
        return


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as current_socket:
        current_socket.bind(("127.0.0.1", 0))
        return current_socket.getsockname()[1]


def compare_png(left: bytes, right: bytes, label: str) -> None:
    left_image = Image.open(io.BytesIO(left)).convert("RGBA")
    right_image = Image.open(io.BytesIO(right)).convert("RGBA")
    if left_image.size != right_image.size:
        raise AssertionError(f"{label}: rendered size differs: {left_image.size} != {right_image.size}")
    difference = ImageChops.difference(left_image, right_image)
    if difference.getbbox() is not None:
        changed_pixels = sum(1 for pixel in difference.getdata() if pixel != (0, 0, 0, 0))
        raise AssertionError(f"{label}: {changed_pixels} rendered pixels differ")


def word_visual_check(browser: Browser, base_url: str, word: str) -> None:
    slug = slugify(word)
    dynamic = browser.new_page(viewport=VIEWPORT)
    static_context = browser.new_context(java_script_enabled=False, viewport=VIEWPORT)
    static = static_context.new_page()
    try:
        dynamic.goto(f"{base_url}?type=words&word={urllib.parse.quote(word)}", wait_until="load")
        dynamic.wait_for_selector("#results-container .definition", state="visible", timeout=30_000)
        dynamic.wait_for_function(
            "slug => decodeURIComponent(new URL(document.querySelector('link[rel=canonical]')?.href).pathname).endsWith(`/word/${slug}/`)",
            arg=slug,
        )
        dynamic.wait_for_timeout(120)

        static.goto(f"{base_url}word/{urllib.parse.quote(slug)}/", wait_until="load")
        static.wait_for_selector("#results-container .definition", state="visible")
        compare_png(
            static.locator("#results-container").screenshot(animations="disabled", style=SCREENSHOT_STYLE),
            dynamic.locator("#results-container").screenshot(animations="disabled", style=SCREENSHOT_STYLE),
            f"word {word!r}",
        )
    finally:
        dynamic.close()
        static_context.close()


def story_visual_check(browser: Browser, base_url: str, title: str) -> None:
    slug = slugify(title)
    dynamic = browser.new_page(viewport=VIEWPORT)
    static_context = browser.new_context(java_script_enabled=False, viewport=VIEWPORT)
    static = static_context.new_page()
    try:
        dynamic.goto(f"{base_url}?type=stories&story={urllib.parse.quote(title)}", wait_until="load")
        dynamic.wait_for_selector("#story-content .japanese-sentence", state="visible", timeout=30_000)
        dynamic.wait_for_function(
            "slug => decodeURIComponent(new URL(document.querySelector('link[rel=canonical]')?.href).pathname).endsWith(`/story/${slug}/`)",
            arg=slug,
        )
        dynamic.wait_for_timeout(170)

        static.goto(f"{base_url}story/{urllib.parse.quote(slug)}/", wait_until="load")
        static.wait_for_selector("#story-content .japanese-sentence", state="visible")
        compare_png(
            static.locator("#story-content").screenshot(animations="disabled", style=SCREENSHOT_STYLE),
            dynamic.locator("#story-content").screenshot(animations="disabled", style=SCREENSHOT_STYLE),
            f"story {title!r}",
        )
    finally:
        dynamic.close()
        static_context.close()


def stories_index_visual_check(browser: Browser, base_url: str) -> None:
    dynamic = browser.new_page(viewport=VIEWPORT)
    use_static_story_index_seed(dynamic)
    static_context = browser.new_context(java_script_enabled=False, viewport=VIEWPORT)
    static = static_context.new_page()
    try:
        dynamic.goto(f"{base_url}?type=stories", wait_until="load")
        dynamic.wait_for_selector("#stories .story-card-link", state="visible", timeout=30_000)
        dynamic.wait_for_timeout(200)

        static.goto(f"{base_url}stories/", wait_until="load")
        static.wait_for_selector("#stories .story-card-link", state="visible")
        static_png = static.locator("#results-container").screenshot(
            animations="disabled", style=SCREENSHOT_STYLE
        )
        dynamic_png = dynamic.locator("#results-container").screenshot(
            animations="disabled", style=SCREENSHOT_STYLE
        )
        try:
            compare_png(static_png, dynamic_png, "stories index")
        except AssertionError:
            describe = """() => ({
                children: [...document.querySelector('#results-container').children].map(
                    element => ({
                        className: element.className,
                        height: element.getBoundingClientRect().height,
                        display: getComputedStyle(element).display
                    })
                ),
                visibleCards: [...document.querySelectorAll('#stories > li')].filter(
                    element => getComputedStyle(element).display !== 'none'
                ).length,
                firstTitles: [...document.querySelectorAll('#stories > li')].filter(
                    element => getComputedStyle(element).display !== 'none'
                ).slice(0, 10).map(element => element.querySelector('.story-card-link')?.dataset.storyTitle)
            })"""
            print(f"Static stories layout: {static.evaluate(describe)}")
            print(f"Dynamic stories layout: {dynamic.evaluate(describe)}")
            raise
    finally:
        dynamic.close()
        static_context.close()


def feature_visual_check(browser: Browser, base_url: str, feature: str, ready_selector: str) -> None:
    dynamic = browser.new_page(viewport=VIEWPORT)
    dynamic.add_init_script("Math.random = () => 0")
    static_context = browser.new_context(java_script_enabled=False, viewport=VIEWPORT)
    static = static_context.new_page()
    try:
        dynamic.goto(f"{base_url}?type={feature}", wait_until="load")
        dynamic.wait_for_selector(ready_selector, state="visible", timeout=60_000)
        dynamic.wait_for_timeout(250)

        static.goto(f"{base_url}{feature}/", wait_until="load")
        static.wait_for_selector(ready_selector, state="visible")
        compare_png(
            static.locator("#main-content").screenshot(animations="disabled", style=SCREENSHOT_STYLE),
            dynamic.locator("#main-content").screenshot(animations="disabled", style=SCREENSHOT_STYLE),
            feature,
        )
        canonical = static.locator('link[rel="canonical"]').get_attribute("href")
        if canonical != f"https://osloandrew.github.io/norwegian/{feature}/":
            raise AssertionError(f"{feature}: wrong static canonical {canonical!r}")
    finally:
        dynamic.close()
        static_context.close()


def heading_semantics_pixel_check(browser: Browser, base_url: str, word: str, story: str) -> None:
    page = browser.new_page(viewport=VIEWPORT)
    replace_tag = """selectorAndTag => {
        const [selector, tagName] = selectorAndTag;
        const current = document.querySelector(selector);
        if (!current) throw new Error(`Missing heading: ${selector}`);
        const replacement = document.createElement(tagName);
        for (const attribute of current.attributes) {
            replacement.setAttribute(attribute.name, attribute.value);
        }
        replacement.innerHTML = current.innerHTML;
        current.replaceWith(replacement);
    }"""
    try:
        page.goto(f"{base_url}?type=words&word={urllib.parse.quote(word)}", wait_until="load")
        page.wait_for_selector("#results-container h1.word-gender", state="visible", timeout=30_000)
        header_new = page.locator("header").screenshot(animations="disabled", style=SCREENSHOT_STYLE)
        word_new = page.locator("#results-container").screenshot(animations="disabled", style=SCREENSHOT_STYLE)
        page.evaluate(replace_tag, ["#site-title", "h1"])
        page.evaluate(replace_tag, ["#results-container h1.word-gender", "h2"])
        compare_png(header_new, page.locator("header").screenshot(animations="disabled", style=SCREENSHOT_STYLE), "site title semantic tag")
        compare_png(word_new, page.locator("#results-container").screenshot(animations="disabled", style=SCREENSHOT_STYLE), "word heading semantic tag")

        page.goto(f"{base_url}?type=stories&story={urllib.parse.quote(story)}", wait_until="load")
        page.wait_for_selector("#story-content h1.sticky-title-japanese", state="visible", timeout=30_000)
        story_new = page.locator("#story-content").screenshot(animations="disabled", style=SCREENSHOT_STYLE)
        page.evaluate(replace_tag, ["#story-content h1.sticky-title-japanese", "h2"])
        compare_png(story_new, page.locator("#story-content").screenshot(animations="disabled", style=SCREENSHOT_STYLE), "story heading semantic tag")
    finally:
        page.close()


def behavior_smoke_check(browser: Browser, base_url: str, word: str, story: str) -> None:
    page = browser.new_page(viewport=VIEWPORT)
    try:
        page.goto(f"{base_url}word/{urllib.parse.quote(slugify(word))}/", wait_until="load")
        page.wait_for_selector("#results-container .definition", state="visible", timeout=30_000)
        page.wait_for_function("() => document.querySelector('#type-select')?.value === 'words'")
        if page.locator(".definition").count() < 1:
            raise AssertionError("Captured word page did not upgrade to the interactive dictionary")

        page.goto(f"{base_url}story/{urllib.parse.quote(slugify(story))}/", wait_until="load")
        page.wait_for_selector("#story-content .japanese-sentence", state="visible", timeout=30_000)
        toggle = page.locator("#toggle-english-btn")
        english_sentence = page.locator("#story-content .english-sentence").first
        was_visible = english_sentence.is_visible()
        toggle.click()
        page.wait_for_timeout(80)
        if english_sentence.is_visible() == was_visible:
            raise AssertionError("Captured story page's English toggle is not interactive")

        page.goto(f"{base_url}stories/", wait_until="load")
        page.wait_for_selector("#stories .story-card-link", state="visible", timeout=30_000)
        hidden_before = page.locator(".story-index-hidden").count()
        show_more = page.locator(".stories-load-more-button")
        if hidden_before < 1 or show_more.count() != 1:
            raise AssertionError("Captured stories index is missing its progressive list")
        show_more.click()
        if page.locator(".story-index-hidden").count() >= hidden_before:
            raise AssertionError("Captured stories index's Show More button is not interactive")

        feature_selectors = {
            "sentences": "#results-container .sentence-container",
            "word-game": "#results-container .game-intro-card",
            "pronunciation": "#results-container .sentence-box-practice",
        }
        for feature, selector in feature_selectors.items():
            page.goto(f"{base_url}{feature}/", wait_until="load")
            page.wait_for_selector(selector, state="visible", timeout=60_000)
            if feature == "pronunciation":
                # Pronunciation deliberately is not a visible dropdown option;
                # requiring the select value to equal it would change today's UI.
                page.wait_for_function(
                    "typeof results !== 'undefined' && results.length > 0",
                    timeout=60_000,
                )
            else:
                page.wait_for_function(
                    "feature => document.querySelector('#type-select')?.value === feature",
                    arg=feature,
                    timeout=60_000,
                )
            canonical_path = urllib.parse.urlparse(
                page.locator('link[rel="canonical"]').get_attribute("href") or ""
            ).path
            if not canonical_path.endswith(f"/{feature}/"):
                raise AssertionError(f"Captured {feature} page lost its canonical URL")

        page.goto(base_url, wait_until="load")
        page.wait_for_function(
            "() => typeof results !== 'undefined' && results.length > 0 && pageManifest.words.has('vuggesang')",
            timeout=60_000,
        )
        page.evaluate(
            "() => updateURL('', 'words', 'noun', '', null, 'vuggesang, voggesang')"
        )
        expected_word_path = urllib.parse.urlparse(base_url).path + "word/vuggesang/"
        if urllib.parse.urlparse(page.url).path != expected_word_path:
            raise AssertionError("An alternative-spelling random word did not use its primary pretty path")

        feature_path = urllib.parse.urlparse(base_url).path + "sentences/"
        page.goto(f"{base_url}sentences/", wait_until="load")
        page.wait_for_function(
            "() => document.querySelector('#type-select')?.value === 'sentences'",
            timeout=60_000,
        )
        page.locator("#search-bar").fill("eple")
        page.locator("#search-btn").click()
        page.wait_for_function(
            "expectedPath => location.pathname === expectedPath && new URLSearchParams(location.search).get('query') === 'eple' && !new URLSearchParams(location.search).has('type')",
            arg=feature_path,
        )
        page.wait_for_selector('.sentence-results-query', state="visible")

        page.locator("#search-bar").fill("")
        page.locator("#search-btn").click()
        page.wait_for_function(
            "expectedPath => location.pathname === expectedPath && location.search === ''",
            arg=feature_path,
        )
        page.wait_for_selector(".random-sentence-header", state="visible")

        page.goto(base_url, wait_until="load")
        page.wait_for_function(
            "() => typeof results !== 'undefined' && results.length > 0",
            timeout=60_000,
        )
        page.locator("#search-bar").fill("eple")
        page.locator("#search-btn").click()
        page.wait_for_function(
            "expectedPath => location.pathname === expectedPath && new URLSearchParams(location.search).get('query') === 'eple' && !new URLSearchParams(location.search).has('type')",
            arg=urllib.parse.urlparse(base_url).path,
        )

        page.goto(f"{base_url}sentences/", wait_until="load")
        page.wait_for_function(
            "() => document.querySelector('#type-select')?.value === 'sentences'",
            timeout=60_000,
        )
        page.locator("#type-select").select_option("words")
        page.wait_for_function(
            "expectedPath => location.pathname === expectedPath && location.search === ''",
            arg=urllib.parse.urlparse(base_url).path,
        )
    finally:
        page.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=ROOT)
    parser.add_argument("--site-root", type=Path, default=ROOT)
    parser.add_argument("--word", action="append", default=[])
    parser.add_argument("--story", action="append", default=[])
    parser.add_argument(
        "--root-mount",
        action="store_true",
        help="Serve the site at /, matching VS Code's repository-root preview.",
    )
    args = parser.parse_args()
    words = args.word or ["forgjeves"]
    stories = args.story or ["Bakeriet"]

    temporary = tempfile.TemporaryDirectory(prefix="norwegian-equivalence-")
    temporary_root = Path(temporary.name)
    source_root = args.source_root.resolve()
    site_root = args.site_root.resolve()
    serve_root = temporary_root / "serve"
    serve_root.mkdir()
    overlay_root = serve_root if args.root_mount else serve_root / "norwegian"
    if not args.root_mount:
        overlay_root.mkdir()
    generated_names = {
        "word", "story", "stories", "sentences", "word-game", "pronunciation",
        "sitemap.xml", "page-manifest.json"
    }
    for source_item in source_root.iterdir():
        if source_item.name in generated_names:
            continue
        (overlay_root / source_item.name).symlink_to(source_item)
    for name in generated_names:
        preferred = site_root / name
        fallback = source_root / name
        target = preferred if preferred.exists() else fallback
        if target.exists():
            (overlay_root / name).symlink_to(target)
    port = find_free_port()
    handler = lambda *handler_args, **handler_kwargs: QuietHandler(
        *handler_args, directory=str(serve_root), **handler_kwargs
    )
    server = QuietServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    mount_path = "/" if args.root_mount else SITE_PATH
    base_url = f"http://127.0.0.1:{port}{mount_path}"

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            for word in words:
                word_visual_check(browser, base_url, word)
            for story in stories:
                story_visual_check(browser, base_url, story)
            stories_index_visual_check(browser, base_url)
            feature_visual_check(browser, base_url, "sentences", "#results-container .sentence-container")
            feature_visual_check(browser, base_url, "word-game", "#results-container .game-intro-card")
            feature_visual_check(browser, base_url, "pronunciation", "#results-container .sentence-box-practice")
            heading_semantics_pixel_check(browser, base_url, words[0], stories[0])
            behavior_smoke_check(browser, base_url, words[0], stories[0])
            browser.close()
    finally:
        server.shutdown()
        temporary.cleanup()
    print(
        f"Verified exact rendering for {len(words)} word page(s), "
        f"{len(stories)} story page(s), the stories index, and three feature pages, plus "
        "interactive upgrade behavior."
    )


if __name__ == "__main__":
    main()
