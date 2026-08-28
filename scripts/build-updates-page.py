#!/usr/bin/env python3
"""Build the public Updates page from opt-in commits and curated entries.

A commit is public only when its subject starts with ``[update]``. The rest
of the subject becomes the public title; the first paragraph of the commit
body becomes an optional summary. ``updates.json`` supplies fallback content
that is shown only until the first real public update exists in Git history.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parent.parent
SITE = "https://osloandrew.github.io/norwegian"
UPDATE_PREFIX = "[update]"
TRAILER_PREFIXES = ("co-authored-by:", "signed-off-by:", "reviewed-by:")
OSLO_TIMEZONE = ZoneInfo("Europe/Oslo")


class UpdateBuildError(RuntimeError):
    pass


@dataclass(frozen=True)
class Update:
    published_at: datetime
    title: str
    summary: str = ""


def parse_datetime(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise UpdateBuildError(f"Invalid update timestamp: {value!r}") from error
    if parsed.tzinfo is None:
        raise UpdateBuildError(f"Update timestamp must include a timezone: {value!r}")
    return parsed


def first_public_paragraph(body: str) -> str:
    paragraphs: list[list[str]] = []
    current: list[str] = []
    for raw_line in body.splitlines():
        line = raw_line.strip()
        if not line:
            if current:
                paragraphs.append(current)
                current = []
            continue
        if line.casefold().startswith(TRAILER_PREFIXES):
            continue
        current.append(line)
    if current:
        paragraphs.append(current)
    return " ".join(paragraphs[0]) if paragraphs else ""


def commit_updates(repo_root: Path) -> list[Update]:
    command = [
        "git",
        "log",
        "--date=iso-strict",
        "--pretty=format:%cI%x1f%s%x1f%b%x1e",
    ]
    try:
        result = subprocess.run(
            command,
            cwd=repo_root,
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        raise UpdateBuildError("Unable to read Git history for public updates") from error

    updates: list[Update] = []
    for record in result.stdout.split("\x1e"):
        # Git separates records with a newline after our explicit control
        # character. Strip only line endings: str.strip() would also remove
        # the unit separator that represents an intentionally empty body.
        record = record.strip("\r\n")
        if not record:
            continue
        fields = record.split("\x1f", 2)
        if len(fields) != 3:
            raise UpdateBuildError("Unexpected record while reading Git history")
        timestamp, subject, body = fields
        if not subject.casefold().startswith(UPDATE_PREFIX):
            continue
        title = subject[len(UPDATE_PREFIX) :].strip(" :-–—")
        if not title:
            raise UpdateBuildError("An [update] commit is missing its public title")
        updates.append(
            Update(
                published_at=parse_datetime(timestamp),
                title=title,
                summary=first_public_paragraph(body),
            )
        )
    return updates


def curated_updates(path: Path) -> list[Update]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise UpdateBuildError(f"Unable to read {path.name}: {error}") from error
    if not isinstance(payload, list):
        raise UpdateBuildError(f"{path.name} must contain a list")

    updates: list[Update] = []
    for index, item in enumerate(payload):
        if not isinstance(item, dict):
            raise UpdateBuildError(f"{path.name} entry {index + 1} must be an object")
        title = item.get("title")
        timestamp = item.get("publishedAt")
        summary = item.get("summary", "")
        if not isinstance(title, str) or not title.strip():
            raise UpdateBuildError(f"{path.name} entry {index + 1} needs a title")
        if not isinstance(timestamp, str):
            raise UpdateBuildError(f"{path.name} entry {index + 1} needs publishedAt")
        if not isinstance(summary, str):
            raise UpdateBuildError(f"{path.name} entry {index + 1} has an invalid summary")
        updates.append(parse_update(timestamp, title, summary))
    return updates


def parse_update(timestamp: str, title: str, summary: str = "") -> Update:
    return Update(parse_datetime(timestamp), title.strip(), summary.strip())


def combined_updates(repo_root: Path, curated_path: Path) -> list[Update]:
    public_commits = commit_updates(repo_root)
    updates = public_commits if public_commits else curated_updates(curated_path)
    unique: dict[tuple[str, str], Update] = {}
    for update in updates:
        key = (update.published_at.date().isoformat(), update.title.casefold())
        unique.setdefault(key, update)
    return sorted(unique.values(), key=lambda item: item.published_at, reverse=True)


def asset_version(site_root: Path, relative_path: str) -> str:
    digest = hashlib.sha256((site_root / relative_path).read_bytes()).hexdigest()[:10]
    return f"{relative_path}?v={digest}"


def human_timestamp(value: datetime) -> tuple[str, str]:
    oslo_value = value.astimezone(OSLO_TIMEZONE)
    return (
        f"{oslo_value.day} {oslo_value.strftime('%B')} {oslo_value.year}",
        f"{oslo_value.strftime('%H:%M')} Oslo Time",
    )


def render_entries(updates: list[Update]) -> str:
    if not updates:
        return '<p class="updates-empty">No public updates have been posted yet.</p>'
    cards: list[str] = []
    for update in updates:
        date_label, time_label = human_timestamp(update.published_at)
        summary = (
            f"\n          <p>{html.escape(update.summary)}</p>" if update.summary else ""
        )
        cards.append(
            f'''<article class="update-entry">
        <time class="update-date" datetime="{update.published_at.isoformat()}">
          <span class="update-date-day">{date_label}</span>
          <span class="update-date-time">{time_label}</span>
        </time>
        <div class="update-content">
          <h2>{html.escape(update.title)}</h2>{summary}
        </div>
      </article>'''
        )
    return "\n      ".join(cards)


def render_page(updates: list[Update], site_root: Path) -> str:
    latest = updates[0].published_at.isoformat() if updates else "2026-08-25T00:00:00+02:00"
    foundation_css = asset_version(site_root, "styles/00-foundations-and-game.css")
    shell_css = asset_version(site_root, "styles/01-document-shell.css")
    footer_css = asset_version(site_root, "styles/10-shell-landing-and-stats.css")
    navigation_css = asset_version(site_root, "styles/35-navigation.css")
    updates_css = asset_version(site_root, "styles/50-updates.css")
    entries = render_entries(updates)
    structured_data = json.dumps(
        {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "name": "What's New — Norwegian Dictionary",
            "description": "Recent improvements to the Norwegian Dictionary and learning tools.",
            "url": f"{SITE}/updates/",
            "dateModified": latest,
        },
        ensure_ascii=False,
    ).replace("</", "<\\/")
    return f'''<!doctype html>
<html lang="en">
  <head>
    <base href="../">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>What's New | Norwegian Dictionary</title>
    <meta name="description" content="See the latest improvements to the Norwegian Dictionary, stories, vocabulary practice, and learning tools.">
    <meta property="og:title" content="What's New | Norwegian Dictionary">
    <meta property="og:description" content="Recent improvements to the Norwegian Dictionary and learning tools.">
    <meta property="og:type" content="website">
    <meta property="og:url" content="{SITE}/updates/">
    <meta property="og:image" content="{SITE}/Resources/Icons/android-chrome-512x512.png">
    <meta name="twitter:card" content="summary">
    <link rel="canonical" href="{SITE}/updates/">
    <link rel="icon" type="image/png" sizes="32x32" href="Resources/Icons/favicon-32x32.png">
    <link rel="stylesheet" href="{foundation_css}">
    <link rel="stylesheet" href="{shell_css}">
    <link rel="stylesheet" href="{footer_css}">
    <link rel="stylesheet" href="{navigation_css}">
    <link rel="stylesheet" href="{updates_css}">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,100..900&amp;family=Noto+Sans:wght@100..900&amp;family=Source+Sans+3:ital,wght@0,200..900;1,200..900&amp;family=Noto+Serif:wght@100..900&amp;family=Source+Serif+4:opsz,wght@8..60,200..900&amp;display=swap">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" integrity="sha384-PPIZEGYM1v8zp5Py7UjFb79S58UeqCL9pYVnVPURKEqvioPROaVAJKKLzvH2rDnI" crossorigin="anonymous">
    <script type="application/ld+json">{structured_data}</script>
  </head>
  <body>
    <a href="#main-content" class="skip-link">Skip to content</a>
    <header>
      <a id="site-title" href="./" aria-label="Norwegian Dictionary, return to home">
        <span class="site-wordmark-name">Norwegian Dictionary</span>
        <span class="site-wordmark-descriptor" aria-hidden="true">Words <span>&middot;</span> Stories <span>&middot;</span> Practice</span>
      </a>
    </header>
    <!-- Same #mode-nav as the main app shell (index.html) — see
         styles/35-navigation.css, already linked above, for the top
         tab strip / fixed bottom tab bar it renders as. Plain links
         rather than the app's selectType()/goToMyWords() JS calls: this
         is a separate static document with none of that loaded, so a
         real navigation (into the live app, at each mode's own pretty
         route) is the correct behavior here anyway. None marked active —
         What's New isn't one of the five primary modes. -->
    <nav id="mode-nav" aria-label="Primary">
      <a class="mode-tab" data-mode="words" href="?type=words">
        <span class="mode-tab-icon" style="mask-image: url(Resources/Photos/words.svg); -webkit-mask-image: url(Resources/Photos/words.svg)" aria-hidden="true"></span>
        <span class="mode-tab-label">Words</span>
      </a>
      <a class="mode-tab" data-mode="sentences" href="sentences/">
        <span class="mode-tab-icon" style="mask-image: url(Resources/Photos/sentences.svg); -webkit-mask-image: url(Resources/Photos/sentences.svg)" aria-hidden="true"></span>
        <span class="mode-tab-label">Sentences</span>
      </a>
      <a class="mode-tab" data-mode="stories" href="stories/">
        <span class="mode-tab-icon" style="mask-image: url(Resources/Photos/stories.svg); -webkit-mask-image: url(Resources/Photos/stories.svg)" aria-hidden="true"></span>
        <span class="mode-tab-label">Stories</span>
      </a>
      <a class="mode-tab" data-mode="word-game" href="word-game/">
        <span class="mode-tab-icon" style="mask-image: url(Resources/Photos/word-game.svg); -webkit-mask-image: url(Resources/Photos/word-game.svg)" aria-hidden="true"></span>
        <span class="mode-tab-label">Word Game</span>
      </a>
      <a class="mode-tab" data-mode="word-list" href="?type=word-list">
        <span class="mode-tab-icon" style="mask-image: url(Resources/Photos/bookmark.svg); -webkit-mask-image: url(Resources/Photos/bookmark.svg)" aria-hidden="true"></span>
        <span class="mode-tab-label">My Words</span>
      </a>
    </nav>
    <main id="main-content" class="updates-main">
      <section class="updates-intro" aria-labelledby="updates-title">
        <p class="updates-eyebrow">Product updates</p>
        <h1 id="updates-title">What's New</h1>
        <p class="updates-lede">Follow the improvements we're making to help you explore Norwegian and practice more effectively.</p>
      </section>
      <section class="updates-list" aria-label="Recent updates">
        {entries}
      </section>
    </main>
    <footer>
      <div class="links">
        <a href="https://www.linkedin.com/in/afeinberg1/" target="_blank" rel="noopener noreferrer" class="footer-control linkedin-btn" aria-label="Connect with me on LinkedIn">
          <img src="Resources/Icons/linkedin-icon.png" alt="" class="linkedin-icon"><span>LinkedIn</span>
        </a>
        <a href="https://www.buymeacoffee.com/afeinberg4l" class="coffee-btn">
          <img src="https://img.buymeacoffee.com/button-api/?text=Buy+me+a+coffee&amp;emoji=&amp;slug=afeinberg4l&amp;button_colour=0d3a69&amp;font_colour=ffffff&amp;font_family=Lato&amp;outline_colour=ffffff&amp;coffee_colour=FFDD00" class="coffee-img" alt="Buy me a coffee">
        </a>
        <a href="./?feedback=1" class="footer-control feedback-footer-btn">
          <i class="fas fa-comment-dots" aria-hidden="true"></i><span>Feedback</span>
        </a>
        <a href="updates/" class="footer-control updates-footer-link" aria-current="page">
          <i class="fas fa-clock-rotate-left" aria-hidden="true"></i><span>What's New</span>
        </a>
        <select id="site-switcher" class="footer-control site-switcher-select" aria-label="Go to another site">
          <option value="">Other Languages</option>
          <option value="croatian">Croatian</option><option value="german">German</option>
          <option value="hebrew">Hebrew</option><option value="italian">Italian</option>
          <option value="japanese">Japanese</option><option value="latin">Latin</option>
          <option value="norwegian">Norwegian</option><option value="persian">Persian</option>
          <option value="spanish">Spanish</option><option value="thai">Thai</option>
        </select>
      </div>
      <p class="copyright">© 2026 Norwegian Dictionary, with input from Språkrådet, Universitetet i Bergen, and Det Norske Akademi for Språk og Litteratur</p>
    </footer>
    <script>
      const switcher = document.getElementById("site-switcher");
      switcher.addEventListener("change", () => {{
        if (switcher.value) location.href = `${{location.origin}}/${{switcher.value}}/`;
      }});
    </script>
  </body>
</html>
'''


def build(site_root: Path, repo_root: Path = ROOT, curated_path: Path | None = None) -> Path:
    curated_path = curated_path or repo_root / "updates.json"
    updates = combined_updates(repo_root, curated_path)
    output = site_root / "updates" / "index.html"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(render_page(updates, site_root), encoding="utf-8")
    print(f"Wrote {output} with {len(updates)} public update(s).")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-root", type=Path, default=ROOT)
    parser.add_argument("--repo-root", type=Path, default=ROOT)
    parser.add_argument("--curated", type=Path)
    args = parser.parse_args()
    try:
        build(
            args.site_root.resolve(),
            args.repo_root.resolve(),
            args.curated.resolve() if args.curated else None,
        )
    except (UpdateBuildError, OSError) as error:
        raise SystemExit(f"Updates page build failed: {error}") from error


if __name__ == "__main__":
    main()
