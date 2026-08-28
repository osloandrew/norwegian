#!/bin/bash
# Re-encode every .m4a under the given directories to AAC-LC, mono, native sample rate, 64kbps CBR.
# Skips files already at or below the target bitrate (idempotent / safe to re-run).
#
# Usage: scripts/shrink-audio.sh <dir> [<dir> ...]
# Typical use: point it at ~/Downloads right after running the "Norwegian - multiple M/F"
# Shortcut, before moving the new .m4a files into Resources/Words or Resources/Sentences.
set -uo pipefail

TARGET_BPS=64000
SKIP_THRESHOLD=70000   # small margin above target; anything at/under this is left alone

process_one() {
  f="$1"
  br=$(/usr/bin/afinfo "$f" 2>/dev/null | awk -F': ' '/bit rate/ {print $2}' | awk '{print $1}')
  if [[ -n "$br" && "$br" -le "$SKIP_THRESHOLD" ]]; then
    echo "SKIP already-small: $f ($br bps)"
    return 0
  fi
  tmp="${f%.m4a}.__shrink_tmp__.m4a"
  if /usr/bin/afconvert -f m4af -d aac -s 0 -b "$TARGET_BPS" "$f" "$tmp" 2>/tmp/shrink_err_$$; then
    mv -f "$tmp" "$f"
    echo "OK: $f"
  else
    echo "FAIL: $f -- $(cat /tmp/shrink_err_$$)"
    rm -f "$tmp"
  fi
  rm -f /tmp/shrink_err_$$
}
export -f process_one
export TARGET_BPS SKIP_THRESHOLD

for dir in "$@"; do
  echo "=== Processing $dir ==="
  find "$dir" -iname "*.m4a" -print0 | xargs -0 -n1 -P8 -I{} bash -c 'process_one "$@"' _ {}
done
