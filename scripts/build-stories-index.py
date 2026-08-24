#!/usr/bin/env python3
"""Generate stories/index.html by capturing the real app's story list.

Same principle as capture-word-pages.py: don't hand-build a parallel
design, capture what the real app actually renders. displayStoryList()
takes a visibleCount override, so this renders every story with the exact
real card markup/styling — then, in-page (DOM manipulation, not string
splitting the HTML), wraps everything past the app's own default page size
in a genuinely-togglable hidden section. Visitors see the same default
count as ?type=stories always showed; the full list is real, crawlable
markup in the response either way, not something conjured only for bots.
"""

from __future__ import annotations

import http.server
import socket
import tempfile
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRODUCTION_ORIGIN = "https://osloandrew.github.io"
SITE_PATH = "/norwegian/"
# From stories/, this reaches the site root under both GitHub Pages and a
# repository-root local preview.
PAGE_BASE_HREF = "../"
# A crawlable snapshot must be reproducible. The live app still assigns each
# visitor its normal personal shuffle seed whenever it renders the list.
STATIC_STORY_SHUFFLE_SEED = 20260824


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        return


def build(output_root: Path = ROOT) -> None:
    from playwright.sync_api import sync_playwright

    tmp_dir_ctx = tempfile.TemporaryDirectory(prefix="norwegian-capture-")
    tmp_dir = Path(tmp_dir_ctx.name)
    (tmp_dir / "norwegian").symlink_to(ROOT)

    port = find_free_port()
    handler = lambda *a, **kw: QuietHandler(
        *a, directory=str(tmp_dir), **kw
    )
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{port}"
    base_url = f"{origin}{SITE_PATH}"

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
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

            # Enter through the real Stories route so its normal route setup,
            # ordering, recommendation, metadata, and search UI all run before
            # capture. Calling displayStoryList() from the dictionary route
            # skipped part of that behavior and could capture a different card
            # order even though the card component itself was identical.
            page.goto(f"{base_url}?type=stories", wait_until="load")
            page.wait_for_selector(
                "#stories .story-card-link", state="visible", timeout=30000
            )
            page.evaluate(
                "() => displayStoryList(storyResults, "
                "{visibleCount: storyResults.length})"
            )
            page.wait_for_timeout(300)

            total = page.evaluate(
                """() => {
                    const list = document.getElementById('stories');
                    const items = [...list.children];
                    // NOT adjusted for whether a recommendation card is
                    // present: displayStoryList() appends
                    // .story-recommendation as #stories' *sibling*, before
                    // it, never as a grid item inside it (see
                    // displayStoryList in stories.js) — so it never
                    // occupies one of #stories' own grid slots, and
                    // subtracting a slot for it here would make the
                    // regular-card grid odd instead of even, putting the
                    // dangling single card back on the bottom row it was
                    // supposed to fix.
                    const cutoff = STORY_LIST_INITIAL_SIZE;
                    const extra = items.slice(cutoff);
                    if (extra.length) {
                        // All 360 are already real markup in the response
                        // (crawlers need nothing more than that); revealing
                        // them is a plain CSS toggle instead of calling
                        // displayStoryList() again — no re-fetch needed
                        // since nothing here was ever actually removed.
                        //
                        // Left as direct children of #stories, exactly
                        // where the real app puts every card — not moved
                        // into a wrapper div. display:none on each <li>
                        // individually, not a wrapping div set to
                        // display:contents: that first approach changed
                        // each li's DOM parent, and CSS selector matching
                        // (:nth-child, any `>` direct-child rule, grid
                        // item assignment) is based on the actual DOM
                        // tree, not the box-generation tree display:
                        // contents produces — so those items rendered
                        // without the same styling as the rest. Hiding
                        // in place has no such gap: nothing about their
                        // position in the tree ever changes.
                        extra.forEach((li) => {
                            li.style.display = 'none';
                            li.classList.add('story-index-hidden');
                        });

                        // Same wrapper/button classes and label
                        // displayStoryList()'s own "Show More Stories"
                        // uses (see stories.js) — a captured page should
                        // look and act like the real app, not a
                        // hand-styled stand-in for it. The handler is set
                        // as a real onclick= HTML attribute (a string),
                        // not a JS property (element.onclick = fn) — a
                        // property assignment runs live but is invisible
                        // to outerHTML serialization, so the captured
                        // static file would ship a button with no actual
                        // handler at all. Confirmed by testing: the first
                        // version of this did exactly that.
                        //
                        // Reveals STORY_LIST_BATCH_SIZE (stories.js) at a
                        // time, same as the real app's own "Show More" —
                        // not everything still hidden in one click, which
                        // dumped all 285 remaining cards on screen at once.
                        const loadMore = document.createElement('div');
                        loadMore.className = 'stories-load-more';
                        const toggle = document.createElement('button');
                        toggle.type = 'button';
                        toggle.className = 'stories-load-more-button';
                        toggle.textContent = 'Show More Stories';
                        toggle.setAttribute(
                            'onclick',
                            "var hidden = Array.prototype.slice.call(" +
                            "document.querySelectorAll('.story-index-hidden'), 0, 24);" +
                            "hidden.forEach(function(li){" +
                            "li.style.display='';li.classList.remove('story-index-hidden');});" +
                            "if(!document.querySelector('.story-index-hidden')){" +
                            "this.parentElement.remove();}"
                        );
                        loadMore.appendChild(toggle);
                        list.after(loadMore);
                    }
                    // Real hrefs (?type=story&story=Title) still work but
                    // aren't the canonical form for a card that has one —
                    // point each card at its pretty page instead, matching
                    // updateURL()'s own preference (see scripts.js).
                    //
                    // Queries the whole document, not just #stories' own
                    // <li> children: the recommendation card
                    // (.story-recommendation-link) is a sibling appended
                    // *before* #stories, not one of its items, so a loop
                    // scoped to items alone silently skipped it, leaving it
                    // on the query-string form. That card also never gets
                    // displayStoryList()'s delegated click handler
                    // re-attached (this static page doesn't call
                    // displayStoryList() again on load — see the
                    // isPrettyStoriesListPath branch in stories.js), so a
                    // stale query-string href there falls through to a real
                    // browser navigation instead of a client-side route,
                    // landing on the plain index.html (no <base> tag) and
                    // dragging document.baseURI along with it once the app's
                    // own pushState "upgrades" the URL afterward — breaking
                    // every base-relative fetch (norwegianWords.csv,
                    // inflections-data.json, the sw.js registration) for the
                    // rest of that page's life.
                    document.querySelectorAll('a.story-card-link').forEach((a) => {
                        const title = a.dataset.storyTitle;
                        const slug = title ? slugifyWordForURL(title) : null;
                        if (slug && pageManifest.stories.has(slug)) {
                            a.href = `story/${slug}/`;
                        }
                    });
                    return items.length;
                }"""
            )
            print(f"Rendered {total} story cards; split at STORY_LIST_INITIAL_SIZE.")

            html_out = page.evaluate("document.documentElement.outerHTML")
            html_out = html_out.replace(
                "<head>", f'<head>\n    <base href="{PAGE_BASE_HREF}">', 1
            )
            html_out = html_out.replace(origin, PRODUCTION_ORIGIN)

            output = output_root / "stories" / "index.html"
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text("<!doctype html>\n" + html_out, encoding="utf-8")
            print(f"Wrote {output}")

            browser.close()
    finally:
        server.shutdown()
        tmp_dir_ctx.cleanup()


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-root",
        type=Path,
        default=ROOT,
        help="Site root beneath which stories/index.html is written.",
    )
    args = parser.parse_args()
    build(args.output_root.resolve())


if __name__ == "__main__":
    main()
