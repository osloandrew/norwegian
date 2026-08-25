#!/usr/bin/env python3
"""Export a reproducible deep surface-form list from CLARINO Corpuscle.

Uses Corpuscle's corpus-attribute frequency endpoint, which reads the indexed
word lexicon directly instead of materializing a multi-billion-token query.
This is a maintenance command; the stored TSV is what ordinary builds consume.
"""

from __future__ import annotations

import argparse
import json
import ssl
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


API_ENDPOINT = "https://clarino.uib.no/korpuskel-api/rest"
CORPUS = "avis-plain"
DEFAULT_OUTPUT = Path(
    "data/clarino-aviskorpus-bokmal-top-100000.tsv"
)


def api(command: str, session_id: str | None = None, **parameters: object) -> dict:
    query = {"command": command, "session-id": session_id or "null"}
    query.update(parameters)
    url = f"{API_ENDPOINT}?{urllib.parse.urlencode(query, doseq=True)}"
    default_paths = ssl.get_default_verify_paths()
    system_ca = Path("/etc/ssl/cert.pem")
    ssl_context = (
        ssl.create_default_context(cafile=str(system_ca))
        if not default_paths.cafile and system_ca.is_file()
        else None
    )
    with urllib.request.urlopen(url, timeout=120, context=ssl_context) as response:
        payload = json.load(response)
    if payload.get("error"):
        raise RuntimeError(payload["error"])
    return payload


def parse_download(data: str, limit: int) -> list[tuple[int, str]]:
    rows: list[tuple[int, str]] = []
    for line in data.splitlines():
        columns = line.split("\t")
        if len(columns) < 2:
            continue
        if columns[0].isdigit():
            count, value = int(columns[0]), columns[1]
        elif columns[-1].isdigit():
            value, count = columns[0], int(columns[-1])
        else:
            continue
        rows.append((count, value.replace("\t", " ").replace("\n", " ")))
        if len(rows) >= limit:
            break
    return rows


def export_frequency_list(output: Path, limit: int) -> None:
    session = api("get-session", **{"new-session": "true"})
    session_id = str(session["sessionId"])
    payload = api(
        "get-attribute-values",
        session_id,
        corpus=CORPUS,
        attribute="word",
        mode="download",
        **{"sort-key": "frequency", "end": limit},
    )
    rows = parse_download(str(payload.get("data", "")), limit)
    if not rows:
        raise RuntimeError("CLARINO returned an empty or unsupported frequency export")

    output.parent.mkdir(parents=True, exist_ok=True)
    generated = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    with output.open("w", encoding="utf-8", newline="") as target:
        target.write("# CLARINO Corpuscle frequency export\n")
        target.write(f"# corpus: {CORPUS}\n")
        target.write("# query: indexed word attribute, sorted by frequency\n")
        target.write(f"# exported-at: {generated}\n")
        target.write("# license: CC BY-NC 4.0\n")
        for count, value in rows:
            target.write(f"{count}\t{value}\n")
    print(f"Wrote {len(rows):,} forms to {output}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--limit", type=int, default=100_000)
    args = parser.parse_args()
    if args.limit <= 0:
        parser.error("--limit must be positive")
    export_frequency_list(args.output, args.limit)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
