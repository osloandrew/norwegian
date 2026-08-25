#!/usr/bin/env python3
"""Run axe-core against representative pages of the live, JS-rendered app.

This checks the same interactive app real visitors use — not the captured
static pages under word/, story/, etc. (those exist purely for crawlers and
already get their own equivalence checks in verify-static-page-equivalence.py).
Nothing here duplicates that; this is a different question ("is the rendered
UI accessible?") asked against a different target (the live app shell).

Usage:
    npm install                        # once, installs axe-core (devDependency)
    python3 scripts/check-accessibility.py

Exits non-zero if axe-core reports any "serious" or "critical" violation on
any checked page. "moderate"/"minor" findings are printed but do not fail the
run — the goal is to block real access blockers in CI without the noise of
lower-severity findings turning every PR red before anyone has triaged them.
Tighten FAILING_IMPACTS once the moderate/minor backlog has been worked
through.
"""

from __future__ import annotations

import argparse
import http.server
import json
import socket
import sys
import threading
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
AXE_SCRIPT_PATH = ROOT / "node_modules" / "axe-core" / "axe.min.js"
VIEWPORT = {"width": 1280, "height": 900}

# Only WCAG success criteria plus axe's own best-practice rules — the same
# tag set most teams gate CI on. Excludes axe's "experimental" rules, which
# are prone to false positives.
AXE_RUN_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]
FAILING_IMPACTS = {"critical", "serious"}

# Pre-existing serious/critical violations, accepted for now so this check
# can gate CI without blocking on a full redesign. Each needs real design
# work, not a quick patch:
#   - color-contrast traces back to shared tokens (--color-text-faint,
#     --color-text-slate, --color-link in styles/00-foundations-and-game.css)
#     used across dozens of places — fixing the token shifts contrast
#     everywhere it's used, not just the pages listed here.
#   - nested-interactive is the whole-card-clickable pattern (a
#     role="button" div containing a real <button>, e.g. the English-toggle
#     button inside a search result card) used on every result card in the
#     app — safely restructuring it needs its own pass.
# Still printed below as "[known]", not silently dropped. Remove an entry
# once its underlying issue is actually fixed — a passing run with a stale
# entry here just means the entry is unused, not that anything is masked.
KNOWN_VIOLATIONS: set[tuple[str, str]] = {
    ("Landing page", "color-contrast"),
    ("Word lookup", "color-contrast"),
    ("Word lookup", "nested-interactive"),
    ("Stories index", "color-contrast"),
}

# (label, path, ready_selector, extra readiness wait)
ROUTES: list[tuple[str, str, str, float]] = [
    ("Landing page", "/", "#landing-card", 0),
    ("Word lookup", "/?type=words&word=forgjeves", "#results-container .definition", 0),
    ("Sentence search", "/?type=sentences", "#results-container .sentence-container", 0),
    ("Stories index", "/?type=stories", "#stories .story-card-link", 0),
    ("Story reader", "/?type=stories&story=Bakeriet", "#story-content .japanese-sentence", 0),
    ("Word Game intro", "/?type=word-game", "#results-container .game-intro-card", 0),
    ("Pronunciation", "/?type=pronunciation", "#results-container .sentence-box-practice", 0),
    ("My Stats", "/?type=my-stats", ".my-stats-heading", 0),
]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        return


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as current_socket:
        current_socket.bind(("127.0.0.1", 0))
        return current_socket.getsockname()[1]


def run_axe(page: Page) -> list[dict]:
    page.evaluate(AXE_SCRIPT_PATH.read_text())
    results = page.evaluate(
        "tags => axe.run(document, { runOnly: { type: 'tag', values: tags } })"
        ".then(results => results)",
        AXE_RUN_TAGS,
    )
    return results["violations"]


def check_route(page: Page, base_url: str, label: str, path: str, ready_selector: str, extra_wait_ms: float) -> list[dict]:
    page.goto(f"{base_url}{path.lstrip('/')}", wait_until="load")
    page.wait_for_selector(ready_selector, state="visible", timeout=30_000)
    page.wait_for_function("() => window.__APP_READY__ === true", timeout=30_000)
    if path.startswith("/?type=word-game"):
        # Same quirk verify-static-page-equivalence.py works around: the
        # game intro card renders first as a neutral loading shell, then
        # gets replaced once saved placement state has been read.
        page.wait_for_selector(
            "#results-container .word-game-loading-card", state="detached", timeout=30_000
        )
    if extra_wait_ms:
        page.wait_for_timeout(extra_wait_ms)

    violations = run_axe(page)

    if not violations:
        print(f"  {label}: no violations")
        return []

    failing = []
    for violation in violations:
        is_known = (label, violation["id"]) in KNOWN_VIOLATIONS
        is_failing = violation["impact"] in FAILING_IMPACTS and not is_known
        marker = "known" if is_known else ("FAIL" if is_failing else "info")
        print(
            f"  [{marker}] {label}: {violation['id']} ({violation['impact']}) — "
            f"{violation['help']} [{len(violation['nodes'])} element(s)]"
        )
        for node in violation["nodes"][:3]:
            print(f"           {node['target']}")
        if is_failing:
            failing.append(violation)
    return failing


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=ROOT)
    args = parser.parse_args()

    if not AXE_SCRIPT_PATH.exists():
        sys.exit(
            f"axe-core not found at {AXE_SCRIPT_PATH}.\n"
            "Run `npm install` first (axe-core is a devDependency)."
        )

    source_root = args.source_root.resolve()
    port = find_free_port()
    handler = lambda *handler_args, **handler_kwargs: QuietHandler(
        *handler_args, directory=str(source_root), **handler_kwargs
    )
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base_url = f"http://127.0.0.1:{port}/"

    all_failing: dict[str, list[dict]] = {}
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            page = browser.new_page(viewport=VIEWPORT)
            for label, path, ready_selector, extra_wait_ms in ROUTES:
                print(f"Checking {label} ({path})...")
                failing = check_route(page, base_url, label, path, ready_selector, extra_wait_ms)
                if failing:
                    all_failing[label] = failing
            browser.close()
    finally:
        server.shutdown()

    print()
    if all_failing:
        total = sum(len(v) for v in all_failing.values())
        print(f"FAILED: {total} serious/critical accessibility violation(s) across {len(all_failing)} page(s).")
        sys.exit(1)

    print(f"Passed: no serious/critical accessibility violations across {len(ROUTES)} page(s).")


if __name__ == "__main__":
    main()
