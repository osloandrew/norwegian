#!/usr/bin/env python3
"""Capture the real default UI for each crawlable feature route."""

from __future__ import annotations

import argparse
import http.server
import socket
import sys
import tempfile
import threading
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PRODUCTION_ORIGIN = "https://osloandrew.github.io"
SITE_PATH = "/norwegian/"
PAGE_BASE_HREF = "../"

FEATURES = {
    "sentences": "#results-container .sentence-container",
    "word-game": "#results-container .game-intro-card",
    "pronunciation": "#results-container .sentence-box-practice",
}


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        return


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as current_socket:
        current_socket.bind(("127.0.0.1", 0))
        return current_socket.getsockname()[1]


def capture(output_root: Path) -> None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print(
            "Playwright isn't installed. Install requirements-pages.txt and Chromium first.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    temporary = tempfile.TemporaryDirectory(prefix="norwegian-feature-capture-")
    temporary_root = Path(temporary.name)
    (temporary_root / "norwegian").symlink_to(ROOT)
    port = find_free_port()
    handler = lambda *args, **kwargs: QuietHandler(
        *args, directory=str(temporary_root), **kwargs
    )
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{port}"
    base_url = f"{origin}{SITE_PATH}"

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            for feature, ready_selector in FEATURES.items():
                context = browser.new_context()
                page = context.new_page()
                page.add_init_script("Math.random = () => 0")
                page.goto(f"{base_url}?type={feature}", wait_until="load")
                page.wait_for_selector(ready_selector, state="visible", timeout=60_000)
                page.wait_for_function(
                    "feature => new URL(document.querySelector('link[rel=canonical]').href).pathname.endsWith(`/${feature}/`)",
                    arg=feature,
                )
                page.wait_for_timeout(250)

                html_out = page.evaluate("document.documentElement.outerHTML")
                html_out = html_out.replace(
                    "<head>", f'<head>\n    <base href="{PAGE_BASE_HREF}">', 1
                )
                html_out = html_out.replace(origin, PRODUCTION_ORIGIN)

                output = output_root / feature / "index.html"
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_text("<!doctype html>\n" + html_out, encoding="utf-8")
                print(f"Wrote {output}")
                context.close()
            browser.close()
    finally:
        server.shutdown()
        temporary.cleanup()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-root", type=Path, default=ROOT)
    args = parser.parse_args()
    capture(args.output_root.resolve())


if __name__ == "__main__":
    main()
